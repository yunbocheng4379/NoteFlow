import json as _json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db import kb_dao
from app.db.models.users import User
from app.services.kb_permissions import require_pro
from app.services.knowledge_base_service import ask_stream as ask_stream_service, get_index_coverage
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter(prefix="/kb", tags=["knowledge_base"])


class AskStreamRequest(BaseModel):
    conversation_id: int
    question: str
    provider_id: str
    model_name: str
    enable_thinking: bool = False


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

    def event_gen():
        try:
            for event in ask_stream_service(
                conversation_id=data.conversation_id,
                question=data.question,
                provider_id=data.provider_id,
                model_name=data.model_name,
                enable_thinking=data.enable_thinking,
                user_id=current_user.id,
            ):
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"知识库流式问答失败: {e}", exc_info=True)
            yield f"data: {_json.dumps({'type': 'error', 'message': '知识库问答失败，请稍后重试'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
