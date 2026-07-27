"""kb_note_lookup.py + video_task_dao.get_task_ids_by_user 集成测试 - 走真实 DB/文件系统"""
import json
import os
import uuid

import app.db.init_db  # noqa: F401
from app.db.video_task_dao import insert_video_task, get_task_ids_by_user, delete_task_by_video
from app.services.kb_note_lookup import load_note_title

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def test_get_task_ids_by_user_returns_only_owned_tasks():
    user_id = 999006
    video_id_a = f"video-{uuid.uuid4().hex[:8]}"
    task_id_a = f"test-{uuid.uuid4().hex[:8]}"
    video_id_b = f"video-{uuid.uuid4().hex[:8]}"
    task_id_b = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id_a, platform="bilibili", task_id=task_id_a, user_id=user_id)
    insert_video_task(video_id=video_id_b, platform="bilibili", task_id=task_id_b, user_id=user_id)

    try:
        task_ids = get_task_ids_by_user(user_id)
        assert task_id_a in task_ids
        assert task_id_b in task_ids
    finally:
        delete_task_by_video(video_id_a, "bilibili", user_id=user_id)
        delete_task_by_video(video_id_b, "bilibili", user_id=user_id)


def test_get_task_ids_by_user_returns_empty_list_for_unknown_user():
    user_id = 999007
    assert get_task_ids_by_user(user_id) == []


def test_load_note_title_reads_result_file():
    task_id = f"test-{uuid.uuid4().hex[:8]}"
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"audio_meta": {"title": "测试笔记标题"}}, f, ensure_ascii=False)

    try:
        assert load_note_title(task_id) == "测试笔记标题"
    finally:
        os.remove(path)


def test_load_note_title_falls_back_to_task_id_when_missing():
    fake_task_id = f"nonexistent-{uuid.uuid4().hex[:8]}"
    assert load_note_title(fake_task_id) == fake_task_id
