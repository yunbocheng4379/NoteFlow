"""
管理员: 系统通知 API.

前缀: ``/api/admin/notifications`` (注册时由 app/__init__.py 加 ``/api`` 前缀).

- 仅管理员可访问.
- 通知**不允许物理删除** (没有 DELETE 端点); 管理员通过 status 字段流转状态.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_admin
from app.db.models.notifications import NOTIFICATION_STATUSES
from app.db.models.users import User
from app.services.notification_service import NotificationService
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode


router = APIRouter(prefix="/admin/notifications", tags=["admin-notifications"])


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="handled / closed / ignored")
    handler_note: Optional[str] = Field(None, max_length=2000)


def _validate_status(s: str) -> Optional[dict]:
    if s not in NOTIFICATION_STATUSES:
        return R.error(
            code=StatusCode.PARAM_ERROR,
            msg=f"非法 status: {s}, 允许: {sorted(NOTIFICATION_STATUSES)}",
        )
    return None


@router.get("")
def list_notifications(
    status: Optional[str] = Query(None, description="pending/handled/closed/ignored"),
    category: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    _: User = Depends(get_current_admin),
):
    if status:
        err = _validate_status(status)
        if err:
            return err
    try:
        items, total = NotificationService.list(
            status=status, category=category, platform=platform,
            keyword=keyword, page=page, page_size=page_size,
        )
    except ValueError as e:
        return R.error(code=StatusCode.PARAM_ERROR, msg=str(e))
    return R.success({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/summary")
def summary(_: User = Depends(get_current_admin)):
    """状态计数, 用于面板顶部小卡片."""
    return R.success(NotificationService.count_by_status())


@router.get("/unread_count")
def unread_count(_: User = Depends(get_current_admin)):
    """未读数 (status=pending), 顶栏 badge 用."""
    return R.success({"unread": NotificationService.count_unread()})


@router.get("/{notification_id}")
def get_notification(
    notification_id: int,
    _: User = Depends(get_current_admin),
):
    item = NotificationService.get(notification_id)
    if not item:
        return R.error(msg="通知不存在")
    return R.success(item)


@router.patch("/{notification_id}")
def update_notification_status(
    notification_id: int,
    body: UpdateStatusRequest,
    current_admin: User = Depends(get_current_admin),
):
    err = _validate_status(body.status)
    if err:
        return err
    item = NotificationService.update_status(
        notification_id=notification_id,
        status=body.status,
        handler_note=body.handler_note,
        handled_by=current_admin.id,
    )
    if not item:
        return R.error(msg="通知不存在")
    return R.success(item)
