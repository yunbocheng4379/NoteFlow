"""
订单服务 - 创建订单 / Mock 支付 / 首单价判断
"""
import secrets
import string
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update, and_
from sqlalchemy.orm import Session

from app.db.models.orders import Order, ORDER_KINDS, ORDER_PAY_METHODS
from app.db.models.subscriptions import Subscription
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.recharge_packages import RechargePackage
from app.services.billing.exceptions import OrderStateError, InvalidTransactionError
from app.utils.logger import get_logger

logger = get_logger(__name__)


# ---------- 工具 ----------

def _gen_order_no() -> str:
    """订单号: BN + yyyymmdd + 12 位随机 (base32 大写)"""
    prefix = datetime.now().strftime("BN%Y%m%d")
    charset = string.ascii_uppercase + string.digits
    rand = "".join(secrets.choice(charset) for _ in range(12))
    return prefix + rand


def _gen_qrcode_token() -> str:
    return secrets.token_urlsafe(24)  # 32 字符 URL-safe


# ---------- 查询 ----------

def is_first_subscription(db: Session, user_id: int, plan_id: int) -> bool:
    """
    该用户是否从未订阅过 plan_id? 含 ACTIVE/EXPIRED/CANCELLED 所有历史.
    """
    row = db.execute(
        select(Subscription.id).where(
            Subscription.user_id == user_id, Subscription.plan_id == plan_id
        ).limit(1)
    ).first()
    return row is None


def get_order_by_no(db: Session, user_id: int, order_no: str) -> Optional[Order]:
    """用户隔离查订单"""
    return db.execute(
        select(Order).where(Order.user_id == user_id, Order.order_no == order_no)
    ).scalar_one_or_none()


def list_user_orders(db: Session, user_id: int, page: int = 1, page_size: int = 20):
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))
    offset = (page - 1) * page_size

    total = db.execute(
        select(Order).where(Order.user_id == user_id)
    ).scalars().all()
    total_count = len(total)

    rows = db.execute(
        select(Order)
        .where(Order.user_id == user_id)
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()
    return rows, total_count


# ---------- 创建订单 ----------

def create_recharge_order(
    db: Session, *, user_id: int, package_id: int, pay_method: str
) -> Order:
    if pay_method not in ORDER_PAY_METHODS:
        raise InvalidTransactionError(f"不支持的支付方式: {pay_method}")

    pkg = db.execute(
        select(RechargePackage).where(
            RechargePackage.id == package_id, RechargePackage.is_active == 1
        )
    ).scalar_one_or_none()
    if not pkg:
        raise InvalidTransactionError(f"套餐不存在或已下架: id={package_id}")

    order = Order(
        order_no=_gen_order_no(),
        user_id=user_id,
        kind="RECHARGE",
        package_id=pkg.id,
        plan_id=None,
        is_first_subscription=0,
        amount_cents=pkg.price_cents,
        credits_amount=pkg.credits,
        status="PENDING",
        pay_method=pay_method,
        mock_qrcode_token=_gen_qrcode_token() if pay_method.startswith("MOCK_") else None,
    )
    db.add(order)
    db.flush()
    logger.info(f"[order] create RECHARGE user={user_id} order_no={order.order_no} pkg={pkg.code} amount={pkg.price_cents}")
    return order


def create_subscription_order(
    db: Session, *, user_id: int, plan_id: int, pay_method: str
) -> Order:
    if pay_method not in ORDER_PAY_METHODS:
        raise InvalidTransactionError(f"不支持的支付方式: {pay_method}")

    plan = db.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.id == plan_id, SubscriptionPlan.is_active == 1
        )
    ).scalar_one_or_none()
    if not plan:
        raise InvalidTransactionError(f"订阅方案不存在或已下架: id={plan_id}")

    is_first = is_first_subscription(db, user_id, plan_id)
    price = plan.first_price_cents if is_first else plan.renewal_price_cents

    order = Order(
        order_no=_gen_order_no(),
        user_id=user_id,
        kind="SUBSCRIPTION",
        package_id=None,
        plan_id=plan.id,
        is_first_subscription=1 if is_first else 0,
        amount_cents=price,
        credits_amount=plan.monthly_credits,  # 首期发放量
        status="PENDING",
        pay_method=pay_method,
        mock_qrcode_token=_gen_qrcode_token() if pay_method.startswith("MOCK_") else None,
    )
    db.add(order)
    db.flush()
    logger.info(f"[order] create SUBSCRIPTION user={user_id} order_no={order.order_no} plan={plan.code} first={is_first} amount={price}")
    return order


# ---------- 支付 ----------

def mock_pay(
    db: Session, *, order_no: str, mock_qrcode_token: str, current_user_id: int
) -> Order:
    """
    Mock 支付: 校验 token + 状态 + user_id, 通过则 mark PAID + 触发下游动作.
    单事务; 调用方需 with db.begin() 或自行 commit.

    下游动作 (按顺序):
      RECHARGE: credit_ledger.grant(user, package.credits, type='RECHARGE', related_order_id)
      SUBSCRIPTION: subscription_service.activate_subscription_from_order(order)
                     该函数内部同步 grant monthly_credits.
      referral_service.maybe_pay_first_subscription_reward(order)  # 仅 SUBSCRIPTION 起作用
    """
    from app.services.billing import credit_ledger, subscription_service, referral_service

    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order:
        raise OrderStateError(f"订单不存在: {order_no}")

    if order.user_id != current_user_id:
        # 用户隔离; 严格来说这是安全事件, 但对外表现为订单不存在
        raise OrderStateError(f"订单不存在: {order_no}")

    if order.status != "PENDING":
        raise OrderStateError(f"订单状态非 PENDING (当前: {order.status})")

    if not order.mock_qrcode_token or order.mock_qrcode_token != mock_qrcode_token:
        raise OrderStateError("二维码 token 校验失败")

    # 1) 标记订单已支付
    order.status = "PAID"
    order.paid_at = datetime.now()
    order.mock_qrcode_token = None
    db.flush()

    # 2) 分发下游动作
    if order.kind == "RECHARGE":
        pkg = db.get(RechargePackage, order.package_id)
        credit_ledger.grant(
            db,
            user_id=order.user_id,
            amount=order.credits_amount,
            type_="RECHARGE",
            related_order_id=order.id,
            note=f"充值到账: {pkg.name if pkg else order.package_id}",
        )
    elif order.kind == "SUBSCRIPTION":
        subscription_service.activate_subscription_from_order(db, order=order)
    else:
        raise OrderStateError(f"未知订单类型: {order.kind}")

    # 3) 触发首订阅推荐返点 (仅 SUBSCRIPTION 起作用, 内部会判 kind)
    referral_service.maybe_pay_first_subscription_reward(db, order=order)

    logger.info(f"[order] MOCK_PAID user={order.user_id} order_no={order.order_no} kind={order.kind}")
    return order


# ---------- 定时清理 ----------

def cleanup_stale_pending_orders(db: Session, older_than_hours: int = 24) -> int:
    """将 PENDING 且 created_at < now - N 小时的订单 set CANCELLED"""
    from datetime import timedelta

    cutoff = datetime.now() - timedelta(hours=older_than_hours)
    result = db.execute(
        update(Order)
        .where(
            and_(
                Order.status == "PENDING",
                Order.created_at < cutoff,
            )
        )
        .values(status="CANCELLED", cancelled_at=datetime.now(), mock_qrcode_token=None)
    )
    count = result.rowcount or 0
    logger.info(f"[order] cleanup_stale: {count} 个 PENDING 订单已取消 (>{older_than_hours}h)")
    return count
