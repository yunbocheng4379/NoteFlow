import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.engine import get_db
from app.db.kb_index_status_dao import get_status as get_index_status, set_status as set_index_status
from app.db.models.users import User
from app.db.video_task_dao import get_task_by_task_id
from app.services.chat_service import chat as chat_service, chat_stream as chat_stream_service
from app.services.vector_store import VectorStoreManager
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


def _charge_for_ai_call(user_id: int, model_name: str, note: str) -> tuple[str, int] | tuple[None, str]:
    """
    统一的 AI 问答/工具类调用预扣电逻辑。

    成功时返回 (billing_task_id, credits)；失败（余额不足或未知异常）返回 (None, err_payload)。
    billing_task_id 使用 uuid 生成，作为退款幂等键写进 credit_transactions.related_task_id。
    """
    from app.services.billing import pricing as billing_pricing, credit_ledger
    from app.services.billing.exceptions import InsufficientCreditError

    billing_task_id = f"chat_{uuid.uuid4().hex}"
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
                note=note,
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


def _refund_ai_call(billing_task_id: str) -> None:
    """AI 问答调用失败时统一退款；单独开 session 避免受调用方事务影响。"""
    if not billing_task_id:
        return
    from app.services.billing import credit_ledger

    db = next(get_db())
    try:
        credit_ledger.refund(db, task_id=billing_task_id)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"AI 问答失败退费异常 billing_task_id={billing_task_id}: {e}")
    finally:
        db.close()


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
        set_index_status(task_id, "indexing")
        store = VectorStoreManager()
        store.index_task(task_id)
        set_index_status(task_id, "indexed")
        logger.info(f"索引完成: {task_id}")
    except Exception as e:
        set_index_status(task_id, "failed")
        logger.error(f"索引失败: {task_id}, {e}")


@router.post("/chat/index")
def index_task(data: IndexRequest, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    # 校验 task 归属
    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    if get_index_status(data.task_id) == "indexing":
        return R.success(msg="正在索引中")

    store = VectorStoreManager()
    if store.is_indexed(data.task_id):
        set_index_status(data.task_id, "indexed")
        return R.success(msg="已完成索引")

    set_index_status(data.task_id, "indexing")
    background_tasks.add_task(_do_index, data.task_id)
    return R.success(msg="开始索引")


@router.get("/chat/status")
def chat_status(task_id: str, current_user: User = Depends(get_current_user)):
    try:
        task = get_task_by_task_id(task_id)
        if task and task.user_id is not None and task.user_id != current_user.id:
            return R.error(msg="无权访问该任务", code=403)

        status = get_index_status(task_id)
        if status:
            return R.success(data={"status": status, "indexed": status == "indexed"})

        store = VectorStoreManager()
        indexed = store.is_indexed(task_id)
        if indexed:
            set_index_status(task_id, "indexed")
        return R.success(data={"status": "indexed" if indexed else "idle", "indexed": indexed})
    except Exception as e:
        logger.error(f"查询索引状态失败: {e}")
        return R.success(data={"status": "idle", "indexed": False})


@router.post("/chat/ask")
def ask_question(data: AskRequest, current_user: User = Depends(get_current_user)):
    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    # 预扣电力（本次问答的成本）
    from app.services.billing.exceptions import InsufficientCreditError

    billing_task_id, meta = _charge_for_ai_call(
        current_user.id, data.model_name, f"AI 问答 (task_id={data.task_id[:12]})"
    )
    if billing_task_id is None:
        ic = meta if isinstance(meta, InsufficientCreditError) else None
        if ic is not None:
            return R.error(msg=ic.message, code=ic.code, data=ic.data)
        return R.error(msg="电力扣减失败，请稍后再试", code=500)

    try:
        history = [{"role": m.role, "content": m.content} for m in data.history]
        result = chat_service(
            task_id=data.task_id,
            question=data.question,
            history=history,
            provider_id=data.provider_id,
            model_name=data.model_name,
            user_id=current_user.id,
        )
        result["credits_used"] = meta  # 供前端展示
        return R.success(data=result)
    except ValueError as e:
        logger.error(f"Chat 问答参数错误: {e}", exc_info=True)
        _refund_ai_call(billing_task_id)
        return R.error(msg=str(e))
    except Exception as e:
        logger.error(f"Chat 问答失败: {e}", exc_info=True)
        _refund_ai_call(billing_task_id)
        from app.utils.error_messages import translate_chat_error
        return R.error(msg=translate_chat_error(e))


@router.post("/chat/ask_stream")
def ask_question_stream(data: AskRequest, current_user: User = Depends(get_current_user)):
    """流式问答：以 SSE（text/event-stream）逐段返回回答内容。"""
    import json as _json
    from app.services.billing.exceptions import InsufficientCreditError

    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    # 预扣电力；余额不足时按 SSE 错误事件返回，方便前端统一处理
    billing_task_id, meta = _charge_for_ai_call(
        current_user.id, data.model_name, f"AI 问答 (task_id={data.task_id[:12]})"
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

    history = [{"role": m.role, "content": m.content} for m in data.history]
    user_id = current_user.id
    credits_used = meta

    def event_gen():
        # 用来判断“流式回答是否真正产出过内容”，若中途 LLM 报错且完全没吐出 delta，则退费。
        got_any_delta = False
        failed = False
        try:
            # 先下发一条 meta 事件，前端据此显示“本次消耗 N 电力”
            yield f"data: {_json.dumps({'type': 'billing', 'credits_used': credits_used}, ensure_ascii=False)}\n\n"

            for event in chat_stream_service(
                task_id=data.task_id,
                question=data.question,
                history=history,
                provider_id=data.provider_id,
                model_name=data.model_name,
                user_id=user_id,
            ):
                if event.get("type") == "delta":
                    got_any_delta = True
                if event.get("type") == "error":
                    failed = True
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except ValueError as e:
            logger.error(f"Chat 流式问答参数错误: {e}", exc_info=True)
            failed = True
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Chat 流式问答失败: {e}", exc_info=True)
            failed = True
            from app.utils.error_messages import translate_chat_error
            yield f"data: {_json.dumps({'type': 'error', 'message': translate_chat_error(e)}, ensure_ascii=False)}\n\n"
        finally:
            # 只有当出错并且未产生任何内容时才退款——如果 LLM 已经吐出了部分回答再中断，视为已消费。
            if failed and not got_any_delta:
                _refund_ai_call(billing_task_id)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 关闭 nginx 缓冲，确保实时下发
        },
    )
