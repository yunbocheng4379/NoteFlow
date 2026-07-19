"""
订阅服务 - 激活 / 月度发放 / 过期
"""
import math
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, update, and_
from sqlalchemy.orm import Session

from app.db.models.orders import Order
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.subscriptions import Subscription
from app.db.models.users import User
from app.services.billing.exceptions import OrderStateError, InvalidTransactionError
from app.utils.logger import get_logger

logger = get_logger(__name__)


def activate_subscription_from_order(db: Session, *, order: Order) -> Subscription:
    """
    订单 PAID 后由 order_service.mock_pay 同事务调用.
    1. INSERT subscription (ACTIVE, start_at=now, end_at=now+duration_days)
    2. 立即首次发放 monthly_credits 到用户 credits
    3. 终结老 ACTIVE 订阅 (升级语义, 已发放电力保留)
    4. 取消同用户其他 PENDING 订阅订单 (防刷首单价)
    5. UPDATE users.active_subscription_id
    """
    from app.services.billing import credit_ledger

    if order.kind != "SUBSCRIPTION":
        raise OrderStateError(f"activate_subscription_from_order 仅对 SUBSCRIPTION 订单有效: {order.kind}")
    if order.status != "PAID":
        raise OrderStateError(f"订单未支付, 无法激活订阅: status={order.status}")

    plan = db.get(SubscriptionPlan, order.plan_id)
    if not plan:
        raise InvalidTransactionError(f"订阅方案不存在: id={order.plan_id}")

    now = datetime.now()
    end_at = now + timedelta(days=plan.duration_days)

    # 1) 创建订阅
    sub = Subscription(
        user_id=order.user_id,
        plan_id=plan.id,
        order_id=order.id,
        start_at=now,
        end_at=end_at,
        status="ACTIVE",
        last_grant_at=None,
        next_grant_at=None,
        grant_count=0,
    )
    db.add(sub)
    db.flush()  # 拿 sub.id

    # 2) 立即首次发放
    credit_ledger.grant(
        db,
        user_id=order.user_id,
        amount=plan.monthly_credits,
        type_="MONTHLY_GRANT",
        related_order_id=order.id,
        related_subscription_id=sub.id,
        note=f"{plan.name} 首期发放",
    )
    sub.grant_count = 1
    sub.last_grant_at = now
    # 月度会员 (30d): 只发一次; 季度/年度 30 天后再发
    if _remaining_grants(plan, sub.grant_count) > 0:
        sub.next_grant_at = now + timedelta(days=30)
    else:
        sub.next_grant_at = None
    db.flush()

    # 3) 终结同用户其他 ACTIVE 订阅
    db.execute(
        update(Subscription)
        .where(
            and_(
                Subscription.user_id == order.user_id,
                Subscription.status == "ACTIVE",
                Subscription.id != sub.id,
            )
        )
        .values(status="EXPIRED")
    )

    # 4) 取消同用户其他 PENDING 订阅订单
    db.execute(
        update(Order)
        .where(
            and_(
                Order.user_id == order.user_id,
                Order.kind == "SUBSCRIPTION",
                Order.status == "PENDING",
                Order.id != order.id,
            )
        )
        .values(status="CANCELLED", cancelled_at=now, mock_qrcode_token=None)
    )

    # 5) users.active_subscription_id
    db.execute(update(User).where(User.id == order.user_id).values(active_subscription_id=sub.id))
    db.flush()

    logger.info(f"[sub] ACTIVATED user={order.user_id} plan={plan.code} sub_id={sub.id} end_at={end_at}")
    return sub


def _remaining_grants(plan: SubscriptionPlan, grant_count: int) -> int:
    """还剩多少次发放机会 (ceil(duration_days/30) - 已发)"""
    total = max(1, math.ceil(plan.duration_days / 30))
    return max(0, total - grant_count)


# ---------- 定时任务 ----------

def run_monthly_grant_tick(db: Session) -> int:
    """
    每日定时任务: 找所有到期该发放的订阅, 补发一次月度电力.
    幂等: 判断 next_grant_at <= now AND grant_count < 上限.
    返回本次发放的订阅数.
    """
    from app.services.billing import credit_ledger

    now = datetime.now()
    due_subs = db.execute(
        select(Subscription).where(
            and_(
                Subscription.status == "ACTIVE",
                Subscription.next_grant_at.is_not(None),
                Subscription.next_grant_at <= now,
            )
        )
        .with_for_update(skip_locked=True)  # 跨节点安全
    ).scalars().all()

    granted = 0
    for sub in due_subs:
        plan = db.get(SubscriptionPlan, sub.plan_id)
        if not plan:
            continue

        remaining = _remaining_grants(plan, sub.grant_count)
        if remaining <= 0:
            sub.next_grant_at = None
            continue

        credit_ledger.grant(
            db,
            user_id=sub.user_id,
            amount=plan.monthly_credits,
            type_="MONTHLY_GRANT",
            related_subscription_id=sub.id,
            related_order_id=sub.order_id,
            note=f"{plan.name} 第 {sub.grant_count + 1} 期发放",
        )
        sub.grant_count += 1
        sub.last_grant_at = now
        if _remaining_grants(plan, sub.grant_count) > 0:
            sub.next_grant_at = now + timedelta(days=30)
        else:
            sub.next_grant_at = None
        granted += 1

    db.flush()
    logger.info(f"[sub] run_monthly_grant_tick: granted={granted}")
    return granted


def expire_outdated_subscriptions(db: Session) -> int:
    """日任务: status=ACTIVE 且 end_at<now → EXPIRED; 同步清 users.active_subscription_id"""
    now = datetime.now()
    outdated = db.execute(
        select(Subscription).where(
            and_(Subscription.status == "ACTIVE", Subscription.end_at < now)
        )
        .with_for_update(skip_locked=True)
    ).scalars().all()

    for sub in outdated:
        sub.status = "EXPIRED"
        # 清 users.active_subscription_id (仅当它指向这条)
        db.execute(
            update(User)
            .where(and_(User.id == sub.user_id, User.active_subscription_id == sub.id))
            .values(active_subscription_id=None)
        )

    db.flush()
    logger.info(f"[sub] expire_outdated_subscriptions: expired={len(outdated)}")
    return len(outdated)
