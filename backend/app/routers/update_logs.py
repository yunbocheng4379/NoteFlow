"""
更新日志: 全体登录用户可见 API.

前缀: ``/api/update_logs`` (注册时由 app/__init__.py 加 ``/api`` 前缀).

- 仅返回 ``status in ('active', 'ended')`` 的更新日志, ``pending`` 行对用户完全不可见.
- ``GET /update_logs/active`` 单独返回当前唯一一条 ``active`` 行, 用于顶部横幅.
- 列表分页.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.db import update_log_dao
from app.utils.response import ResponseWrapper as R


router = APIRouter(prefix="/update_logs", tags=["update-logs"])


@router.get("/active")
def get_active_update_log(_: User = Depends(get_current_user)):
    """当前唯一一条 active 行, 用于顶部横幅. 没有则返回 null."""
    item = update_log_dao.get_active()
    return R.success(item)


@router.get("")
def list_update_logs_for_user(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    _: User = Depends(get_current_user),
):
    items, total = update_log_dao.list_for_user(page=page, page_size=page_size)
    return R.success({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/{update_log_id}")
def get_update_log(
    update_log_id: int,
    _: User = Depends(get_current_user),
):
    """单个日志详情; pending 行禁止用户访问, 直接返回 not found."""
    item = update_log_dao.get_by_id(update_log_id)
    if not item or item["status"] == "pending":
        return R.error(msg="更新日志不存在")
    return R.success(item)
