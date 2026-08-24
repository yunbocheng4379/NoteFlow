from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.db.note_style_dao import (
    get_styles,
    get_style_by_value,
    create_style,
    update_style,
    delete_style,
    toggle_public,
)
from app.services.note_style_moderation_service import NoteStyleModerationError, NoteStyleModerationService
from app.utils.response import ResponseWrapper as R

router = APIRouter()


class CreateStyleRequest(BaseModel):
    name: str = Field(..., max_length=50)
    value: str = Field(..., max_length=64)
    description: Optional[str] = Field(None, max_length=200)
    prompt: str = Field(..., max_length=2000)
    is_public: bool = False
    icon: Optional[str] = Field(None, max_length=32)


class UpdateStyleRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=200)
    prompt: Optional[str] = Field(None, max_length=2000)
    is_public: Optional[bool] = None
    icon: Optional[str] = Field(None, max_length=32)


@router.get("/note_styles")
def list_styles(
    category: Optional[str] = None,
    keyword: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    styles = get_styles(user_id=current_user.id, category=category, keyword=keyword)
    return R.success(data=styles)


@router.get("/note_styles/value/{value}")
def get_style_value(value: str, current_user: User = Depends(get_current_user)):
    style = get_style_by_value(value, user_id=current_user.id)
    return R.success(data=style)


@router.post("/note_styles")
def create_note_style(
    data: CreateStyleRequest,
    current_user: User = Depends(get_current_user),
):
    style = create_style(
        name=data.name,
        value=data.value,
        prompt=data.prompt,
        user_id=current_user.id,
        description=data.description,
        is_public=False,
        icon=data.icon,
    )
    if data.is_public:
        try:
            style = NoteStyleModerationService.submit(style_id=style["id"], user_id=current_user.id)
        except NoteStyleModerationError as exc:
            return R.error(msg=str(exc), code=400)
    return R.success(data=style)


@router.put("/note_styles/{style_id}")
def update_note_style(
    style_id: int,
    data: UpdateStyleRequest,
    current_user: User = Depends(get_current_user),
):
    updated = update_style(
        style_id=style_id,
        user_id=current_user.id,
        is_admin=False,
        name=data.name,
        description=data.description,
        prompt=data.prompt,
        icon=data.icon,
    )
    if updated is None:
        return R.error(msg="样式不存在或无权操作", code=404)
    try:
        if data.is_public is True:
            updated = NoteStyleModerationService.submit(style_id=style_id, user_id=current_user.id)
        elif data.is_public is False and updated.get("is_public"):
            updated = toggle_public(style_id=style_id, user_id=current_user.id, is_public=False)
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)
    return R.success(data=updated)


@router.delete("/note_styles/{style_id}")
def delete_note_style(
    style_id: int,
    current_user: User = Depends(get_current_user),
):
    ok = delete_style(
        style_id=style_id,
        user_id=current_user.id,
        is_admin=False,
    )
    if not ok:
        return R.error(msg="样式不存在或无权操作", code=404)
    return R.success(data=None)


@router.patch("/note_styles/{style_id}/public")
def patch_public(
    style_id: int,
    is_public: bool,
    current_user: User = Depends(get_current_user),
):
    try:
        if is_public:
            updated = NoteStyleModerationService.submit(style_id=style_id, user_id=current_user.id)
        else:
            updated = toggle_public(style_id=style_id, user_id=current_user.id, is_public=False)
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)
    if updated is None:
        return R.error(msg="样式不存在或无权操作", code=404)
    return R.success(data=updated)


@router.post("/note_styles/{style_id}/submit")
def submit_note_style(style_id: int, current_user: User = Depends(get_current_user)):
    try:
        return R.success(data=NoteStyleModerationService.submit(style_id=style_id, user_id=current_user.id))
    except NoteStyleModerationError as exc:
        return R.error(msg=str(exc), code=400)
