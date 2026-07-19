"""
计费 / 订单 / 推荐相关 API
所有接口都要求登录, 用户隔离.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.db.engine import get_db
from app.db.models.credit_pricing import CreditPricing
from app.db.models.credit_transactions import CreditTransaction
from app.db.models.orders import Order
from app.db.models.recharge_packages import RechargePackage
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.subscriptions import Subscription
from app.db.models.users import User
from app.services.billing import (
    credit_ledger,
    pricing,
    order_service,
    referral_service,
)
from app.services.billing.exceptions import (
    BillingError,
    InsufficientCreditError,
    InvalidTransactionError,
    OrderStateError,
)
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/billing", tags=["billing"])


# ============================================================================
# 电力 / 余额
# ============================================================================

@router.get("/balance")
def get_balance(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """当前余额 + 累计消耗 + 当前订阅信息"""
    u = db.get(User, current_user.id)
    active_sub = None
    if u.active_subscription_id:
        sub = db.get(Subscription, u.active_subscription_id)
        if sub and sub.status == "ACTIVE":
            plan = db.get(SubscriptionPlan, sub.plan_id)
            # 剩余天数按「向上取整」计: 剩 18 小时也算 1 天, 到期当天不显示 0 天
            if sub.end_at:
                remaining = sub.end_at - datetime.now()
                days_left = max(0, -(-remaining.total_seconds() // 86400)) if remaining.total_seconds() > 0 else 0
                days_left = int(days_left)
            else:
                days_left = 0
            active_sub = {
                "plan_code": plan.code if plan else None,
                "plan_name": plan.name if plan else None,
                "start_at": sub.start_at.isoformat() if sub.start_at else None,
                "end_at": sub.end_at.isoformat() if sub.end_at else None,
                "days_left": days_left,
                "monthly_credits": plan.monthly_credits if plan else 0,
            }
    return R.success({
        "credits": int(u.credits or 0),
        "used_points": int(u.used_points or 0),
        "active_subscription": active_sub,
    })


class PricingPreviewReq(BaseModel):
    model_name: Optional[str] = None
    duration_sec: Optional[float] = None
    # 前端如果只有 url 没 duration, 由前端先调 /api/video_info 拿到再传过来


@router.post("/pricing/preview")
def pricing_preview(
    body: PricingPreviewReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    预览生成一份笔记所需电力.
    duration_sec 由前端提前调 /api/video_info 拿到 (真实计费在 generate_note 里后端独立再算一次).
    """
    rate = pricing.get_model_rate(db, body.model_name or "")
    required = pricing.calculate_required_credits(db, body.model_name, body.duration_sec or 0)
    balance = int((db.get(User, current_user.id).credits) or 0)
    return R.success({
        "model_name": body.model_name,
        "duration_sec": body.duration_sec,
        "model_rate_per_minute": rate,
        "required_credits": required,
        "current_balance": balance,
        "sufficient": balance >= required,
    })


# ============================================================================
# 套餐 & 方案 (公开信息, 但仍要求登录)
# ============================================================================

@router.get("/recharge/packages")
def list_recharge_packages(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(RechargePackage).where(RechargePackage.is_active == 1).order_by(RechargePackage.sort_order.asc())
    ).scalars().all()
    return R.success([{
        "id": p.id,
        "code": p.code,
        "name": p.name,
        "price_cents": p.price_cents,
        "credits": p.credits,
        "unit_price_text": p.unit_price_text,
        "sort_order": p.sort_order,
        "badge": p.badge,
        "description": p.description,
    } for p in rows])


@router.get("/subscription/plans")
def list_subscription_plans(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """会员方案列表. 每条附带该用户的 current_price_cents (首单 or 续费)"""
    rows = db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.is_active == 1).order_by(SubscriptionPlan.sort_order.asc())
    ).scalars().all()

    result = []
    for p in rows:
        is_first = order_service.is_first_subscription(db, current_user.id, p.id)
        result.append({
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "duration_days": p.duration_days,
            "monthly_credits": p.monthly_credits,
            "first_price_cents": p.first_price_cents,
            "renewal_price_cents": p.renewal_price_cents,
            "original_price_cents": p.original_price_cents,
            "current_price_cents": p.first_price_cents if is_first else p.renewal_price_cents,
            "is_first_subscription": is_first,
            "sort_order": p.sort_order,
            "badge": p.badge,
            "description": p.description,
        })
    return R.success(result)


# ============================================================================
# 订单
# ============================================================================

class CreateRechargeOrderReq(BaseModel):
    package_id: int
    pay_method: str = "MOCK_ALIPAY"


class CreateSubscriptionOrderReq(BaseModel):
    plan_id: int
    pay_method: str = "MOCK_ALIPAY"


def _serialize_order(o: Order) -> dict:
    return {
        "id": o.id,
        "order_no": o.order_no,
        "kind": o.kind,
        "package_id": o.package_id,
        "plan_id": o.plan_id,
        "amount_cents": o.amount_cents,
        "credits_amount": o.credits_amount,
        "status": o.status,
        "pay_method": o.pay_method,
        "mock_qrcode_token": o.mock_qrcode_token,
        "is_first_subscription": bool(o.is_first_subscription),
        "paid_at": o.paid_at.isoformat() if o.paid_at else None,
        "cancelled_at": o.cancelled_at.isoformat() if o.cancelled_at else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


@router.post("/order/recharge")
def create_recharge_order(
    body: CreateRechargeOrderReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        order = order_service.create_recharge_order(
            db, user_id=current_user.id, package_id=body.package_id, pay_method=body.pay_method
        )
        db.commit()
        db.refresh(order)
        return R.success(_serialize_order(order))
    except BillingError as e:
        db.rollback()
        return R.error(msg=e.message, code=e.code, data=e.data)
    except Exception:
        db.rollback()
        raise


@router.post("/order/subscription")
def create_subscription_order(
    body: CreateSubscriptionOrderReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        order = order_service.create_subscription_order(
            db, user_id=current_user.id, plan_id=body.plan_id, pay_method=body.pay_method
        )
        db.commit()
        db.refresh(order)
        return R.success(_serialize_order(order))
    except BillingError as e:
        db.rollback()
        return R.error(msg=e.message, code=e.code, data=e.data)
    except Exception:
        db.rollback()
        raise


class MockPayReq(BaseModel):
    order_no: str
    mock_qrcode_token: str


@router.post("/order/mock_pay")
def mock_pay(
    body: MockPayReq,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        order = order_service.mock_pay(
            db,
            order_no=body.order_no,
            mock_qrcode_token=body.mock_qrcode_token,
            current_user_id=current_user.id,
        )
        db.commit()
        db.refresh(order)
        return R.success(_serialize_order(order))
    except BillingError as e:
        db.rollback()
        return R.error(msg=e.message, code=e.code, data=e.data)
    except Exception:
        db.rollback()
        raise


@router.get("/order/{order_no}")
def get_order(
    order_no: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = order_service.get_order_by_no(db, current_user.id, order_no)
    if not o:
        return R.error(msg="订单不存在", code=OrderStateError.code)
    return R.success(_serialize_order(o))


@router.get("/orders")
def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = order_service.list_user_orders(db, current_user.id, page=page, page_size=page_size)
    return R.success({
        "list": [_serialize_order(o) for o in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    })


# ============================================================================
# 流水
# ============================================================================

@router.get("/transactions")
def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func
    offset = (page - 1) * page_size
    total = db.execute(
        select(func.count(CreditTransaction.id)).where(CreditTransaction.user_id == current_user.id)
    ).scalar() or 0
    rows = db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == current_user.id)
        .order_by(CreditTransaction.created_at.desc(), CreditTransaction.id.desc())
        .offset(offset)
        .limit(page_size)
    ).scalars().all()

    return R.success({
        "list": [{
            "id": t.id,
            "type": t.type,
            "amount": t.amount,
            "balance_after": t.balance_after,
            "related_task_id": t.related_task_id,
            "related_order_id": t.related_order_id,
            "note": t.note,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        } for t in rows],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    })


# ============================================================================
# 推荐 / 邀请
# ============================================================================

@router.get("/referral/me")
def referral_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stats = referral_service.get_referral_stats(db, current_user.id)
    return R.success(stats)


@router.get("/referral/invited")
def referral_invited(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = referral_service.list_invited_users(db, current_user.id, page=page, page_size=page_size)
    return R.success({"list": rows, "total": total, "page": page, "page_size": page_size})


@router.get("/referral/rewards")
def referral_rewards(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = referral_service.list_referral_rewards(db, current_user.id, page=page, page_size=page_size)
    return R.success({
        "list": [{
            "id": r.id,
            "reward_type": r.reward_type,
            "inviter_credits": r.inviter_credits,
            "invitee_user_id": r.invitee_user_id,
            "trigger_order_id": r.trigger_order_id,
            "paid_at": r.paid_at.isoformat() if r.paid_at else None,
        } for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    })
