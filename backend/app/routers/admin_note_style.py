from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_admin
from app.db.models.users import User
from app.services.note_style_moderation_service import NoteStyleModerationError, NoteStyleModerationService
from app.utils.response import ResponseWrapper as R


router = APIRouter(prefix="/admin/note_styles", tags=["admin-note-styles"])


class ReasonRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


@router.get("")
def list_note_styles(
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(get_current_admin),
):
    items, total = NoteStyleModerationService.list_admin(
        status=status, keyword=keyword, page=page, page_size=page_size
    )
    return R.success({"items": items, "total": total, "page": page, "page_size": page_size})


@router.get("/summary")
def note_style_summary(_: User = Depends(get_current_admin)):
    return R.success({"pending_review": NoteStyleModerationService.pending_count()})


@router.get("/{style_id}")
def get_note_style_detail(style_id: int, _: User = Depends(get_current_admin)):
    try:
        return R.success(NoteStyleModerationService.detail(style_id))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=404)


@router.post("/{style_id}/approve")
def approve_note_style(style_id: int, current_admin: User = Depends(get_current_admin)):
    try:
        return R.success(NoteStyleModerationService.approve(style_id, current_admin.id))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)


@router.post("/{style_id}/reject")
def reject_note_style(style_id: int, body: ReasonRequest, current_admin: User = Depends(get_current_admin)):
    try:
        return R.success(NoteStyleModerationService.reject(style_id, current_admin.id, body.reason))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)


@router.post("/{style_id}/unpublish")
def unpublish_note_style(style_id: int, body: ReasonRequest, current_admin: User = Depends(get_current_admin)):
    try:
        return R.success(NoteStyleModerationService.unpublish(style_id, current_admin.id, body.reason))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)


@router.post("/{style_id}/republish")
def republish_note_style(style_id: int, current_admin: User = Depends(get_current_admin)):
    try:
        return R.success(NoteStyleModerationService.republish(style_id, current_admin.id))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)
