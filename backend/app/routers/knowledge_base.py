import json as _json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db import kb_dao
from app.db.engine import get_db
from app.db.models.users import User
from app.services.kb_permissions import require_pro
from app.services.knowledge_base_service import ask_stream as ask_stream_service, get_index_coverage
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter(prefix="/kb", tags=["knowledge_base"])


def _charge_for_kb_call(user_id: int, model_name: str, conversation_id: int) -> tuple[Optional[str], object]:
    """
    知识库问答预扣电力。同 chat.py 的 _charge_for_ai_call 一样使用合成 task_id 作为退款幂等键。
    """
    from app.services.billing import pricing as billing_pricing, credit_ledger
    from app.services.billing.exceptions import InsufficientCreditError

    billing_task_id = f"kb_{uuid.uuid4().hex}"
    db = next(get_db())
    try:
        required = billing_pricing.calculate_required_credits(db, model_name, 0)
        try:
            credit_ledger.consume(
                db,
                user_id=user_id,
                amount=required,
                task_id=billing_task_id,
                model_name=model_name,
                note=f"知识库问答 (conversation_id={conversation_id})",
            )
            db.commit()
            return billing_task_id, required
        except InsufficientCreditError as ic:
            db.rollback()
            return None, ic
        except Exception:
            db.rollback()
            raise
    finally:
        db.close()


def _refund_kb_call(billing_task_id: str) -> None:
    if not billing_task_id:
        return
    from app.services.billing import credit_ledger

    db = next(get_db())
    try:
        credit_ledger.refund(db, task_id=billing_task_id)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"知识库问答失败退费异常 billing_task_id={billing_task_id}: {e}")
    finally:
        db.close()


class AskStreamRequest(BaseModel):
    conversation_id: int
    question: str
    provider_id: str
    model_name: str
    enable_thinking: bool = False
    note_task_ids: Optional[List[str]] = None


@router.post("/conversations")
def create_conversation(current_user: User = Depends(get_current_user)):
    conv = kb_dao.create_conversation(current_user.id)
    return R.success(conv, msg="会话创建成功")


@router.get("/conversations")
def list_conversations(current_user: User = Depends(get_current_user)):
    conversations = kb_dao.list_conversations(current_user.id)
    return R.success(conversations)


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: int, current_user: User = Depends(get_current_user)):
    conv = kb_dao.get_conversation(conversation_id, current_user.id)
    if not conv:
        return R.error(msg="会话不存在或无权访问", code=404)
    messages = kb_dao.list_messages(conversation_id)
    return R.success(messages)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, current_user: User = Depends(get_current_user)):
    ok = kb_dao.delete_conversation(conversation_id, current_user.id)
    if not ok:
        return R.error(msg="会话不存在或无权访问", code=404)
    return R.success(msg="会话已删除")


class UpdateConversationRequest(BaseModel):
    """会话可编辑属性，全部可选；未传字段保持不变。"""
    title: Optional[str] = None
    is_pinned: Optional[bool] = None
    is_unread: Optional[bool] = None


@router.patch("/conversations/{conversation_id}")
def update_conversation(
    conversation_id: int,
    data: UpdateConversationRequest,
    current_user: User = Depends(get_current_user),
):
    title = data.title.strip() if isinstance(data.title, str) else None
    if title is not None and not title:
        return R.error(msg="标题不能为空", code=400)
    if title is not None and len(title) > 200:
        title = title[:200]

    updated = kb_dao.patch_conversation(
        conversation_id,
        current_user.id,
        title=title,
        is_pinned=data.is_pinned,
        is_unread=data.is_unread,
    )
    if not updated:
        return R.error(msg="会话不存在或无权访问", code=404)
    return R.success(updated, msg="会话已更新")


@router.get("/index_status")
def index_status(current_user: User = Depends(get_current_user)):
    coverage = get_index_coverage(current_user.id)
    return R.success(coverage)


@router.post("/ask_stream")
def ask_stream(data: AskStreamRequest, current_user: User = Depends(get_current_user)):
    """知识库跨笔记流式问答：以 SSE（text/event-stream）逐段返回回答内容，需 Pro。"""
    require_pro(current_user)

    conv = kb_dao.get_conversation(data.conversation_id, current_user.id)
    if not conv:
        return R.error(msg="会话不存在或无权访问", code=404)

    # 预扣电力；余额不足按 SSE error 事件返回
    from app.services.billing.exceptions import InsufficientCreditError

    billing_task_id, meta = _charge_for_kb_call(
        current_user.id, data.model_name, data.conversation_id
    )
    if billing_task_id is None:
        err_msg = (
            meta.message if isinstance(meta, InsufficientCreditError) else "电力扣减失败，请稍后再试"
        )

        def error_gen():
            yield f"data: {_json.dumps({'type': 'error', 'message': err_msg}, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            error_gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    credits_used = meta

    def event_gen():
        got_any_delta = False
        failed = False
        try:
            yield f"data: {_json.dumps({'type': 'billing', 'credits_used': credits_used}, ensure_ascii=False)}\n\n"

            for event in ask_stream_service(
                conversation_id=data.conversation_id,
                question=data.question,
                provider_id=data.provider_id,
                model_name=data.model_name,
                enable_thinking=data.enable_thinking,
                user_id=current_user.id,
                note_task_ids=data.note_task_ids,
            ):
                if event.get("type") == "delta":
                    got_any_delta = True
                if event.get("type") == "error":
                    failed = True
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"知识库流式问答失败: {e}", exc_info=True)
            failed = True
            yield f"data: {_json.dumps({'type': 'error', 'message': '知识库问答失败，请稍后重试'}, ensure_ascii=False)}\n\n"
        finally:
            if failed and not got_any_delta:
                _refund_kb_call(billing_task_id)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
