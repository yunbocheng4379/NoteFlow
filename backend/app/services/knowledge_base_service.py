import json
from typing import Iterator, Optional

from app.db import kb_dao
from app.db.kb_index_status_dao import get_statuses as get_index_statuses, set_status as set_index_status
from app.db.model_dao import get_model_by_provider_and_name
from app.db.video_task_dao import get_task_ids_by_user
from app.gpt.gpt_factory import GPTFactory
from app.models.model_config import ModelConfig
from app.services.kb_note_lookup import load_note_title
from app.services.provider import ProviderService
from app.services.vector_store import VectorStoreManager
from app.utils.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一个跨笔记知识库问答助手，可以访问用户名下全部视频笔记的内容。

--- 检索到的相关笔记片段 ---
{context}
---

回答要求：
- 基于上方检索到的片段回答问题，明确指出信息来自哪篇笔记（用笔记标题）
- 如果检索内容不足以回答问题，请诚实说明，不要编造
- 请用中文回答，保持简洁准确"""

MAX_HISTORY_MESSAGES = 20


def get_index_coverage(user_id: int) -> dict:
    """返回当前用户笔记的索引覆盖情况：总数与已索引数。"""
    task_ids = get_task_ids_by_user(user_id)
    if not task_ids:
        return {"total": 0, "indexed": 0}
    statuses = get_index_statuses(task_ids)
    indexed = sum(1 for t in task_ids if statuses.get(t) == "indexed")
    return {"total": len(task_ids), "indexed": indexed}


def _get_indexed_task_ids(user_id: int) -> list[str]:
    """已索引的 task_id 子集；未索引的异步补索引，本次不等待。"""
    task_ids = get_task_ids_by_user(user_id)
    if not task_ids:
        return []

    statuses = get_index_statuses(task_ids)
    indexed_ids = [t for t in task_ids if statuses.get(t) == "indexed"]
    unindexed_ids = [t for t in task_ids if statuses.get(t) != "indexed" and statuses.get(t) != "indexing"]

    if unindexed_ids:
        import threading

        def _backfill(ids: list[str]):
            store = VectorStoreManager()
            for tid in ids:
                try:
                    set_index_status(tid, "indexing")
                    store.index_task(tid)
                    set_index_status(tid, "indexed")
                except Exception as e:
                    set_index_status(tid, "failed")
                    logger.error(f"知识库后台补索引失败: task_id={tid}, {e}")

        threading.Thread(target=_backfill, args=(unindexed_ids,), daemon=True).start()

    return indexed_ids


def _build_context_and_sources(chunks: list[dict]) -> tuple[str, list[dict]]:
    parts = []
    sources = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        task_id = meta.get("task_id", "")
        title = load_note_title(task_id) if task_id else ""
        source_type = meta.get("source_type", "unknown")
        label = f"[笔记《{title}》]" if title else "[未知来源]"
        parts.append(f"{label}\n{chunk['text']}")

        source = {"task_id": task_id, "title": title, "text": chunk["text"][:200], "source_type": source_type}
        sources.append(source)
    context = "\n\n".join(parts) if parts else "（未检索到相关内容）"
    return context, sources


def _resolve_reasoning_mode(provider_id: str, model_name: str, enable_thinking: bool) -> Optional[str]:
    """返回 None(不开启)、'native'(DeepSeek 类，无需额外参数) 或 'extra_body'(Qwen 类，需 enable_thinking=True)。"""
    if not enable_thinking:
        return None
    model = get_model_by_provider_and_name(provider_id, model_name)
    if not model or not model.get("supports_reasoning"):
        return None
    if "qwen" in model_name.lower():
        return "extra_body"
    return "native"


def ask_stream(
    conversation_id: int,
    question: str,
    provider_id: str,
    model_name: str,
    enable_thinking: bool,
    user_id: int,
) -> Iterator[dict]:
    """
    知识库流式问答：跨笔记检索 + 可选深度思考 + 流式返回，落库用户问题与最终回答。

    yield 事件字典：
      {"type": "sources", "sources": [...]}
      {"type": "reasoning", "content": "..."}   仅开启深度思考时
      {"type": "delta", "content": "..."}
      {"type": "done", "message_id": 123}
      {"type": "error", "message": "..."}
    """
    kb_dao.add_message(conversation_id, "user", question)

    indexed_task_ids = _get_indexed_task_ids(user_id)

    vector_store = VectorStoreManager()
    chunks = vector_store.query_multi(indexed_task_ids, question, per_task_n=4, top_k=8) if indexed_task_ids else []
    context, sources = _build_context_and_sources(chunks)

    yield {"type": "sources", "sources": sources}

    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        yield {"type": "error", "message": "未找到对应的 AI 供应商，请检查供应商配置"}
        return

    config = ModelConfig(
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        model_name=model_name,
        provider=provider["type"],
        name=provider["name"],
    )
    gpt = GPTFactory.from_config(config)

    history = kb_dao.list_messages(conversation_id, limit=MAX_HISTORY_MESSAGES)
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
    for m in history:
        messages.append({"role": m["role"], "content": m["content"]})

    reasoning_mode = _resolve_reasoning_mode(provider_id, model_name, enable_thinking)

    kwargs = dict(model=gpt.model, messages=messages, temperature=0.7, stream=True)
    if reasoning_mode == "extra_body":
        kwargs["extra_body"] = {"enable_thinking": True}

    logger.info(f"KB ask_stream: conversation_id={conversation_id}, model={model_name}, reasoning_mode={reasoning_mode}")

    try:
        completion = gpt.client.chat.completions.create(**kwargs)
    except Exception as e:
        logger.error(f"KB ask_stream 调用 LLM 失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_chat_error
        yield {"type": "error", "message": translate_chat_error(e)}
        return

    content_parts: list[str] = []
    reasoning_parts: list[str] = []

    try:
        for piece in completion:
            choices = getattr(piece, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta

            if reasoning_mode is not None:
                reasoning_text = getattr(delta, "reasoning_content", None)
                if reasoning_text:
                    reasoning_parts.append(reasoning_text)
                    yield {"type": "reasoning", "content": reasoning_text}

            text = getattr(delta, "content", None)
            if text:
                content_parts.append(text)
                yield {"type": "delta", "content": text}
    except Exception as e:
        logger.error(f"KB ask_stream 流式读取失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_chat_error
        yield {"type": "error", "message": translate_chat_error(e)}
        return

    final_answer = "".join(content_parts)
    final_reasoning = "".join(reasoning_parts) or None

    saved = kb_dao.add_message(
        conversation_id, "assistant", final_answer,
        reasoning_content=final_reasoning,
        sources=sources,
    )

    # history 在插入本轮用户消息之后才读取，所以"第一次提问"时 history 长度恰好为 1
    # （只有刚插入的这条 user 消息）；以此判断是否需要回填会话标题。
    if len(history) <= 1:
        kb_dao.update_conversation_meta(
            conversation_id, title=question[:30], provider_id=provider_id, model_name=model_name,
        )
    else:
        kb_dao.update_conversation_meta(conversation_id, provider_id=provider_id, model_name=model_name)
    kb_dao.touch_conversation(conversation_id)

    yield {"type": "done", "message_id": saved["id"]}
