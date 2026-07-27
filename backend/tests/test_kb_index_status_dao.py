"""kb_index_status_dao.py 集成测试 - 走真实 DB"""
import uuid

import app.db.init_db  # noqa: F401
from app.db.kb_index_status_dao import get_status, set_status, get_statuses


def test_set_and_get_status():
    task_id = f"test-{uuid.uuid4().hex[:8]}"
    assert get_status(task_id) is None

    set_status(task_id, "indexing")
    assert get_status(task_id) == "indexing"

    set_status(task_id, "indexed")
    assert get_status(task_id) == "indexed"


def test_get_statuses_batch():
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    task_c = f"test-{uuid.uuid4().hex[:8]}"  # never indexed

    set_status(task_a, "indexed")
    set_status(task_b, "failed")

    result = get_statuses([task_a, task_b, task_c])
    assert result == {task_a: "indexed", task_b: "failed"}
