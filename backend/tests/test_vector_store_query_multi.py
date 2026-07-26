"""VectorStoreManager.query_multi 集成测试 - 走真实 ChromaDB (VECTOR_DB_DIR)"""
import json
import os
import uuid

import pytest

from app.services.vector_store import VectorStoreManager

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def _write_fake_note(task_id: str, title: str, markdown_body: str):
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "markdown": f"## {title}\n\n{markdown_body}",
            "transcript": {"segments": []},
            "audio_meta": {"title": title, "platform": "bilibili"},
        }, f, ensure_ascii=False)
    return path


@pytest.fixture
def two_indexed_tasks():
    store = VectorStoreManager()
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    path_a = _write_fake_note(task_a, "Python 教程", "Python 是一门解释型编程语言，适合初学者入门。")
    path_b = _write_fake_note(task_b, "养猫指南", "猫咪每天需要充足的水和优质猫粮，定期驱虫很重要。")
    store.index_task(task_a)
    store.index_task(task_b)
    yield store, task_a, task_b
    store.delete_index(task_a)
    store.delete_index(task_b)
    os.remove(path_a)
    os.remove(path_b)


def test_query_multi_tags_task_id_and_merges_results(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程语言入门", per_task_n=4, top_k=8)

    assert len(results) > 0
    assert all("task_id" in r["metadata"] for r in results)
    # 至少应命中 task_a（Python 教程）
    assert any(r["metadata"]["task_id"] == task_a for r in results)


def test_query_multi_respects_top_k(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程", per_task_n=4, top_k=2)
    assert len(results) <= 2


def test_query_multi_sorted_by_distance_ascending(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程语言", per_task_n=4, top_k=8)
    distances = [r["distance"] for r in results if r["distance"] is not None]
    assert distances == sorted(distances)


def test_query_multi_ignores_unindexed_task_id(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    fake_task = f"nonexistent-{uuid.uuid4().hex[:8]}"
    # 不应因某个 task_id 没有 collection 而整体报错
    results = store.query_multi([task_a, fake_task], "编程", per_task_n=4, top_k=8)
    assert len(results) > 0
