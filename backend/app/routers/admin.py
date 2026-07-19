"""
后台管理 API (仅管理员可访问)
================================
用户管理: 列表 (含核心权益/电力聚合) / 新增 / (软) 删除 / 批量软删除.

所有接口都依赖 get_current_admin, 非管理员返回 403.
删除采用「软删除」: 置 is_active=0, 保留审计流水 (credit_transactions) 与订单/订阅记录.
"""
import math
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.auth.jwt_handler import hash_password
from app.db.engine import get_db
from app.db.models.users import User
from app.db.models.credit_transactions import CreditTransaction
from app.db.models.subscriptions import Subscription
from app.db.models.subscription_plans import SubscriptionPlan
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

router = APIRouter(prefix="/admin", tags=["admin"])


# ============================================================================
# 聚合工具: 一次性把「一页用户」的充值总额 / 消耗总额算出来 (避免 N+1)
# ============================================================================
def _aggregate_credit_stats(db: Session, user_ids: list[int]) -> dict[int, dict]:
    """
    返回 { user_id: {"total_recharged": x, "total_consumed": y} }.
    - total_recharged: 所有「加电」正向流水之和 (充值/会员发放/注册赠送/推荐奖励/管理员加).
      即除 CONSUME/REFUND 外的正数 amount 之和.
    - total_consumed:  所有 CONSUME 的扣减量 (取绝对值) 之和.
    """
    if not user_ids:
        return {}

    stats: dict[int, dict] = {uid: {"total_recharged": 0, "total_consumed": 0} for uid in user_ids}

    # 消耗总额: SUM(-amount) WHERE type='CONSUME'
    consumed_rows = db.execute(
        select(
            CreditTransaction.user_id,
            func.coalesce(func.sum(-CreditTransaction.amount), 0),
        )
        .where(
            CreditTransaction.user_id.in_(user_ids),
            CreditTransaction.type == "CONSUME",
        )
        .group_by(CreditTransaction.user_id)
    ).all()
    for uid, total in consumed_rows:
        stats[uid]["total_consumed"] = int(total or 0)

    # 到账 (加电) 总额: SUM(amount) WHERE amount > 0 AND type NOT IN (CONSUME, REFUND)
    recharged_rows = db.execute(
        select(
            CreditTransaction.user_id,
            func.coalesce(func.sum(CreditTransaction.amount), 0),
        )
        .where(
            CreditTransaction.user_id.in_(user_ids),
            CreditTransaction.amount > 0,
            CreditTransaction.type.notin_(("CONSUME", "REFUND")),
        )
        .group_by(CreditTransaction.user_id)
    ).all()
    for uid, total in recharged_rows:
        stats[uid]["total_recharged"] = int(total or 0)

    return stats


def _subscription_info(db: Session, user: User) -> Optional[dict]:
    """当前生效会员信息 (无 / 已过期返回 None)."""
    if not user.active_subscription_id:
        return None
    sub = db.get(Subscription, user.active_subscription_id)
    if not sub or sub.status != "ACTIVE":
        return None
    plan = db.get(SubscriptionPlan, sub.plan_id)
    days_left = 0
    if sub.end_at:
        remaining = (sub.end_at - datetime.now()).total_seconds()
        days_left = int(max(0, math.ceil(remaining / 86400))) if remaining > 0 else 0
    return {
        "plan_code": plan.code if plan else None,
        "plan_name": plan.name if plan else None,
        "start_at": sub.start_at.isoformat() if sub.start_at else None,
        "end_at": sub.end_at.isoformat() if sub.end_at else None,
        "days_left": days_left,
    }


def _serialize_user(db: Session, user: User, stats: dict) -> dict:
    sub = _subscription_info(db, user)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar": user.avatar,
        "is_active": int(user.is_active or 0),
        "is_admin": int(user.is_admin or 0),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        # 电力核心数据
        "credits": int(user.credits or 0),           # 当前剩余电力
        "total_recharged": stats.get("total_recharged", 0),  # 累计到账 (充值+赠送+发放...)
        "total_consumed": stats.get("total_consumed", 0),    # 累计消耗
        # 会员权益
        "is_member": sub is not None,
        "subscription": sub,
    }


# ============================================================================
# 列表
# ============================================================================
@router.get("/users")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = Query(None, description="按用户名/邮箱模糊搜索"),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """用户列表 (分页 + 关键词搜索), 每条附带电力聚合与会员信息."""
    base = select(User)
    count_base = select(func.count(User.id))

    if keyword:
        like = f"%{keyword.strip()}%"
        cond = or_(User.username.like(like), User.email.like(like))
        base = base.where(cond)
        count_base = count_base.where(cond)

    total = db.execute(count_base).scalar() or 0
    offset = (page - 1) * page_size
    users = db.execute(
        base.order_by(User.created_at.desc(), User.id.desc()).offset(offset).limit(page_size)
    ).scalars().all()

    user_ids = [u.id for u in users]
    agg = _aggregate_credit_stats(db, user_ids)

    return R.success({
        "list": [_serialize_user(db, u, agg.get(u.id, {})) for u in users],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    })


# ============================================================================
# 新增
# ============================================================================
class CreateUserRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    is_admin: bool = False
    initial_credits: int = 0  # 可选: 新增时直接发放的初始电力 (走 ledger 审计)

    @field_validator("username")
    @classmethod
    def username_length(cls, v):
        if len(v) < 3 or len(v) > 32:
            raise ValueError("用户名长度需在 3~32 字符之间")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v

    @field_validator("initial_credits")
    @classmethod
    def credits_nonneg(cls, v):
        if v < 0:
            raise ValueError("初始电力不能为负")
        return v


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员新增用户. 生成邀请码, 可选发放初始电力 (经 ledger 审计)."""
    from app.services.billing import credit_ledger, referral_service

    if db.query(User).filter(User.username == body.username).first():
        return R.error(code=StatusCode.USERNAME_EXISTS, msg="用户名已存在")
    if db.query(User).filter(User.email == body.email).first():
        return R.error(code=StatusCode.EMAIL_EXISTS, msg="邮箱已被注册")

    try:
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            credits=0,
            total_points=0,
            used_points=0,
            is_admin=1 if body.is_admin else 0,
        )
        db.add(user)
        db.flush()  # 拿 user.id

        referral_service.generate_referral_code(db, user.id)

        if body.initial_credits > 0:
            credit_ledger.grant(
                db,
                user_id=user.id,
                amount=body.initial_credits,
                type_="ADMIN_ADJUST",
                note="管理员新增用户时发放初始电力",
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    agg = _aggregate_credit_stats(db, [user.id])
    return R.success(_serialize_user(db, user, agg.get(user.id, {})))


# ============================================================================
# 软删除 (单个 / 批量)
# ============================================================================
class BatchDeleteRequest(BaseModel):
    user_ids: list[int]


def _soft_delete_users(db: Session, admin_id: int, user_ids: list[int]) -> tuple[int, list[int]]:
    """
    把 user_ids 置为 is_active=0. 跳过: 管理员自己 / 其他管理员账号.
    返回 (成功数, 被跳过的 id 列表).
    """
    skipped: list[int] = []
    affected = 0
    for uid in user_ids:
        if uid == admin_id:
            skipped.append(uid)  # 不允许删自己
            continue
        u = db.get(User, uid)
        if not u:
            skipped.append(uid)
            continue
        if int(u.is_admin or 0):
            skipped.append(uid)  # 不允许删其他管理员
            continue
        if int(u.is_active or 0) == 0:
            continue  # 已停用, 幂等跳过 (不计入 skipped)
        u.is_active = 0
        affected += 1
    db.flush()
    return affected, skipped


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """软删除单个用户 (停用). 不能删除自己或其他管理员."""
    if user_id == current_admin.id:
        return R.error(msg="不能删除当前登录的管理员账号")
    target = db.get(User, user_id)
    if not target:
        return R.error(msg="用户不存在")
    if int(target.is_admin or 0):
        return R.error(msg="不能删除管理员账号")

    try:
        affected, _ = _soft_delete_users(db, current_admin.id, [user_id])
        db.commit()
    except Exception:
        db.rollback()
        raise
    return R.success({"deleted": affected})


@router.post("/users/batch_delete")
def batch_delete_users(
    body: BatchDeleteRequest,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """批量软删除. 自动跳过自己与其他管理员账号, 返回成功数与被跳过的 id."""
    if not body.user_ids:
        return R.error(msg="未选择任何用户")
    try:
        affected, skipped = _soft_delete_users(db, current_admin.id, body.user_ids)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return R.success({"deleted": affected, "skipped": skipped})
