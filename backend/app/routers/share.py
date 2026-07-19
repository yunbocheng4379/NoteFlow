import json
import os

from fastapi import APIRouter, HTTPException

from app.db import note_share_dao
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/share", tags=["share"])

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


@router.get("/status/{task_id}")
def get_share_status(task_id: str):
    """查询某个任务的分享状态（token、是否激活、浏览次数）。"""
    record = note_share_dao.get_by_task_id(task_id)
    if not record:
        return R.success({"is_active": False, "share_token": None, "view_count": 0})
    return R.success({
        "is_active": record.is_active,
        "share_token": record.share_token,
        "view_count": record.view_count,
    })


@router.post("/enable/{task_id}")
def enable_share(task_id: str):
    """开启/恢复分享，返回 share_token。"""
    record = note_share_dao.enable_share(task_id)
    return R.success({
        "is_active": record.is_active,
        "share_token": record.share_token,
        "view_count": record.view_count,
    })


@router.post("/disable/{task_id}")
def disable_share(task_id: str):
    """关闭分享（保留 token 但标记 is_active=False）。"""
    note_share_dao.disable_share(task_id)
    return R.success({"is_active": False})


@router.get("/view/{token}")
def view_shared_note(token: str):
    """公开接口：凭 token 访问已分享的笔记内容，同时自增浏览次数。无需登录。"""
    record = note_share_dao.get_by_token(token)
    if not record or not record.is_active:
        raise HTTPException(status_code=404, detail="分享链接不存在或已关闭")

    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{record.task_id}.json")
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="笔记内容不存在")

    note_share_dao.increment_view(token)

    with open(result_path, "r", encoding="utf-8") as f:
        content = json.load(f)

    return R.success({
        "task_id": record.task_id,
        "share_token": token,
        "view_count": (record.view_count or 0) + 1,
        "note": content,
    })
