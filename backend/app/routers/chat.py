from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.db.video_task_dao import get_task_by_task_id
from app.services.chat_service import chat as chat_service, chat_stream as chat_stream_service
from app.services.vector_store import VectorStoreManager
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()

_index_status: dict[str, str] = {}


class IndexRequest(BaseModel):
    task_id: str


class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    task_id: str
    question: str
    history: list[ChatMessage] = []
    provider_id: str
    model_name: str


def _do_index(task_id: str):
    try:
        _index_status[task_id] = "indexing"
        store = VectorStoreManager()
        store.index_task(task_id)
        _index_status[task_id] = "indexed"
        logger.info(f"索引完成: {task_id}")
    except Exception as e:
        _index_status[task_id] = "failed"
        logger.error(f"索引失败: {task_id}, {e}")


@router.post("/chat/index")
def index_task(data: IndexRequest, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    # 校验 task 归属
    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    if _index_status.get(data.task_id) == "indexing":
        return R.success(msg="正在索引中")

    store = VectorStoreManager()
    if store.is_indexed(data.task_id):
        _index_status[data.task_id] = "indexed"
        return R.success(msg="已完成索引")

    _index_status[data.task_id] = "indexing"
    background_tasks.add_task(_do_index, data.task_id)
    return R.success(msg="开始索引")


@router.get("/chat/status")
def chat_status(task_id: str, current_user: User = Depends(get_current_user)):
    try:
        task = get_task_by_task_id(task_id)
        if task and task.user_id is not None and task.user_id != current_user.id:
            return R.error(msg="无权访问该任务", code=403)

        status = _index_status.get(task_id)
        if status:
            return R.success(data={"status": status, "indexed": status == "indexed"})

        store = VectorStoreManager()
        indexed = store.is_indexed(task_id)
        if indexed:
            _index_status[task_id] = "indexed"
        return R.success(data={"status": "indexed" if indexed else "idle", "indexed": indexed})
    except Exception as e:
        logger.error(f"查询索引状态失败: {e}")
        return R.success(data={"status": "idle", "indexed": False})


@router.post("/chat/ask")
def ask_question(data: AskRequest, current_user: User = Depends(get_current_user)):
    try:
        task = get_task_by_task_id(data.task_id)
        if task and task.user_id is not None and task.user_id != current_user.id:
            return R.error(msg="无权访问该任务", code=403)

        history = [{"role": m.role, "content": m.content} for m in data.history]
        result = chat_service(
            task_id=data.task_id,
            question=data.question,
            history=history,
            provider_id=data.provider_id,
            model_name=data.model_name,
            user_id=current_user.id,
        )
        return R.success(data=result)
    except ValueError as e:
        logger.error(f"Chat 问答参数错误: {e}", exc_info=True)
        return R.error(msg=str(e))
    except Exception as e:
        logger.error(f"Chat 问答失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_chat_error
        return R.error(msg=translate_chat_error(e))


@router.post("/chat/ask_stream")
def ask_question_stream(data: AskRequest, current_user: User = Depends(get_current_user)):
    """流式问答：以 SSE（text/event-stream）逐段返回回答内容。"""
    import json as _json

    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    history = [{"role": m.role, "content": m.content} for m in data.history]
    user_id = current_user.id

    def event_gen():
        try:
            for event in chat_stream_service(
                task_id=data.task_id,
                question=data.question,
                history=history,
                provider_id=data.provider_id,
                model_name=data.model_name,
                user_id=user_id,
            ):
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except ValueError as e:
            logger.error(f"Chat 流式问答参数错误: {e}", exc_info=True)
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Chat 流式问答失败: {e}", exc_info=True)
            from app.utils.error_messages import translate_chat_error
            yield f"data: {_json.dumps({'type': 'error', 'message': translate_chat_error(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 关闭 nginx 缓冲，确保实时下发
        },
    )
