import json
from typing import Optional, Iterator

from typing import Optional

from app.gpt.gpt_factory import GPTFactory
from app.models.model_config import ModelConfig
from app.services.provider import ProviderService
from app.services.vector_store import VectorStoreManager
from app.services.chat_tools import TOOLS, execute_tool
from app.utils.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一个视频笔记问答助手。你拥有以下能力：

1. 系统已自动检索了一些相关内容作为初始参考（见下方）
2. 你可以调用工具主动查询更多信息：
   - lookup_transcript: 查询视频原始转录文本（支持按时间、关键词、位置筛选）
   - get_video_info: 获取视频元信息（标题、作者、简介、标签等）
   - get_note_content: 获取完整笔记内容

--- 初始检索内容 ---
{context}
---

回答要求：
- 如果初始检索内容不足以回答问题，请主动调用工具获取更多信息
- 回答关于视频具体原话、细节时，用 lookup_transcript 查询原文
- 回答关于作者、标题等基本信息时，用 get_video_info 查询
- 请用中文回答，保持简洁准确"""


def _build_context(chunks: list[dict]) -> str:
    """将检索到的片段拼接为上下文文本。"""
    parts = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        source_type = meta.get("source_type", "unknown")
        if source_type == "meta":
            label = "[视频信息]"
        elif source_type == "markdown":
            label = f"[笔记 - {meta.get('section_title', '')}]"
        else:
            start = meta.get("start_time", 0)
            end = meta.get("end_time", 0)
            label = f"[转录 - {start:.0f}s~{end:.0f}s]"
        parts.append(f"{label}\n{chunk['text']}")
    return "\n\n".join(parts)


def _build_sources(chunks: list[dict]) -> list[dict]:
    """从检索片段中提取来源信息。"""
    sources = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        source = {
            "text": chunk["text"][:200],
            "source_type": meta.get("source_type", "unknown"),
        }
        if meta.get("section_title"):
            source["section_title"] = meta["section_title"]
        if meta.get("start_time") is not None:
            source["start_time"] = meta["start_time"]
        if meta.get("end_time") is not None:
            source["end_time"] = meta["end_time"]
        sources.append(source)
    return sources


def chat(
    task_id: str,
    question: str,
    history: list[dict],
    provider_id: str,
    model_name: str,
    user_id: Optional[int] = None,
) -> dict:
    """
    RAG + Tool Calling 问答。
    1. 向量检索初始上下文
    2. 调用 LLM（带 tools）
    3. 如果 LLM 调用了工具，执行工具并将结果返回给 LLM
    4. 循环直到 LLM 给出最终回答
    """
    vector_store = VectorStoreManager()

    # 1. 检索初始上下文
    chunks = vector_store.query(task_id, question, n_results=6)
    context = _build_context(chunks) if chunks else "（未检索到相关内容，请使用工具查询）"
    sources = _build_sources(chunks) if chunks else []

    # 2. 构建消息
    system_msg = SYSTEM_PROMPT.format(context=context)
    messages = [{"role": "system", "content": system_msg}]

    for msg in history[-20:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": question})

    # 3. 获取 LLM client
    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        raise ValueError(f"未找到模型供应商: {provider_id}")

    config = ModelConfig(
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        model_name=model_name,
        provider=provider["type"],
        name=provider["name"],
    )
    gpt = GPTFactory.from_config(config)

    logger.info(f"Chat: task_id={task_id}, model={model_name}")

    # 4. Tool calling 循环（最多 3 轮）
    max_rounds = 3
    for round_i in range(max_rounds):
        response = gpt.client.chat.completions.create(
            model=gpt.model,
            messages=messages,
            tools=TOOLS,
            temperature=0.7,
        )

        msg = response.choices[0].message

        # 没有工具调用，直接返回
        if not msg.tool_calls:
            return {"answer": msg.content or "", "sources": sources}

        # 处理工具调用
        messages.append(msg)

        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            try:
                fn_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            logger.info(f"Tool call [{round_i+1}/{max_rounds}]: {fn_name}({fn_args})")

            result = execute_tool(task_id, fn_name, fn_args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

    # 超过最大轮次，做最后一次不带 tools 的调用
    response = gpt.client.chat.completions.create(
        model=gpt.model,
        messages=messages,
        temperature=0.7,
    )

    return {"answer": response.choices[0].message.content or "", "sources": sources}


def chat_stream(
    task_id: str,
    question: str,
    history: list[dict],
    provider_id: str,
    model_name: str,
    user_id: Optional[int] = None,
) -> Iterator[dict]:
    """
    流式版 RAG + Tool Calling 问答。

    工具调用轮次仍按非流式方式跑（拿到完整的 tool_calls 才能执行工具），
    一旦 LLM 不再调用工具，则用 stream=True 把最终回答逐 token 吐出。

    通过 yield 产出事件字典：
      {"type": "sources", "sources": [...]}   先下发引用来源
      {"type": "delta", "content": "..."}     逐段文本
      {"type": "done"}                         结束
      {"type": "error", "message": "..."}      出错
    """
    vector_store = VectorStoreManager()

    chunks = vector_store.query(task_id, question, n_results=6)
    context = _build_context(chunks) if chunks else "（未检索到相关内容，请使用工具查询）"
    sources = _build_sources(chunks) if chunks else []

    system_msg = SYSTEM_PROMPT.format(context=context)
    messages = [{"role": "system", "content": system_msg}]
    for msg in history[-20:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": question})

    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        raise ValueError(f"未找到模型供应商: {provider_id}")

    config = ModelConfig(
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        model_name=model_name,
        provider=provider["type"],
        name=provider["name"],
    )
    gpt = GPTFactory.from_config(config)

    logger.info(f"ChatStream: task_id={task_id}, model={model_name}")

    # 先把来源下发给前端
    yield {"type": "sources", "sources": sources}

    def _stream_round(stream_messages: list, with_tools: bool):
        """
        跑一轮流式补全。
        - content 分片实时 yield 出去（打字机）
        - 累积 tool_calls 分片，流结束后返回，供上层判断是否需要执行工具

        返回 (assistant_message_dict_or_None, tool_calls_list)
        通过生成器协议：先 yield delta 事件，最后用 return 返回累积结果。
        """
        kwargs = dict(model=gpt.model, messages=stream_messages, temperature=0.7, stream=True)
        if with_tools:
            kwargs["tools"] = TOOLS
        completion = gpt.client.chat.completions.create(**kwargs)

        content_parts: list[str] = []
        # tool_calls 按 index 累积：{index: {"id","name","arguments"}}
        tool_acc: dict[int, dict] = {}

        for piece in completion:
            choices = getattr(piece, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta

            text = getattr(delta, "content", None)
            if text:
                content_parts.append(text)
                yield {"type": "delta", "content": text}

            for tc in (getattr(delta, "tool_calls", None) or []):
                idx = tc.index
                slot = tool_acc.setdefault(idx, {"id": None, "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        slot["arguments"] += fn.arguments

        tool_calls = [tool_acc[i] for i in sorted(tool_acc)] if tool_acc else []
        assistant_msg = None
        if tool_calls:
            assistant_msg = {
                "role": "assistant",
                "content": "".join(content_parts) or None,
                "tool_calls": [
                    {
                        "id": t["id"],
                        "type": "function",
                        "function": {"name": t["name"], "arguments": t["arguments"]},
                    }
                    for t in tool_calls
                ],
            }
        return assistant_msg, tool_calls

    # 工具调用循环（最多 3 轮，全程流式）
    max_rounds = 3
    for round_i in range(max_rounds):
        assistant_msg, tool_calls = yield from _stream_round(messages, with_tools=True)

        # 不再调用工具：答案已在本轮流式输出完毕
        if not tool_calls:
            yield {"type": "done"}
            return

        messages.append(assistant_msg)
        for t in tool_calls:
            fn_name = t["name"]
            try:
                fn_args = json.loads(t["arguments"]) if t["arguments"] else {}
            except json.JSONDecodeError:
                fn_args = {}
            logger.info(f"Tool call [{round_i+1}/{max_rounds}]: {fn_name}({fn_args})")
            result = execute_tool(task_id, fn_name, fn_args)
            messages.append({
                "role": "tool",
                "tool_call_id": t["id"],
                "content": result,
            })

    # 超过最大轮次，最后一次不带 tools，流式输出
    yield from _stream_round(messages, with_tools=False)
    yield {"type": "done"}
