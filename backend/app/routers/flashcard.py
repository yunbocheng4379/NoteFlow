import csv
import io
import json
import os
import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.db import flashcard_dao
from app.db.engine import get_db
from app.db.models.users import User
from app.db.models.video_tasks import VideoTask
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/flashcards", tags=["flashcards"])
logger = get_logger(__name__)

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


class GenerateFlashcardsRequest(BaseModel):
    task_id: str
    provider_id: str
    model_name: str
    custom_prompt: Optional[str] = Field(None, max_length=1000)
    card_count: int = Field(10, ge=3, le=50)


def _safe_title(title: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", title).strip() or "flashcards"


def _assert_task_owned(task_id: str, user_id: int) -> dict:
    db = next(get_db())
    try:
        row = db.query(VideoTask).filter_by(task_id=task_id, user_id=user_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="笔记不存在或无权限访问")
    finally:
        db.close()

    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="笔记内容不存在，暂无法生成闪记卡")

    with open(result_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _parse_cards_response(raw: str, expected_count: int) -> list[dict]:
    text = raw.strip()
    # 兼容模型偶尔仍包裹代码块的情况
    if text.startswith("```"):
        text = re.sub(r"^```(json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"闪记卡生成结果解析失败: {e}")

    if not isinstance(data, list) or not data:
        raise ValueError("闪记卡生成结果格式不正确")

    cards = []
    for item in data:
        question = (item.get("question") or "").strip()
        answer = (item.get("answer") or "").strip()
        if question and answer:
            cards.append({"question": question, "answer": answer})

    if not cards:
        raise ValueError("闪记卡生成结果为空")

    return cards


@router.post("/generate")
def generate_flashcards(data: GenerateFlashcardsRequest, current_user: User = Depends(get_current_user)):
    """根据一篇笔记生成一组闪记卡（问答卡片），按模型价格消耗电力。"""
    note_content = _assert_task_owned(data.task_id, current_user.id)
    markdown = note_content.get("markdown", "")
    if not markdown.strip():
        return R.error(msg="笔记内容为空，无法生成闪记卡", code=400)

    from app.services.billing import pricing as billing_pricing, credit_ledger
    from app.services.billing.exceptions import InsufficientCreditError

    db = next(get_db())
    try:
        required = billing_pricing.calculate_required_credits(db, data.model_name, 0)
        try:
            credit_ledger.consume(
                db,
                user_id=current_user.id,
                amount=required,
                task_id=data.task_id,
                model_name=data.model_name,
                note=f"生成闪记卡 ({data.card_count} 张)",
            )
            db.commit()
        except InsufficientCreditError as ic:
            db.rollback()
            return R.error(msg=ic.message, code=ic.code, data=ic.data)
        except Exception:
            db.rollback()
            raise
    finally:
        db.close()

    from app.services.llm_helper import simple_completion
    from app.gpt.prompt import FLASHCARD_PROMPT

    try:
        prompt = FLASHCARD_PROMPT.format(
            card_count=data.card_count,
            custom_prompt=data.custom_prompt or "（无特殊要求，围绕笔记核心内容出题）",
        )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": markdown},
        ]
        raw = simple_completion(data.provider_id, data.model_name, messages, temperature=0.5)
        cards = _parse_cards_response(raw, data.card_count)
    except Exception as e:
        logger.error(f"生成闪记卡失败 (task_id={data.task_id}): {e}")
        from app.services.billing import credit_ledger as _ledger
        refund_db = next(get_db())
        try:
            _ledger.refund(refund_db, task_id=data.task_id)
            refund_db.commit()
        except Exception as re:
            refund_db.rollback()
            logger.error(f"生成闪记卡失败后退费异常 (task_id={data.task_id}): {re}")
        finally:
            refund_db.close()
        return R.error(msg=f"生成失败: {e}", code=500)

    title = note_content.get("audio_meta", {}).get("title") or data.task_id
    flashcard_set = flashcard_dao.create_set(
        user_id=current_user.id,
        task_id=data.task_id,
        title=title,
        custom_prompt=data.custom_prompt,
        card_count=len(cards),
        provider_id=data.provider_id,
        model_name=data.model_name,
        cards=cards,
    )

    return R.success({
        "set_id": flashcard_set.id,
        "title": flashcard_set.title,
        "card_count": flashcard_set.card_count,
        "cards": [{"question": c["question"], "answer": c["answer"]} for c in cards],
    })


@router.get("/sets/{task_id}")
def list_flashcard_sets(task_id: str, current_user: User = Depends(get_current_user)):
    """列出某篇笔记已生成过的闪记卡组。"""
    sets = flashcard_dao.list_sets_by_task(task_id, current_user.id)
    return R.success([
        {
            "id": s.id,
            "title": s.title,
            "card_count": s.card_count,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sets
    ])


@router.get("/set/{set_id}")
def get_flashcard_set(set_id: int, current_user: User = Depends(get_current_user)):
    """获取某个闪记卡组的全部卡片。"""
    flashcard_set = flashcard_dao.get_set(set_id, current_user.id)
    if not flashcard_set:
        return R.error(msg="闪记卡组不存在或无权限访问", code=404)

    cards = flashcard_dao.get_cards(set_id)
    return R.success({
        "id": flashcard_set.id,
        "title": flashcard_set.title,
        "task_id": flashcard_set.task_id,
        "card_count": flashcard_set.card_count,
        "cards": [{"question": c.question, "answer": c.answer} for c in cards],
    })


@router.delete("/set/{set_id}")
def delete_flashcard_set(set_id: int, current_user: User = Depends(get_current_user)):
    ok = flashcard_dao.delete_set(set_id, current_user.id)
    if not ok:
        return R.error(msg="闪记卡组不存在或无权限操作", code=404)
    return R.success(msg="删除成功")


@router.get("/set/{set_id}/export_csv")
def export_flashcards_csv(set_id: int, current_user: User = Depends(get_current_user)):
    """把某个闪记卡组的全部卡片导出为一个 CSV 文件。"""
    flashcard_set = flashcard_dao.get_set(set_id, current_user.id)
    if not flashcard_set:
        raise HTTPException(status_code=404, detail="闪记卡组不存在或无权限访问")

    cards = flashcard_dao.get_cards(set_id)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["question", "answer"])
    for c in cards:
        writer.writerow([c.question, c.answer])

    csv_bytes = buffer.getvalue().encode("utf-8-sig")  # BOM 便于 Excel 正确识别中文
    file_name = _safe_title(flashcard_set.title or f"flashcards_{set_id}")
    ascii_name = re.sub(r'[^\x00-\x7f]', '_', file_name)
    encoded_name = quote(file_name, safe='')

    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}.csv\"; filename*=UTF-8''{encoded_name}.csv"
        },
    )
