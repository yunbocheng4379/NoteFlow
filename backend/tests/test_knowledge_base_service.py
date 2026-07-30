"""knowledge_base_service 集成测试 - 走真实 DB；仅在触及真实 LLM 网络调用的边界处打 mock
（gpt.client.chat.completions.create），DB/DAO 层全部走真实调用，遵循本仓库现有测试约定。"""
import json
import uuid
from unittest.mock import MagicMock, patch

import app.db.init_db  # noqa: F401
from app.db import kb_dao
from app.db.kb_index_status_dao import set_status
from app.db.model_dao import delete_model, insert_model
from app.db.provider_dao import delete_provider, insert_provider
from app.db.video_task_dao import insert_video_task, delete_task_by_video
from app.services.knowledge_base_service import (
    _build_context_and_sources,
    _get_indexed_task_ids,
    _resolve_reasoning_mode,
    ask_stream,
    get_index_coverage,
)


def test_get_index_coverage_zero_notes():
    coverage = get_index_coverage(user_id=999006)
    assert coverage == {"total": 0, "indexed": 0}


def test_get_index_coverage_counts_indexed_subset():
    user_id = 999007
    video_id_a = f"video-{uuid.uuid4().hex[:8]}"
    video_id_b = f"video-{uuid.uuid4().hex[:8]}"
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id_a, platform="bilibili", task_id=task_a, user_id=user_id)
    insert_video_task(video_id=video_id_b, platform="bilibili", task_id=task_b, user_id=user_id)
    set_status(task_a, "indexed")
    set_status(task_b, "failed")

    try:
        coverage = get_index_coverage(user_id)
        assert coverage == {"total": 2, "indexed": 1}
    finally:
        delete_task_by_video(video_id_a, "bilibili", user_id=user_id)
        delete_task_by_video(video_id_b, "bilibili", user_id=user_id)


def test_get_index_coverage_repairs_missing_status_when_vector_exists():
    fake_store = MagicMock()
    fake_store.is_indexed.return_value = True

    with patch("app.services.knowledge_base_service.get_task_ids_by_user", return_value=["task-a"]), \
            patch("app.services.knowledge_base_service.get_index_statuses", return_value={}), \
            patch("app.services.knowledge_base_service.VectorStoreManager", return_value=fake_store), \
            patch("app.services.knowledge_base_service.set_index_status") as set_status, \
            patch("app.services.knowledge_base_service._start_backfill") as start_backfill:
        coverage = get_index_coverage(user_id=1)

    assert coverage == {"total": 1, "indexed": 1}
    fake_store.is_indexed.assert_called_once_with("task-a")
    set_status.assert_called_once_with("task-a", "indexed")
    start_backfill.assert_called_once_with([])


def test_get_index_coverage_backfills_missing_vector_index():
    fake_store = MagicMock()
    fake_store.is_indexed.return_value = False

    with patch("app.services.knowledge_base_service.get_task_ids_by_user", return_value=["task-a"]), \
            patch("app.services.knowledge_base_service.get_index_statuses", return_value={}), \
            patch("app.services.knowledge_base_service.VectorStoreManager", return_value=fake_store), \
            patch("app.services.knowledge_base_service.set_index_status") as set_status, \
            patch("app.services.knowledge_base_service._start_backfill") as start_backfill:
        coverage = get_index_coverage(user_id=1)

    assert coverage == {"total": 1, "indexed": 0}
    fake_store.is_indexed.assert_called_once_with("task-a")
    set_status.assert_called_once_with("task-a", "indexing")
    start_backfill.assert_called_once_with(["task-a"])


def test_get_index_coverage_retries_failed_vector_index():
    fake_store = MagicMock()
    fake_store.is_indexed.return_value = False

    with patch("app.services.knowledge_base_service.get_task_ids_by_user", return_value=["task-a"]), \
            patch("app.services.knowledge_base_service.get_index_statuses", return_value={"task-a": "failed"}), \
            patch("app.services.knowledge_base_service.VectorStoreManager", return_value=fake_store), \
            patch("app.services.knowledge_base_service.set_index_status") as set_status, \
            patch("app.services.knowledge_base_service._start_backfill") as start_backfill:
        coverage = get_index_coverage(user_id=1)

    assert coverage == {"total": 1, "indexed": 0}
    fake_store.is_indexed.assert_called_once_with("task-a")
    set_status.assert_called_once_with("task-a", "indexing")
    start_backfill.assert_called_once_with(["task-a"])


def test_get_indexed_task_ids_scopes_to_requested_subset():
    """传入 note_task_ids 时只返回该子集内已索引的部分，且过滤掉不属于该用户的 task_id。"""
    user_id = 999014
    video_id_a = f"video-{uuid.uuid4().hex[:8]}"
    video_id_b = f"video-{uuid.uuid4().hex[:8]}"
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id_a, platform="bilibili", task_id=task_a, user_id=user_id)
    insert_video_task(video_id=video_id_b, platform="bilibili", task_id=task_b, user_id=user_id)
    set_status(task_a, "indexed")
    set_status(task_b, "indexed")

    try:
        # 只请求 task_a，且混入一个不属于该用户的伪造 task_id，应被过滤掉
        result = _get_indexed_task_ids(user_id, task_ids=[task_a, "not-owned-task"])
        assert result == [task_a]
    finally:
        delete_task_by_video(video_id_a, "bilibili", user_id=user_id)
        delete_task_by_video(video_id_b, "bilibili", user_id=user_id)


def test_build_sources_dedupes_chunks_from_same_note():
    """一篇笔记召回多个片段时，引用来源应按笔记去重。"""
    chunks = [
        {"text": "第一段相关内容", "metadata": {"task_id": "task-a", "source_type": "markdown"}},
        {"text": "第二段相关内容", "metadata": {"task_id": "task-a", "source_type": "transcript"}},
        {"text": "第三段相关内容", "metadata": {"task_id": "task-a", "source_type": "meta"}},
    ]

    with patch("app.services.knowledge_base_service.load_note_title", return_value="测试笔记"):
        context, sources = _build_context_and_sources(chunks)

    assert context.count("笔记《测试笔记》") == 3
    assert sources == [
        {
            "task_id": "task-a",
            "title": "测试笔记",
            "text": "第一段相关内容",
            "source_type": "markdown",
        }
    ]


def _make_provider_and_model(model_name: str, supports_reasoning: int):
    provider_id = f"prov-{uuid.uuid4().hex[:8]}"
    insert_provider(
        id=provider_id, name="TestProvider", api_key="sk-test", base_url="https://example.invalid/v1",
        logo="", type_="openai",
    )
    model = insert_model(provider_id=provider_id, model_name=model_name, supports_reasoning=supports_reasoning)
    return provider_id, model


def test_resolve_reasoning_mode_disabled_when_thinking_off():
    provider_id, model = _make_provider_and_model("deepseek-reasoner", supports_reasoning=1)
    try:
        assert _resolve_reasoning_mode(provider_id, "deepseek-reasoner", enable_thinking=False) is None
    finally:
        delete_model(model["id"])
        delete_provider(provider_id)


def test_resolve_reasoning_mode_disabled_when_model_does_not_support_reasoning():
    provider_id, model = _make_provider_and_model("gpt-4o", supports_reasoning=0)
    try:
        assert _resolve_reasoning_mode(provider_id, "gpt-4o", enable_thinking=True) is None
    finally:
        delete_model(model["id"])
        delete_provider(provider_id)


def test_resolve_reasoning_mode_native_for_deepseek_reasoner():
    provider_id, model = _make_provider_and_model("deepseek-reasoner", supports_reasoning=1)
    try:
        assert _resolve_reasoning_mode(provider_id, "deepseek-reasoner", enable_thinking=True) == "native"
    finally:
        delete_model(model["id"])
        delete_provider(provider_id)


def test_resolve_reasoning_mode_extra_body_for_qwen_thinking():
    provider_id, model = _make_provider_and_model("qwen-plus-thinking", supports_reasoning=1)
    try:
        assert _resolve_reasoning_mode(provider_id, "qwen-plus-thinking", enable_thinking=True) == "extra_body"
    finally:
        delete_model(model["id"])
        delete_provider(provider_id)


class _FakeDelta:
    """模拟 openai SDK 的流式 delta 对象；只在传入时才带 reasoning_content 属性，
    模拟 extra="allow" 场景下未声明字段时 getattr(..., None) 的安全取值行为。"""

    def __init__(self, content=None, reasoning_content=None):
        self.content = content
        if reasoning_content is not None:
            self.reasoning_content = reasoning_content


class _FakeChoice:
    def __init__(self, delta):
        self.delta = delta


class _FakePiece:
    def __init__(self, delta):
        self.choices = [_FakeChoice(delta)]


class _FakeGPT:
    def __init__(self, completion_pieces):
        self.model = "fake-model"
        self.client = MagicMock()
        self.client.chat.completions.create.return_value = iter(completion_pieces)


def test_ask_stream_first_question_backfills_title_and_persists_assistant_message():
    provider_id, model = _make_provider_and_model("gpt-4o", supports_reasoning=0)
    conv = kb_dao.create_conversation(user_id=999008)
    fake_gpt = _FakeGPT([
        _FakePiece(_FakeDelta(content="你好")),
        _FakePiece(_FakeDelta(content="，世界")),
    ])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            events = list(ask_stream(
                conversation_id=conv["id"],
                question="这是我的第一个问题，问一些关于笔记内容的东西",
                provider_id=provider_id,
                model_name="gpt-4o",
                enable_thinking=False,
                user_id=999008,
            ))

        assert events[0] == {"type": "sources", "sources": []}
        delta_events = [e for e in events if e["type"] == "delta"]
        assert [e["content"] for e in delta_events] == ["你好", "，世界"]
        assert not any(e["type"] == "reasoning" for e in events)
        done_events = [e for e in events if e["type"] == "done"]
        assert len(done_events) == 1
        message_id = done_events[0]["message_id"]

        messages = kb_dao.list_messages(conv["id"])
        assert [m["role"] for m in messages] == ["user", "assistant"]
        assert messages[1]["id"] == message_id
        assert messages[1]["content"] == "你好，世界"
        assert messages[1]["reasoning_content"] is None

        updated_conv = kb_dao.get_conversation(conv["id"], user_id=999008)
        assert updated_conv["title"] == "这是我的第一个问题，问一些关于笔记内容的东西"[:30]
        assert updated_conv["provider_id"] == provider_id
        assert updated_conv["model_name"] == "gpt-4o"
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999008)
        delete_model(model["id"])
        delete_provider(provider_id)


def test_ask_stream_second_question_does_not_overwrite_title():
    provider_id, model = _make_provider_and_model("gpt-4o", supports_reasoning=0)
    conv = kb_dao.create_conversation(user_id=999009)
    kb_dao.update_conversation_meta(conv["id"], title="已有标题")
    kb_dao.add_message(conv["id"], "user", "第一轮问题")
    kb_dao.add_message(conv["id"], "assistant", "第一轮回答")

    fake_gpt = _FakeGPT([_FakePiece(_FakeDelta(content="第二轮回答"))])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            list(ask_stream(
                conversation_id=conv["id"],
                question="第二轮问题",
                provider_id=provider_id,
                model_name="gpt-4o",
                enable_thinking=False,
                user_id=999009,
            ))

        updated_conv = kb_dao.get_conversation(conv["id"], user_id=999009)
        assert updated_conv["title"] == "已有标题"
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999009)
        delete_model(model["id"])
        delete_provider(provider_id)


def test_ask_stream_yields_reasoning_before_delta_when_enabled():
    provider_id, model = _make_provider_and_model("deepseek-reasoner", supports_reasoning=1)
    conv = kb_dao.create_conversation(user_id=999010)
    fake_gpt = _FakeGPT([
        _FakePiece(_FakeDelta(content=None, reasoning_content="思考中...")),
        _FakePiece(_FakeDelta(content="最终答案")),
    ])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            events = list(ask_stream(
                conversation_id=conv["id"],
                question="需要深度思考的问题",
                provider_id=provider_id,
                model_name="deepseek-reasoner",
                enable_thinking=True,
                user_id=999010,
            ))

        types_in_order = [e["type"] for e in events]
        assert types_in_order == ["sources", "reasoning", "delta", "done"]

        messages = kb_dao.list_messages(conv["id"])
        assert messages[1]["reasoning_content"] == "思考中..."
        assert messages[1]["content"] == "最终答案"
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999010)
        delete_model(model["id"])
        delete_provider(provider_id)


def test_ask_stream_no_reasoning_params_when_thinking_disabled():
    """深度思考关闭时不应读取/传递 reasoning 相关参数，即便 delta 上恰好带有该字段。"""
    provider_id, model = _make_provider_and_model("deepseek-reasoner", supports_reasoning=1)
    conv = kb_dao.create_conversation(user_id=999011)
    fake_gpt = _FakeGPT([
        _FakePiece(_FakeDelta(content="答案", reasoning_content="不应被读取")),
    ])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            events = list(ask_stream(
                conversation_id=conv["id"],
                question="普通问题",
                provider_id=provider_id,
                model_name="deepseek-reasoner",
                enable_thinking=False,
                user_id=999011,
            ))

        assert not any(e["type"] == "reasoning" for e in events)
        create_kwargs = fake_gpt.client.chat.completions.create.call_args.kwargs
        assert "extra_body" not in create_kwargs
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999011)
        delete_model(model["id"])
        delete_provider(provider_id)


def test_ask_stream_qwen_thinking_passes_extra_body():
    provider_id, model = _make_provider_and_model("qwen-plus-thinking", supports_reasoning=1)
    conv = kb_dao.create_conversation(user_id=999012)
    fake_gpt = _FakeGPT([_FakePiece(_FakeDelta(content="答案"))])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            list(ask_stream(
                conversation_id=conv["id"],
                question="qwen 问题",
                provider_id=provider_id,
                model_name="qwen-plus-thinking",
                enable_thinking=True,
                user_id=999012,
            ))

        create_kwargs = fake_gpt.client.chat.completions.create.call_args.kwargs
        assert create_kwargs.get("extra_body") == {"enable_thinking": True}
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999012)
        delete_model(model["id"])
        delete_provider(provider_id)


def test_ask_stream_note_task_ids_scopes_retrieval():
    """传入 note_task_ids 时，query_multi 只用交集后的子集调用，而不是用户全部笔记。"""
    user_id = 999015
    video_id_a = f"video-{uuid.uuid4().hex[:8]}"
    video_id_b = f"video-{uuid.uuid4().hex[:8]}"
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id_a, platform="bilibili", task_id=task_a, user_id=user_id)
    insert_video_task(video_id=video_id_b, platform="bilibili", task_id=task_b, user_id=user_id)
    set_status(task_a, "indexed")
    set_status(task_b, "indexed")

    provider_id, model = _make_provider_and_model("gpt-4o", supports_reasoning=0)
    conv = kb_dao.create_conversation(user_id=user_id)
    fake_gpt = _FakeGPT([_FakePiece(_FakeDelta(content="答案"))])
    fake_store = MagicMock()
    fake_store.query_multi.return_value = []
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt), \
             patch("app.services.knowledge_base_service.VectorStoreManager", return_value=fake_store):
            list(ask_stream(
                conversation_id=conv["id"],
                question="只问 task_a 相关的内容",
                provider_id=provider_id,
                model_name="gpt-4o",
                enable_thinking=False,
                user_id=user_id,
                note_task_ids=[task_a],
            ))

        fake_store.query_multi.assert_called_once()
        called_task_ids = fake_store.query_multi.call_args.args[0]
        assert called_task_ids == [task_a]
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=user_id)
        delete_model(model["id"])
        delete_provider(provider_id)
        delete_task_by_video(video_id_a, "bilibili", user_id=user_id)
        delete_task_by_video(video_id_b, "bilibili", user_id=user_id)


def test_ask_stream_history_excludes_reasoning_content_from_context():
    """构建 LLM messages 时历史消息只带 content，不带 reasoning_content。"""
    provider_id, model = _make_provider_and_model("gpt-4o", supports_reasoning=0)
    conv = kb_dao.create_conversation(user_id=999013)
    kb_dao.add_message(conv["id"], "user", "上一轮问题")
    kb_dao.add_message(conv["id"], "assistant", "上一轮答案", reasoning_content="上一轮思考过程，不应进入上下文")

    fake_gpt = _FakeGPT([_FakePiece(_FakeDelta(content="新答案"))])
    try:
        with patch("app.services.knowledge_base_service.GPTFactory.from_config", return_value=fake_gpt):
            list(ask_stream(
                conversation_id=conv["id"],
                question="新问题",
                provider_id=provider_id,
                model_name="gpt-4o",
                enable_thinking=False,
                user_id=999013,
            ))

        create_kwargs = fake_gpt.client.chat.completions.create.call_args.kwargs
        messages = create_kwargs["messages"]
        joined = json.dumps(messages, ensure_ascii=False)
        assert "上一轮思考过程" not in joined
        assert any(m["content"] == "上一轮答案" for m in messages if m["role"] == "assistant")
    finally:
        kb_dao.delete_conversation(conv["id"], user_id=999013)
        delete_model(model["id"])
        delete_provider(provider_id)
