"""
订单服务 - 创建订单 / Mock 支付 / 首单价判断
"""
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.db.models.orders import Order, ORDER_KINDS, ORDER_PAY_METHODS
from app.db.models.subscriptions import Subscription
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.recharge_packages import RechargePackage
from app.db.models.users import User
from app.services.billing.exceptions import OrderStateError, InvalidTransactionError
from app.utils.logger import get_logger

logger = get_logger(__name__)

PENDING_ORDER_TTL_MINUTES = 15


def utcnow_naive() -> datetime:
    """返回统一的 UTC 无时区时间，兼容 MySQL 的 DATETIME 字段。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------- 工具 ----------

def _gen_order_no() -> str:
    """订单号: BN + yyyymmdd + 12 位随机 (base32 大写)"""
    prefix = utcnow_naive().strftime("BN%Y%m%d")
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


def is_one_time_package_available(*, is_one_time: bool, has_paid_order: bool) -> bool:
    """一次性套餐只有在用户尚未成功购买时可用。"""
    return not is_one_time or not has_paid_order


def has_paid_recharge_package(
    db: Session, *, user_id: int, package_id: int, exclude_order_id: Optional[int] = None
) -> bool:
    """判断用户是否已经成功购买过指定充值套餐。"""
    conditions = [
        Order.user_id == user_id,
        Order.package_id == package_id,
        Order.kind == "RECHARGE",
        Order.status == "PAID",
    ]
    if exclude_order_id is not None:
        conditions.append(Order.id != exclude_order_id)
    return db.execute(select(Order.id).where(*conditions).limit(1)).scalar_one_or_none() is not None


def get_order_by_no(db: Session, user_id: int, order_no: str) -> Optional[Order]:
    """用户隔离查订单，已隐藏的订单对普通用户不可见。"""
    return db.execute(
        select(Order).where(
            Order.user_id == user_id,
            Order.order_no == order_no,
            Order.hidden_at.is_(None),
        )
    ).scalar_one_or_none()


def _order_expiry(order: Order) -> Optional[datetime]:
    """返回订单过期时间，兼容迁移前仍未回填的历史记录。"""
    expires_at = getattr(order, "expires_at", None)
    if expires_at:
        return expires_at
    created_at = getattr(order, "created_at", None)
    if created_at:
        return created_at + timedelta(minutes=PENDING_ORDER_TTL_MINUTES)
    return None


def _close_expired_order(order: Order, *, now: Optional[datetime] = None) -> bool:
    """订单已到期时关闭订单，返回是否发生状态变更。"""
    if order.status != "PENDING":
        return False
    now = now or utcnow_naive()
    expires_at = _order_expiry(order)
    if not expires_at or expires_at > now:
        return False
    order.status = "CANCELLED"
    order.cancelled_at = now
    order.mock_qrcode_token = None
    if getattr(order, "expires_at", None) is None:
        order.expires_at = expires_at
    return True


def expire_pending_orders(db: Session, user_id: Optional[int] = None) -> int:
    """关闭已超过 15 分钟的待支付订单，保留订单记录供审计。"""
    conditions = [Order.status == "PENDING"]
    if user_id is not None:
        conditions.append(Order.user_id == user_id)

    rows = db.execute(
        select(Order).where(and_(*conditions)).with_for_update()
    ).scalars().all()
    now = utcnow_naive()
    closed = sum(1 for order in rows if _close_expired_order(order, now=now))
    if closed:
        db.flush()
        logger.info("[order] expire_pending: closed=%s user_id=%s", closed, user_id)
    return closed


def has_active_pending_order(db: Session, user_id: int) -> bool:
    """判断用户是否存在仍在有效期内的待支付订单。"""
    return db.execute(
        select(Order.id)
        .where(Order.user_id == user_id, Order.status == "PENDING")
        .limit(1)
    ).scalar_one_or_none() is not None


def _lock_user_for_order_creation(db: Session, user_id: int) -> None:
    """锁住用户行，串行化同一用户的充值/订阅创单。"""
    user_id_in_db = db.execute(
        select(User.id).where(User.id == user_id).with_for_update()
    ).scalar_one_or_none()
    if user_id_in_db is None:
        raise OrderStateError("用户不存在")


def _ensure_can_create_order(db: Session, user_id: int) -> None:
    _lock_user_for_order_creation(db, user_id)
    expire_pending_orders(db, user_id=user_id)
    if has_active_pending_order(db, user_id):
        raise OrderStateError("当前已有待支付订单，请先完成支付或取消原订单")


def close_pending_order(db: Session, order_no: str, current_user_id: int) -> Order:
    """关闭当前用户的待支付订单，已关闭订单重复调用保持幂等。"""
    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order or order.user_id != current_user_id:
        raise OrderStateError(f"订单不存在: {order_no}")
    if order.status == "CANCELLED":
        return order
    if order.status != "PENDING":
        raise OrderStateError(f"订单状态不可取消 (当前: {order.status})")

    _close_expired_order(order)
    if order.status == "PENDING":
        order.status = "CANCELLED"
        order.cancelled_at = utcnow_naive()
        order.mock_qrcode_token = None
    db.flush()
    return order


def hide_order(db: Session, order_no: str, current_user_id: int) -> Order:
    """隐藏当前用户的一条已关闭订单记录，底层订单数据仍然保留。"""
    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order or order.user_id != current_user_id:
        raise OrderStateError(f"订单不存在: {order_no}")
    if order.hidden_at is not None:
        return order
    if order.status != "CANCELLED":
        raise OrderStateError("只有已关闭订单可以移除记录")

    order.hidden_at = utcnow_naive()
    db.flush()
    return order


def list_user_orders(db: Session, user_id: int, page: int = 1, page_size: int = 20):
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))
    offset = (page - 1) * page_size

    total = db.execute(
        select(Order).where(Order.user_id == user_id, Order.hidden_at.is_(None))
    ).scalars().all()
    total_count = len(total)

    rows = db.execute(
        select(Order)
        .where(Order.user_id == user_id, Order.hidden_at.is_(None))
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()
    return rows, total_count


# ---------- 创建订单 ----------

def _issue_payment(order: Order, *, subject: str) -> Optional[str]:
    """为真实支付渠道生成支付凭证; 支付宝返回临时 URL, 微信写入二维码字段."""
    if order.pay_method == "ALIPAY":
        from app.services.billing.pay_channels import alipay_channel
        return alipay_channel.create_page_payment_url(order, subject=subject)
    elif order.pay_method == "WECHAT":
        from app.services.billing.pay_channels import wechat_channel
        order.qrcode_url = wechat_channel.create_qrcode(order, description=subject)
    return None


def payment_url_for_order(order: Order) -> Optional[str]:
    """读取本次创单生成的支付宝 URL; 该值只存在于当前请求内, 不落库."""
    return getattr(order, "_payment_url", None)


def _subject_for_order(db: Session, order: Order) -> str:
    if order.kind == "RECHARGE":
        package = db.get(RechargePackage, order.package_id)
        return f"NoteFlow 充值-{package.name if package else order.package_id}"
    if order.kind == "SUBSCRIPTION":
        plan = db.get(SubscriptionPlan, order.plan_id)
        return f"NoteFlow 订阅-{plan.name if plan else order.plan_id}"
    raise OrderStateError(f"未知订单类型: {order.kind}")


def create_alipay_payment(db: Session, order_no: str, current_user_id: int) -> str:
    """为已有的当前用户待支付支付宝订单生成新的收银台 URL."""
    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order or order.user_id != current_user_id:
        raise OrderStateError(f"订单不存在: {order_no}")
    _close_expired_order(order)
    if order.status != "PENDING":
        raise OrderStateError(f"订单状态非 PENDING (当前: {order.status})")
    if order.pay_method != "ALIPAY":
        raise InvalidTransactionError("该订单不是支付宝订单")

    from app.services.billing.pay_channels import alipay_channel

    return alipay_channel.create_page_payment_url(
        order, subject=_subject_for_order(db, order)
    )


def create_recharge_order(
    db: Session, *, user_id: int, package_id: int, pay_method: str
) -> Order:
    if pay_method not in ORDER_PAY_METHODS:
        raise InvalidTransactionError(f"不支持的支付方式: {pay_method}")

    _ensure_can_create_order(db, user_id)

    pkg = db.execute(
        select(RechargePackage).where(
            RechargePackage.id == package_id, RechargePackage.is_active == 1
        )
    ).scalar_one_or_none()
    if not pkg:
        raise InvalidTransactionError(f"套餐不存在或已下架: id={package_id}")

    if not is_one_time_package_available(
        is_one_time=bool(pkg.is_one_time),
        has_paid_order=has_paid_recharge_package(db, user_id=user_id, package_id=pkg.id),
    ):
        raise InvalidTransactionError("福利包每个账号仅限成功购买一次")

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
        expires_at=utcnow_naive() + timedelta(minutes=PENDING_ORDER_TTL_MINUTES),
        mock_qrcode_token=_gen_qrcode_token() if pay_method.startswith("MOCK_") else None,
    )
    if pay_method in ("ALIPAY", "WECHAT"):
        payment_url = _issue_payment(order, subject=f"NoteFlow 充值-{pkg.name}")
        if payment_url:
            order._payment_url = payment_url
    db.add(order)
    db.flush()
    logger.info(f"[order] create RECHARGE user={user_id} order_no={order.order_no} pkg={pkg.code} amount={pkg.price_cents}")
    return order


def create_subscription_order(
    db: Session, *, user_id: int, plan_id: int, pay_method: str
) -> Order:
    if pay_method not in ORDER_PAY_METHODS:
        raise InvalidTransactionError(f"不支持的支付方式: {pay_method}")

    _ensure_can_create_order(db, user_id)

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
        expires_at=utcnow_naive() + timedelta(minutes=PENDING_ORDER_TTL_MINUTES),
        mock_qrcode_token=_gen_qrcode_token() if pay_method.startswith("MOCK_") else None,
    )
    if pay_method in ("ALIPAY", "WECHAT"):
        payment_url = _issue_payment(order, subject=f"NoteFlow 订阅-{plan.name}")
        if payment_url:
            order._payment_url = payment_url
    db.add(order)
    db.flush()
    logger.info(f"[order] create SUBSCRIPTION user={user_id} order_no={order.order_no} plan={plan.code} first={is_first} amount={price}")
    return order


# ---------- 支付 ----------

def _settle_paid_order(
    db: Session, *, order: Order, trade_no: Optional[str] = None, raw_payload: Optional[str] = None
) -> None:
    """
    标记订单已支付 + 分发下游动作. 调用方必须已确认 order.status == "PENDING"
    (行锁 + 状态校验由调用方负责, 这里只做落地, 保证 mock/真实渠道共用同一套下游逻辑).

    下游动作 (按顺序):
      RECHARGE: credit_ledger.grant(user, package.credits, type='RECHARGE', related_order_id)
      SUBSCRIPTION: subscription_service.activate_subscription_from_order(order)
                     该函数内部同步 grant monthly_credits.
      referral_service.maybe_pay_first_subscription_reward(order)  # 仅 SUBSCRIPTION 起作用
    """
    from app.services.billing import credit_ledger, subscription_service, referral_service

    if order.kind == "RECHARGE":
        pkg = db.get(RechargePackage, order.package_id)
        if pkg and not is_one_time_package_available(
            is_one_time=bool(pkg.is_one_time),
            has_paid_order=has_paid_recharge_package(
                db,
                user_id=order.user_id,
                package_id=order.package_id,
                exclude_order_id=order.id,
            ),
        ):
            raise OrderStateError("福利包每个账号仅限成功购买一次")

    order.status = "PAID"
    order.paid_at = utcnow_naive()
    order.mock_qrcode_token = None
    if trade_no:
        order.trade_no = trade_no
    if raw_payload:
        order.notify_payload = raw_payload
    db.flush()

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

    referral_service.maybe_pay_first_subscription_reward(db, order=order)

    logger.info(f"[order] PAID user={order.user_id} order_no={order.order_no} kind={order.kind} trade_no={trade_no}")


def mock_pay(
    db: Session, *, order_no: str, mock_qrcode_token: str, current_user_id: int
) -> Order:
    """Mock 支付: 校验 token + 状态 + user_id, 通过则调用 _settle_paid_order."""
    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order:
        raise OrderStateError(f"订单不存在: {order_no}")

    if order.user_id != current_user_id:
        # 用户隔离; 严格来说这是安全事件, 但对外表现为订单不存在
        raise OrderStateError(f"订单不存在: {order_no}")

    _close_expired_order(order)
    if order.status != "PENDING":
        raise OrderStateError(f"订单状态非 PENDING (当前: {order.status})")

    if not order.mock_qrcode_token or order.mock_qrcode_token != mock_qrcode_token:
        raise OrderStateError("二维码 token 校验失败")

    _settle_paid_order(db, order=order)
    return order


def settle_order_by_gateway(
    db: Session, *, order_no: str, trade_no: Optional[str] = None, raw_payload: Optional[str] = None
) -> Optional[Order]:
    """
    真实支付渠道 notify / 对账兜底 共用的入口: 按 order_no 加行锁查订单,
    PENDING 则结算, 已经是 PAID 直接幂等返回 (网关会重试通知), 其它状态记警告并返回 None.
    找不到订单也返回 None (调用方负责按渠道约定的格式响应网关).
    """
    order: Order | None = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order:
        logger.warning(f"[order] settle_order_by_gateway: 订单不存在 order_no={order_no}")
        return None

    if order.status == "PAID":
        logger.info(f"[order] settle_order_by_gateway: 订单已是 PAID, 幂等跳过 order_no={order_no}")
        return order

    if order.status != "PENDING":
        logger.warning(f"[order] settle_order_by_gateway: 订单状态非 PENDING/PAID (当前 {order.status}), order_no={order_no}")
        return None

    if _close_expired_order(order):
        logger.info("[order] settle skipped expired order_no=%s", order_no)
        return None

    _settle_paid_order(db, order=order, trade_no=trade_no, raw_payload=raw_payload)
    return order


# ---------- 对账兜底 ----------

def reconcile_pending_gateway_orders(db: Session, *, min_age_minutes: int = 2) -> int:
    """
    主动查询网关侧支付状态, 兜底 notify 丢失的场景.
    只处理创建时间 > min_age_minutes (避免和刚创建、还没来得及支付的订单抢查询) 的
    PENDING + pay_method in (ALIPAY, WECHAT) 订单.
    返回本次补单成功的订单数.
    """
    from datetime import timedelta
    from app.services.billing.pay_channels import alipay_channel, wechat_channel

    cutoff = utcnow_naive() - timedelta(minutes=min_age_minutes)
    pending = db.execute(
        select(Order).where(
            and_(
                Order.status == "PENDING",
                Order.pay_method.in_(("ALIPAY", "WECHAT")),
                Order.created_at < cutoff,
            )
        )
    ).scalars().all()

    settled = 0
    for order in pending:
        try:
            if order.pay_method == "ALIPAY":
                resp = alipay_channel.query_order(order.order_no)
                if not resp or resp.get("trade_status") not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
                    continue
                trade_no = resp.get("trade_no")
            else:
                resp = wechat_channel.query_order(order.order_no)
                if not resp or resp.get("trade_state") != "SUCCESS":
                    continue
                trade_no = resp.get("transaction_id")

            settled_order = settle_order_by_gateway(
                db, order_no=order.order_no, trade_no=trade_no,
                raw_payload=str(resp),
            )
            if settled_order:
                settled += 1
                logger.info(f"[order] reconcile: 补单成功 order_no={order.order_no}")
        except Exception:
            logger.exception(f"[order] reconcile: 查单/补单异常 order_no={order.order_no}")

    if settled:
        logger.info(f"[order] reconcile: 本轮共补单 {settled} 个")
    return settled


# ---------- 定时清理 ----------

def cleanup_stale_pending_orders(db: Session, older_than_hours: int = 24) -> int:
    """兼容旧调用方：统一按 15 分钟规则关闭待支付订单。"""
    return expire_pending_orders(db)
