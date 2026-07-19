import os
import shutil
import uuid

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt_handler import hash_password, verify_password
from app.db.engine import get_db
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/profile", tags=["profile"])

AVATAR_DIR = os.path.join("static", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5 MB


@router.get("")
def get_profile(current_user: User = Depends(get_current_user)):
    return R.success({
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "phone": current_user.phone,
        "avatar": current_user.avatar,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        "last_login_at": current_user.last_login_at.isoformat() if current_user.last_login_at else None,
        "total_points": current_user.total_points,
        "used_points": current_user.used_points,
        "credits": current_user.credits,
        "email_notify_enabled": bool(current_user.email_notify_enabled),
        "system_announce_enabled": bool(current_user.system_announce_enabled),
    })


class UpdateProfileRequest(BaseModel):
    username: str


@router.put("")
def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(body.username) < 3 or len(body.username) > 32:
        raise HTTPException(status_code=400, detail="用户名长度需在 3~32 字符之间")
    existing = db.query(User).filter(
        User.username == body.username, User.id != current_user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已被使用")

    current_user.username = body.username
    db.commit()
    db.refresh(current_user)
    return R.success({"username": current_user.username})


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.put("/password")
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="当前密码错误")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")

    current_user.hashed_password = hash_password(body.new_password)
    db.commit()
    return R.success({"message": "密码修改成功"})


class UpdateNotifyRequest(BaseModel):
    email_notify_enabled: Optional[bool] = None
    system_announce_enabled: Optional[bool] = None


@router.put("/notify")
def update_notify_setting(
    body: UpdateNotifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.email_notify_enabled is not None:
        current_user.email_notify_enabled = 1 if body.email_notify_enabled else 0
    if body.system_announce_enabled is not None:
        current_user.system_announce_enabled = 1 if body.system_announce_enabled else 0
    db.commit()
    return R.success({
        "email_notify_enabled": bool(current_user.email_notify_enabled),
        "system_announce_enabled": bool(current_user.system_announce_enabled),
    })


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG/GIF/WEBP 格式")

    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"
    save_path = os.path.join(AVATAR_DIR, filename)

    with open(save_path, "wb") as f:
        f.write(content)

    # Delete old avatar file if it was a local upload
    if current_user.avatar and current_user.avatar.startswith("/static/avatars/"):
        old_path = current_user.avatar.lstrip("/")
        if os.path.exists(old_path):
            os.remove(old_path)

    avatar_url = f"/static/avatars/{filename}"
    current_user.avatar = avatar_url
    db.commit()

    return R.success({"avatar_url": avatar_url})
