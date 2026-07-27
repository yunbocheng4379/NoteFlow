"""VectorStoreManager.query_multi 集成测试 - 使用 tmp_path 隔离的 ChromaDB/笔记目录，
不触碰真实的 VECTOR_DB_DIR / NOTE_OUTPUT_DIR。"""
import json
import os
import uuid

import pytest

from app.services import vector_store as vector_store_module
from app.services.vector_store import VectorStoreManager


def _write_fake_note(note_dir: str, task_id: str, title: str, markdown_body: str):
    os.makedirs(note_dir, exist_ok=True)
    path = os.path.join(note_dir, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "markdown": f"## {title}\n\n{markdown_body}",
            "transcript": {"segments": []},
            "audio_meta": {"title": title, "platform": "bilibili"},
        }, f, ensure_ascii=False)
    return path


@pytest.fixture
def two_indexed_tasks(tmp_path, monkeypatch):
    """在 tmp_path 下隔离出笔记目录和向量库目录，避免污染真实数据。"""
    note_dir = str(tmp_path / "note_results")
    vector_dir = str(tmp_path / "vector_db")
    # NOTE_OUTPUT_DIR / VECTOR_DB_DIR 是模块级常量，在 import 时读取一次 os.getenv，
    # VectorStoreManager.__init__ 直接引用模块全局变量，因此需要 monkeypatch.setattr
    # 到模块对象上，而不是 monkeypatch.setenv（后者对已导入的模块无效）。
    monkeypatch.setattr(vector_store_module, "NOTE_OUTPUT_DIR", note_dir)
    monkeypatch.setattr(vector_store_module, "VECTOR_DB_DIR", vector_dir)

    store = VectorStoreManager()
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    _write_fake_note(note_dir, task_a, "Python 教程", "Python 是一门解释型编程语言，适合初学者入门。")
    _write_fake_note(note_dir, task_b, "养猫指南", "猫咪每天需要充足的水和优质猫粮，定期驱虫很重要。")

    try:
        store.index_task(task_a)
        store.index_task(task_b)
        yield store, task_a, task_b
    finally:
        # 保证即使 index_task 中途失败，已建立的 collection 也会被清理；
        # delete_index 内部已对不存在的 collection 静默忽略异常。
        # 由于 vector_dir/note_dir 均在 tmp_path 内，pytest 会自动回收目录本身，
        # 这里仍显式清理 ChromaDB collection 以防止其状态残留在进程内的 client 缓存中。
        store.delete_index(task_a)
        store.delete_index(task_b)


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
