import json
import os

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def load_note_title(task_id: str) -> str:
    """读取笔记标题，用于知识库来源标注；读取失败时降级为 task_id 本身。"""
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                rc = json.load(f)
            title = rc.get("audio_meta", {}).get("title", "")
            if title:
                return title
        except Exception:
            pass
    return task_id
