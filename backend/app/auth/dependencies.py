from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import jwt

from app.auth.jwt_handler import decode_access_token
from app.db.engine import get_db
from app.db.models.users import User

bearer_scheme = HTTPBearer()
# auto_error=False: 缺失/格式错误的 Authorization header 不直接抛 403,
# 交给 get_current_user_optional 自行判断返回 None, 用于"登录可选"的接口。
bearer_scheme_optional = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token 无效或已过期",
        )

    user = db.query(User).filter(User.id == user_id, User.is_active == 1).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )
    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme_optional),
    db: Session = Depends(get_db),
) -> User | None:
    """与 get_current_user 相同的解析逻辑, 但未携带 token 或 token 无效/用户不存在时
    返回 None 而不是抛 401。用于登录态可选的接口(部分场景需要登录, 部分不需要)。"""
    if credentials is None:
        return None
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
        return None

    return db.query(User).filter(User.id == user_id, User.is_active == 1).first()


def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """要求当前登录用户是管理员, 否则 403. 用于后台管理接口."""
    if not int(getattr(current_user, "is_admin", 0) or 0):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return current_user
