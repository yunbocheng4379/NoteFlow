import json
import os

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user
from app.db import note_share_dao, collection_share_dao, note_collection_dao
from app.db.models.users import User
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


@router.get("/collection_status/{collection_id}")
def get_collection_share_status(collection_id: int, current_user: User = Depends(get_current_user)):
    """查询某个合集的分享状态（token、是否激活、浏览次数）。"""
    record = collection_share_dao.get_by_collection_id(collection_id)
    if not record:
        return R.success({"is_active": False, "share_token": None, "view_count": 0})
    return R.success({
        "is_active": record.is_active,
        "share_token": record.share_token,
        "view_count": record.view_count,
    })


@router.post("/collection_enable/{collection_id}")
def enable_collection_share(collection_id: int, current_user: User = Depends(get_current_user)):
    """开启/恢复合集分享，返回 share_token。"""
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if collection is None:
        raise HTTPException(status_code=404, detail="合集不存在或无权限操作")
    record = collection_share_dao.enable_share(collection_id, current_user.id)
    return R.success({
        "is_active": record.is_active,
        "share_token": record.share_token,
        "view_count": record.view_count,
    })


@router.post("/collection_disable/{collection_id}")
def disable_collection_share(collection_id: int, current_user: User = Depends(get_current_user)):
    """关闭合集分享（保留 token 但标记 is_active=False）。"""
    collection = note_collection_dao.get_collection(collection_id, current_user.id)
    if collection is None:
        raise HTTPException(status_code=404, detail="合集不存在或无权限操作")
    collection_share_dao.disable_share(collection_id)
    return R.success({"is_active": False})


@router.get("/collection_view/{token}")
def view_shared_collection(token: str):
    """公开接口：凭 token 访问已分享的合集内所有笔记内容，同时自增浏览次数。无需登录。"""
    record = collection_share_dao.get_by_token(token)
    if not record or not record.is_active:
        raise HTTPException(status_code=404, detail="分享链接不存在或已关闭")

    collection = note_collection_dao.get_collection(record.collection_id, record.user_id)
    if collection is None:
        raise HTTPException(status_code=404, detail="合集不存在")

    task_ids = note_collection_dao.get_item_task_ids(record.collection_id, record.user_id) or []

    notes = []
    for task_id in task_ids:
        result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
        if not os.path.exists(result_path):
            continue
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                content = json.load(f)
            notes.append({"task_id": task_id, "note": content})
        except Exception:
            continue

    collection_share_dao.increment_view(token)

    return R.success({
        "collection": {
            "id": collection["id"],
            "name": collection["name"],
            "description": collection["description"],
            "cover_url": collection["cover_url"],
        },
        "share_token": token,
        "view_count": (record.view_count or 0) + 1,
        "notes": notes,
    })
