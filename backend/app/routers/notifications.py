from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.services.user_notification_service import UserNotificationService
from app.utils.response import ResponseWrapper as R


router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
):
    items, total = UserNotificationService.list(
        user_id=current_user.id,
        page=page,
        page_size=page_size,
        unread_only=unread_only,
    )
    return R.success({"items": items, "total": total, "page": page, "page_size": page_size})


@router.get("/unread_count")
def unread_count(current_user: User = Depends(get_current_user)):
    return R.success({"unread": UserNotificationService.unread_count(user_id=current_user.id)})


@router.patch("/{notification_id}/read")
def mark_read(notification_id: int, current_user: User = Depends(get_current_user)):
    item = UserNotificationService.mark_read(user_id=current_user.id, notification_id=notification_id)
    if not item:
        return R.error(msg="通知不存在", code=404)
    return R.success(item)


@router.post("/read_all")
def mark_all_read(current_user: User = Depends(get_current_user)):
    return R.success({"updated": UserNotificationService.mark_all_read(user_id=current_user.id)})
