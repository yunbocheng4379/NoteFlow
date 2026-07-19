"""
用户等级 (tier) 计算 — 用于 Cookie 池按用户分组配额.

定义:
- ``admin``  管理员 (is_admin=1)
- ``user``   普通用户 (默认)

预留扩展: 后续接入 ``active_subscription_id`` 时, 可在此加订阅型 tier
(如 'vip' / 'svip' / 'team'). 当前 schema 里 subscriptions 还没完善, 暂简单化.
"""
from __future__ import annotations

from typing import Optional

from app.db.engine import get_db
from app.db.models.users import User


def get_user_tier(user_id: Optional[int]) -> str:
    """返回用户的 effective tier. 匿名访客 → 'user'. 不存在 → 'user'."""
    if not user_id:
        return "user"
    db = next(get_db())
    try:
        row = db.query(User).filter(User.id == user_id).first()
        if not row:
            return "user"
        if row.is_admin:
            return "admin"
        return "user"
    finally:
        db.close()
