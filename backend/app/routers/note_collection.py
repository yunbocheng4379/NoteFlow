import io
import json
import os
import re
import uuid
import zipfile
from typing import List, Optional

from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.db import note_collection_dao
from app.db.engine import get_db
from app.db.models.video_tasks import VideoTask
from app.db.models.users import User
from app.db.video_task_dao import insert_video_task, update_task_status
from app.models.audio_model import AudioDownloadResult
from app.models.notes_model import NoteResult
from app.models.transcriber_model import TranscriptResult
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter(prefix="/collections", tags=["note_collections"])

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
COVER_DIR = os.path.join("static", "collection_covers")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_COVER_SIZE = 5 * 1024 * 1024  # 5MB

os.makedirs(COVER_DIR, exist_ok=True)


class CreateCollectionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class UpdateCollectionRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class ItemsRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=1)


class MergeRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=2)
    provider_id: str
    model_name: str


def _safe_title(title: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", title).strip() or "note"


def _load_task_summary(row: VideoTask) -> dict:
    """与 /tasks 列表一致的摘要读取逻辑：优先读完成结果，其次读下载阶段落盘的元信息。"""
    task_id = row.task_id
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")

    title, cover_url, duration = "", "", 0
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                rc = json.load(f)
            meta = rc.get("audio_meta", {})
            title = meta.get("title", "")
            cover_url = meta.get("cover_url", "")
            duration = meta.get("duration", 0)
        except Exception:
            pass
    else:
        meta_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    pm = json.load(mf)
                title = pm.get("title", "")
                cover_url = pm.get("cover_url", "")
                duration = pm.get("duration", 0)
            except Exception:
                pass

    status = row.status or ("SUCCESS" if os.path.exists(result_path) else "PENDING")

    return {
        "task_id": task_id,
        "video_id": row.video_id,
        "platform": row.platform,
        "video_url": row.video_url or "",
        "model_name": row.model_name or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "completed_at": row.completed_at.isoformat() if row.completed_at else "",
        "status": status,
        "title": title,
        "cover_url": cover_url,
        "duration": duration,
    }


@router.get("")
def list_collections(keyword: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return R.success(note_collection_dao.list_collections(user_id=current_user.id, keyword=keyword))


@router.post("")
def create_collection(data: CreateCollectionRequest, current_user: User = Depends(get_current_user)):
    collection = note_collection_dao.create_collection(
        user_id=current_user.id, name=data.name, description=data.description
    )
    return R.success(collection)


@router.get("/{collection_id}")
def get_collection(collection_id: int, current_user: User = Depends(get_current_user)):
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if not collection:
        return R.error(msg="合集不存在或无权限访问", code=404)
    return R.success(collection)


@router.put("/{collection_id}")
def update_collection(
    collection_id: int, data: UpdateCollectionRequest, current_user: User = Depends(get_current_user)
):
    updated = note_collection_dao.update_collection(
        collection_id, current_user.id, name=data.name, description=data.description
    )
    if updated is None:
        return R.error(msg="合集不存在或无权限操作", code=404)
    return R.success(updated)


@router.delete("/{collection_id}")
def delete_collection(collection_id: int, current_user: User = Depends(get_current_user)):
    ok = note_collection_dao.delete_collection(collection_id, current_user.id)
    if not ok:
        return R.error(msg="合集不存在或无权限操作", code=404)
    return R.success(msg="删除成功")


@router.post("/{collection_id}/cover")
async def upload_cover(
    collection_id: int, file: UploadFile = File(...), current_user: User = Depends(get_current_user)
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG/GIF/WEBP 格式")

    content = await file.read()
    if len(content) > MAX_COVER_SIZE:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    existing = note_collection_dao.get_collection(collection_id, current_user.id)
    if existing is None:
        return R.error(msg="合集不存在或无权限操作", code=404)

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{collection_id}_{uuid.uuid4().hex[:8]}.{ext}"
    save_path = os.path.join(COVER_DIR, filename)
    with open(save_path, "wb") as f:
        f.write(content)

    old_cover = existing.get("cover_url")
    if old_cover and old_cover.startswith("/static/collection_covers/"):
        old_path = old_cover.lstrip("/")
        if os.path.exists(old_path):
            os.remove(old_path)

    cover_url = f"/static/collection_covers/{filename}"
    updated = note_collection_dao.update_collection(collection_id, current_user.id, cover_url=cover_url)
    return R.success(updated)


@router.get("/{collection_id}/items")
def list_items(collection_id: int, current_user: User = Depends(get_current_user)):
    task_ids = note_collection_dao.get_item_task_ids(collection_id, current_user.id)
    if task_ids is None:
        return R.error(msg="合集不存在或无权限访问", code=404)
    if not task_ids:
        return R.success([])

    db = next(get_db())
    try:
        rows = db.query(VideoTask).filter(VideoTask.task_id.in_(task_ids)).all()
        rows_by_id = {r.task_id: r for r in rows}
    finally:
        db.close()

    results = [_load_task_summary(rows_by_id[tid]) for tid in task_ids if tid in rows_by_id]
    results.sort(key=lambda r: r["created_at"], reverse=True)
    return R.success(results)


@router.post("/{collection_id}/items")
def add_items(collection_id: int, data: ItemsRequest, current_user: User = Depends(get_current_user)):
    result = note_collection_dao.add_items(collection_id, current_user.id, data.task_ids)
    if result is None:
        return R.error(msg="合集不存在或无权限操作", code=404)
    return R.success(result)


@router.delete("/{collection_id}/items")
def remove_items(collection_id: int, data: ItemsRequest, current_user: User = Depends(get_current_user)):
    result = note_collection_dao.remove_items(collection_id, current_user.id, data.task_ids)
    if result is None:
        return R.error(msg="合集不存在或无权限操作", code=404)
    return R.success(result)


def _run_merge_task(task_id: str, collection_id: int, user_id: int, source_task_ids: List[str],
                     provider_id: str, model_name: str) -> None:
    """后台执行：读取多篇源笔记 markdown -> LLM 融合 -> 落盘 -> 自动加入合集。"""
    from app.services.llm_helper import simple_completion
    from app.gpt.prompt import MERGE_NOTES_PROMPT
    from app.services.billing import credit_ledger

    try:
        titles = []
        sections = []
        cover_url = None
        for tid in source_task_ids:
            result_path = os.path.join(NOTE_OUTPUT_DIR, f"{tid}.json")
            if not os.path.exists(result_path):
                continue
            with open(result_path, "r", encoding="utf-8") as f:
                rc = json.load(f)
            audio_meta = rc.get("audio_meta", {}) or {}
            title = audio_meta.get("title") or tid
            titles.append(title)
            sections.append(f"## 笔记来源：{title}\n\n{rc.get('markdown', '')}")
            if not cover_url and audio_meta.get("cover_url"):
                cover_url = audio_meta.get("cover_url")

        if not sections:
            raise ValueError("源笔记内容为空，无法融合")

        combined = "\n\n---\n\n".join(sections)
        messages = [
            {"role": "system", "content": MERGE_NOTES_PROMPT},
            {"role": "user", "content": combined},
        ]
        merged_markdown = simple_completion(provider_id, model_name, messages, temperature=0.3)

        merged_title = f"融合笔记：{' + '.join(titles[:3])}" + ("等" if len(titles) > 3 else "")

        note = NoteResult(
            markdown=merged_markdown,
            transcript=TranscriptResult(language=None, full_text="", segments=[]),
            audio_meta=AudioDownloadResult(
                file_path="",
                title=merged_title,
                duration=0,
                cover_url=cover_url,
                platform="merged",
                video_id=f"merged_{task_id[:8]}",
                raw_info={},
            ),
        )

        os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
        with open(os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
            json.dump(asdict(note), f, ensure_ascii=False, indent=2)

        update_task_status(task_id, "SUCCESS", completed=True)
        note_collection_dao.add_task_to_collection_on_generate(collection_id, user_id, task_id)
        logger.info(f"融合笔记完成 task_id={task_id}, collection_id={collection_id}, sources={source_task_ids}")
    except Exception as e:
        logger.error(f"融合笔记失败 task_id={task_id}: {e}")
        update_task_status(task_id, "FAILED", completed=True)
        os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
        with open(os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.status.json"), "w", encoding="utf-8") as f:
            json.dump({"status": "FAILED", "message": str(e)}, f, ensure_ascii=False, indent=2)
        db = next(get_db())
        try:
            credit_ledger.refund(db, task_id=task_id)
            db.commit()
        except Exception as re:
            db.rollback()
            logger.error(f"融合笔记失败后退费异常 task_id={task_id}: {re}")
        finally:
            db.close()


@router.post("/{collection_id}/merge")
def merge_notes(
    collection_id: int,
    data: MergeRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """把合集内选中的 >=2 篇笔记通过 LLM 融合成一篇新笔记，自动加入本合集。"""
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if collection is None:
        return R.error(msg="合集不存在或无权限访问", code=404)

    item_task_ids = set(note_collection_dao.get_item_task_ids(collection_id, current_user.id) or [])
    invalid = [tid for tid in data.task_ids if tid not in item_task_ids]
    if invalid:
        return R.error(msg="所选笔记不属于该合集", code=400)

    from app.services.billing import pricing as billing_pricing, credit_ledger
    from app.services.billing.exceptions import InsufficientCreditError

    task_id = str(uuid.uuid4())
    db = next(get_db())
    try:
        required = billing_pricing.calculate_required_credits(db, data.model_name, 0)
        try:
            credit_ledger.consume(
                db,
                user_id=current_user.id,
                amount=required,
                task_id=task_id,
                model_name=data.model_name,
                note=f"融合笔记 ({len(data.task_ids)} 篇)",
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

    insert_video_task(
        video_id=f"merged_{task_id[:8]}",
        platform="merged",
        task_id=task_id,
        user_id=current_user.id,
        model_name=data.model_name,
        credits_used=required,
    )

    background_tasks.add_task(
        _run_merge_task, task_id, collection_id, current_user.id, data.task_ids,
        data.provider_id, data.model_name,
    )
    return R.success({"task_id": task_id})


@router.get("/{collection_id}/export_zip")
def export_zip(collection_id: int, current_user: User = Depends(get_current_user)):
    """把合集内所有笔记逐篇导出为 Markdown，打包成一个 ZIP 返回。"""
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if collection is None:
        return R.error(msg="合集不存在或无权限访问", code=404)

    task_ids = note_collection_dao.get_item_task_ids(collection_id, current_user.id) or []
    if not task_ids:
        return R.error(msg="合集内暂无笔记，无法导出", code=400)

    buffer = io.BytesIO()
    used_names: dict = {}

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for task_id in task_ids:
            result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
            if not os.path.exists(result_path):
                continue
            try:
                with open(result_path, "r", encoding="utf-8") as f:
                    rc = json.load(f)
                markdown = rc.get("markdown", "")
                title = _safe_title(rc.get("audio_meta", {}).get("title") or task_id)

                name = title
                if name in used_names:
                    used_names[name] += 1
                    name = f"{title}_{used_names[name]}"
                else:
                    used_names[name] = 0

                zf.writestr(f"{name}.md", markdown)
            except Exception:
                continue

    buffer.seek(0)
    zip_name = _safe_title(collection["name"])
    from urllib.parse import quote
    ascii_name = re.sub(r'[^\x00-\x7f]', '_', zip_name)
    encoded_name = quote(zip_name, safe='')
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}.zip\"; filename*=UTF-8''{encoded_name}.zip"
        },
    )


def _yaml_escape(value: str) -> str:
    return str(value).replace('"', '\\"')


@router.get("/{collection_id}/export_obsidian")
def export_obsidian(collection_id: int, current_user: User = Depends(get_current_user)):
    """把合集内所有笔记逐篇导出为带 YAML frontmatter 的 Obsidian 格式 Markdown，打包成 ZIP 返回。"""
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if collection is None:
        return R.error(msg="合集不存在或无权限访问", code=404)

    task_ids = note_collection_dao.get_item_task_ids(collection_id, current_user.id) or []
    if not task_ids:
        return R.error(msg="合集内暂无笔记，无法导出", code=400)

    buffer = io.BytesIO()
    used_names: dict = {}

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for task_id in task_ids:
            result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
            if not os.path.exists(result_path):
                continue
            try:
                with open(result_path, "r", encoding="utf-8") as f:
                    rc = json.load(f)
                markdown = rc.get("markdown", "")
                meta = rc.get("audio_meta", {}) or {}
                title = meta.get("title") or task_id
                platform = meta.get("platform") or ""

                frontmatter_lines = [
                    "---",
                    f'title: "{_yaml_escape(title)}"',
                    f'platform: "{_yaml_escape(platform)}"',
                    f'tags: ["笔记", "{_yaml_escape(collection["name"])}"]',
                    "---",
                ]
                content = "\n".join(frontmatter_lines) + "\n\n" + markdown

                safe_title = _safe_title(title)
                name = safe_title
                if name in used_names:
                    used_names[name] += 1
                    name = f"{safe_title}_{used_names[name]}"
                else:
                    used_names[name] = 0

                zf.writestr(f"{name}.md", content)
            except Exception:
                continue

    buffer.seek(0)
    zip_name = _safe_title(collection["name"])
    from urllib.parse import quote
    ascii_name = re.sub(r'[^\x00-\x7f]', '_', zip_name)
    encoded_name = quote(zip_name, safe='')
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}_obsidian.zip\"; filename*=UTF-8''{encoded_name}_obsidian.zip"
        },
    )
