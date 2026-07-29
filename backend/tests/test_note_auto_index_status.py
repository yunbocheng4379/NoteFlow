"""笔记生成/编辑后的知识库自动索引状态同步测试。"""
from unittest.mock import MagicMock, patch

from app.routers.note import _index_note_for_kb


def test_index_note_for_kb_marks_indexed_after_success():
    fake_store = MagicMock()

    with patch("app.db.kb_index_status_dao.set_status") as set_status, patch(
        "app.services.vector_store.VectorStoreManager",
        return_value=fake_store,
    ):
        _index_note_for_kb("task-ok")

    assert [call.args for call in set_status.call_args_list] == [
        ("task-ok", "indexing"),
        ("task-ok", "indexed"),
    ]
    fake_store.index_task.assert_called_once_with("task-ok")


def test_index_note_for_kb_marks_failed_when_indexing_errors():
    fake_store = MagicMock()
    fake_store.index_task.side_effect = RuntimeError("vector db unavailable")

    with patch("app.db.kb_index_status_dao.set_status") as set_status, patch(
        "app.services.vector_store.VectorStoreManager",
        return_value=fake_store,
    ):
        _index_note_for_kb("task-failed")

    assert [call.args for call in set_status.call_args_list] == [
        ("task-failed", "indexing"),
        ("task-failed", "failed"),
    ]
    fake_store.index_task.assert_called_once_with("task-failed")
