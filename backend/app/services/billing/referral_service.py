"""
推荐/邀请服务
- 邀请码生成 (6 位 base32)
- 两段触发: 注册奖励 (invitee +200, inviter +20) / 首订阅奖励 (inviter +100)
"""
import random
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.users import User
from app.db.models.orders import Order
from app.db.models.referral_rewards import ReferralReward
from app.db.models.credit_transactions import CreditTransaction
from app.services.billing.exceptions import InvalidInviteCodeError
from app.utils.logger import get_logger

logger = get_logger(__name__)

REFERRAL_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 去掉易混 0/O/1/I/L
REFERRAL_LEN = 6
MAX_GEN_RETRIES = 10

# 奖励数额 (设计文档 §2 第 5 条对齐)
REGISTER_INVITEE_CREDITS = 200
REGISTER_INVITER_CREDITS = 20
FIRST_SUB_INVITER_CREDITS = 100

REGISTER_GRANT_CREDITS = 100  # 新用户注册赠送 (无邀请码也发)


def generate_referral_code(db: Session, user_id: int) -> str:
    """生成 6 位 base32 邀请码, 冲突重试, 写入 users.referral_code"""
    for _ in range(MAX_GEN_RETRIES):
        code = "".join(random.choices(REFERRAL_CHARS, k=REFERRAL_LEN))
        exists = db.execute(select(User.id).where(User.referral_code == code)).first()
        if exists:
            continue
        user = db.get(User, user_id)
        if not user:
            raise InvalidInviteCodeError(f"用户不存在: user_id={user_id}")
        user.referral_code = code
        db.flush()
        return code
    raise RuntimeError("生成 referral_code 冲突超过 10 次, 请重试")


def bind_referrer_and_pay_register_reward(
    db: Session, *, invitee_user_id: int, invite_code: Optional[str]
) -> Optional[ReferralReward]:
    """
    注册流程调用. invite_code 为空 → 直接返回 None.
    否则:
      1. 查 invite_code 对应 inviter (不存在 → warning 但不阻塞注册)
      2. 拒绝自邀 (invitee == inviter) → warning
      3. 绑定 users.referred_by_user_id
      4. INSERT referral_rewards(REGISTER, +20 inviter, +200 invitee), DB 唯一约束防重
      5. 加电 (invitee +200, inviter +20)
    """
    from app.services.billing import credit_ledger

    if not invite_code:
        return None

    invite_code = invite_code.strip().upper()

    inviter = db.execute(
        select(User).where(User.referral_code == invite_code)
    ).scalar_one_or_none()
    if not inviter:
        logger.warning(f"[referral] 邀请码不存在: {invite_code} (invitee_user_id={invitee_user_id})")
        return None
    if inviter.id == invitee_user_id:
        logger.warning(f"[referral] 拒绝自邀: user_id={invitee_user_id} code={invite_code}")
        return None

    # 绑定关系
    invitee = db.get(User, invitee_user_id)
    if not invitee:
        raise InvalidInviteCodeError(f"用户不存在: user_id={invitee_user_id}")
    if invitee.referred_by_user_id:
        logger.warning(
            f"[referral] 用户已有邀请人, 忽略: invitee={invitee_user_id} existing_inviter={invitee.referred_by_user_id}"
        )
        return None
    invitee.referred_by_user_id = inviter.id
    db.flush()

    # 写返点记录 (DB 唯一约束兜底: 同 invitee 同类型只一次)
    reward = ReferralReward(
        inviter_user_id=inviter.id,
        invitee_user_id=invitee_user_id,
        reward_type="REGISTER",
        inviter_credits=REGISTER_INVITER_CREDITS,
        invitee_credits=REGISTER_INVITEE_CREDITS,
        trigger_order_id=None,
        status="PAID",
    )
    try:
        db.add(reward)
        db.flush()
    except IntegrityError:
        db.rollback()
        logger.warning(f"[referral] REGISTER 奖励已存在, 跳过: invitee={invitee_user_id}")
        return None

    # 加电: invitee +200, inviter +20
    credit_ledger.grant(
        db,
        user_id=invitee_user_id,
        amount=REGISTER_INVITEE_CREDITS,
        type_="REGISTER_INVITEE",
        related_referral_id=reward.id,
        note=f"注册奖励 (使用邀请码 {invite_code})",
    )
    credit_ledger.grant(
        db,
        user_id=inviter.id,
        amount=REGISTER_INVITER_CREDITS,
        type_="REGISTER_INVITER",
        related_referral_id=reward.id,
        note=f"邀请注册奖励 (invitee={invitee.username})",
    )

    logger.info(
        f"[referral] REGISTER paid: inviter={inviter.id} invitee={invitee_user_id} "
        f"(+{REGISTER_INVITEE_CREDITS} invitee, +{REGISTER_INVITER_CREDITS} inviter)"
    )
    return reward


def maybe_pay_first_subscription_reward(
    db: Session, *, order: Order
) -> Optional[ReferralReward]:
    """
    订单 PAID 后调用. 仅对 kind=SUBSCRIPTION 起作用.
    幂等: 同 invitee 只触发一次 FIRST_SUBSCRIPTION.
    """
    from app.services.billing import credit_ledger

    if order.kind != "SUBSCRIPTION":
        return None
    if order.status != "PAID":
        return None

    invitee = db.get(User, order.user_id)
    if not invitee or not invitee.referred_by_user_id:
        return None

    inviter_id = invitee.referred_by_user_id

    # 幂等: 查已有 FIRST_SUBSCRIPTION 记录
    existing = db.execute(
        select(ReferralReward).where(
            ReferralReward.invitee_user_id == invitee.id,
            ReferralReward.reward_type == "FIRST_SUBSCRIPTION",
        )
    ).scalar_one_or_none()
    if existing:
        logger.info(f"[referral] FIRST_SUBSCRIPTION 已存在, 跳过: invitee={invitee.id}")
        return None

    reward = ReferralReward(
        inviter_user_id=inviter_id,
        invitee_user_id=invitee.id,
        reward_type="FIRST_SUBSCRIPTION",
        inviter_credits=FIRST_SUB_INVITER_CREDITS,
        invitee_credits=0,
        trigger_order_id=order.id,
        status="PAID",
    )
    try:
        db.add(reward)
        db.flush()
    except IntegrityError:
        db.rollback()
        logger.warning(f"[referral] FIRST_SUBSCRIPTION 唯一约束冲突 (幂等): invitee={invitee.id}")
        return None

    credit_ledger.grant(
        db,
        user_id=inviter_id,
        amount=FIRST_SUB_INVITER_CREDITS,
        type_="FIRST_SUB_INVITER",
        related_order_id=order.id,
        related_referral_id=reward.id,
        note=f"邀请人首订阅返点 (invitee={invitee.username})",
    )

    logger.info(f"[referral] FIRST_SUBSCRIPTION paid: inviter={inviter_id} invitee={invitee.id} +{FIRST_SUB_INVITER_CREDITS}")
    return reward


# ---------- 查询 (给 router 用) ----------

def get_referral_stats(db: Session, user_id: int) -> dict:
    """
    返回 {referral_code, invited_count, total_rewards_credits}
    """
    user = db.get(User, user_id)
    if not user:
        return {"referral_code": None, "invited_count": 0, "total_rewards_credits": 0}

    # 已邀请人数 (不同 invitee 的去重计数)
    invited_count = db.execute(
        select(func.count(func.distinct(User.id))).where(User.referred_by_user_id == user_id)
    ).scalar() or 0

    # 累计返点 = 该用户作为 inviter 拿到的所有电力
    total_rewards = db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0)).where(
            CreditTransaction.user_id == user_id,
            CreditTransaction.type.in_(("REGISTER_INVITER", "FIRST_SUB_INVITER")),
        )
    ).scalar() or 0

    return {
        "referral_code": user.referral_code,
        "invited_count": int(invited_count),
        "total_rewards_credits": int(total_rewards),
    }


def list_invited_users(db: Session, user_id: int, page: int = 1, page_size: int = 20):
    """分页查邀请记录, 返回 (rows, total)"""
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))
    offset = (page - 1) * page_size

    total = db.execute(
        select(func.count(User.id)).where(User.referred_by_user_id == user_id)
    ).scalar() or 0

    rows = db.execute(
        select(User)
        .where(User.referred_by_user_id == user_id)
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()

    result = []
    for u in rows:
        # 是否已触发首订阅返点
        first_sub_reward = db.execute(
            select(ReferralReward).where(
                ReferralReward.invitee_user_id == u.id,
                ReferralReward.reward_type == "FIRST_SUBSCRIPTION",
            )
        ).scalar_one_or_none()

        # 该 invitee 给邀请人贡献了多少电力
        earned = db.execute(
            select(func.coalesce(func.sum(ReferralReward.inviter_credits), 0)).where(
                ReferralReward.invitee_user_id == u.id
            )
        ).scalar() or 0

        result.append({
            "invitee_id": u.id,
            "invitee_masked": _mask_identity(u),
            "registered_at": u.created_at.isoformat() if u.created_at else None,
            "has_first_subscription": bool(first_sub_reward),
            "reward_credits": int(earned),
        })
    return result, int(total)


def list_referral_rewards(db: Session, user_id: int, page: int = 1, page_size: int = 20):
    """分页查该用户作为 inviter 收到的所有返点"""
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))
    offset = (page - 1) * page_size

    total = db.execute(
        select(func.count(ReferralReward.id)).where(ReferralReward.inviter_user_id == user_id)
    ).scalar() or 0

    rows = db.execute(
        select(ReferralReward)
        .where(ReferralReward.inviter_user_id == user_id)
        .order_by(ReferralReward.paid_at.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()
    return rows, int(total)


def _mask_identity(user: User) -> str:
    """脱敏展示: 用户名保留首尾 1 字, 中间用 * 代替. 邮箱局部脱敏."""
    name = user.username or ""
    if len(name) <= 2:
        masked_name = name[:1] + "*"
    else:
        masked_name = name[0] + "*" * (len(name) - 2) + name[-1]
    return masked_name
