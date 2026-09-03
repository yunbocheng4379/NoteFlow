"""管理员电力流水、统计和人工调整 API。"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.db.engine import get_db
from app.db.models.credit_transactions import CREDIT_TX_TYPES, CreditTransaction
from app.db.models.users import User
from app.services.billing import credit_ledger
from app.services.billing.exceptions import InvalidTransactionError
from app.services.user_notification_service import UserNotificationService
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/admin/credits", tags=["admin-credits"])
logger = get_logger(__name__)

_EARNED_TYPES = (
    "RECHARGE",
    "MONTHLY_GRANT",
    "REGISTER_GRANT",
    "REGISTER_INVITEE",
    "REGISTER_INVITER",
    "FIRST_SUB_INVITER",
)
_TYPE_LABELS = {
    "RECHARGE": "充值到账",
    "CONSUME": "模型调用消耗",
    "REFUND": "失败退回",
    "MONTHLY_GRANT": "会员月度发放",
    "REGISTER_GRANT": "注册赠送",
    "REGISTER_INVITEE": "被邀请奖励",
    "REGISTER_INVITER": "邀请奖励",
    "FIRST_SUB_INVITER": "首订奖励",
    "ADMIN_ADJUST": "管理员调整",
}


class CreditAdjustmentRequest(BaseModel):
    user_id: int = Field(..., gt=0)
    delta: int = Field(..., description="正数充值，负数扣除")
    note: str = Field(..., min_length=1, max_length=255)

    @field_validator("delta")
    @classmethod
    def delta_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("调整电力不能为 0")
        return value

    @field_validator("note")
    @classmethod
    def note_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("操作原因不能为空")
        return value


class BatchCreditAdjustmentRequest(BaseModel):
    user_ids: list[int] = Field(..., min_length=1, max_length=500)
    delta: int = Field(..., description="正数充值，负数扣除")
    note: str = Field(..., min_length=1, max_length=255)

    @field_validator("delta")
    @classmethod
    def delta_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("调整电力不能为 0")
        return value

    @field_validator("user_ids")
    @classmethod
    def user_ids_are_positive(cls, value: list[int]) -> list[int]:
        if any(user_id <= 0 for user_id in value):
            raise ValueError("用户选择无效")
        return list(dict.fromkeys(value))

    @field_validator("note")
    @classmethod
    def note_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("操作原因不能为空")
        return value


def _date_bounds(start_date: date | None, end_date: date | None) -> tuple[datetime, datetime, date, date]:
    end = end_date or datetime.now().date()
    start = start_date or (end - timedelta(days=29))
    if end < start:
        raise HTTPException(status_code=400, detail="结束日期不能早于开始日期")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="查询时间范围不能超过 366 天")
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min), start, end


def _serialize_transaction(row: CreditTransaction, username: str, user_email: str | None) -> dict[str, Any]:
    return {
        "id": row.id,
        "username": username,
        "email": user_email,
        "type": row.type,
        "type_label": _TYPE_LABELS.get(row.type, row.type),
        "amount": int(row.amount or 0),
        "balance_after": int(row.balance_after or 0),
        "note": row.note,
        "related_task_id": row.related_task_id,
        "related_order_id": row.related_order_id,
        "related_subscription_id": row.related_subscription_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _adjustment_result(tx: CreditTransaction, user: User) -> dict[str, Any]:
    return {
        "transaction_id": tx.id,
        "user_id": user.id,
        "username": user.username,
        "delta": int(tx.amount),
        "credits": int(user.credits or 0),
        "note": tx.note,
    }


def _adjust_error(exc: InvalidTransactionError):
    return R.error(code=400, msg=str(exc))


def _publish_credit_adjustment_notification(tx: CreditTransaction, user: User) -> None:
    delta = int(tx.amount or 0)
    direction = "增加" if delta > 0 else "扣除"
    content = (
        f"管理员已为你的账户{direction} {abs(delta)} 电力。\n"
        f"调整后余额：{int(tx.balance_after or 0)} 电力\n"
        f"备注：{tx.note or '管理员未填写备注'}"
    )
    try:
        UserNotificationService.publish(
            user_id=user.id,
            category="credit_adjustment",
            title="电力余额已调整",
            content=content,
            source_type="credit_transaction",
            source_id=str(tx.id),
            link="/billing?tab=transactions",
            severity="info" if delta > 0 else "warning",
        )
    except Exception:
        logger.exception(
            f"管理员电力调整通知写入失败 (user_id={user.id}, transaction_id={tx.id})"
        )


@router.get("/overview")
def credits_overview(
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
):
    """返回账户余额、电力出入账汇总，以及按日消耗趋势。"""
    start_at, end_at, start, end = _date_bounds(start_date, end_date)

    def scalar(statement):
        return db.execute(statement).scalar() or 0

    total_users = scalar(select(func.count(User.id)))
    active_users = scalar(select(func.count(User.id)).where(User.is_active == 1))
    current_balance = scalar(select(func.sum(User.credits)))
    period = (
        CreditTransaction.created_at >= start_at,
        CreditTransaction.created_at < end_at,
    )
    total_consumed = scalar(
        select(func.sum(-CreditTransaction.amount)).where(CreditTransaction.type == "CONSUME", *period)
    )
    total_refunded = scalar(
        select(func.sum(CreditTransaction.amount)).where(CreditTransaction.type == "REFUND", *period)
    )
    total_granted = scalar(
        select(func.sum(CreditTransaction.amount)).where(CreditTransaction.type.in_(_EARNED_TYPES), *period)
    )
    total_adjusted = scalar(
        select(func.sum(CreditTransaction.amount)).where(CreditTransaction.type == "ADMIN_ADJUST", *period)
    )
    users_with_usage = scalar(
        select(func.count(func.distinct(CreditTransaction.user_id))).where(
            CreditTransaction.type == "CONSUME", *period
        )
    )

    grouped = db.execute(
        select(
            func.date(CreditTransaction.created_at).label("day"),
            CreditTransaction.type,
            func.sum(CreditTransaction.amount).label("amount"),
        )
        .where(CreditTransaction.created_at >= start_at, CreditTransaction.created_at < end_at)
        .group_by(func.date(CreditTransaction.created_at), CreditTransaction.type)
        .order_by(func.date(CreditTransaction.created_at).asc())
    ).all()
    by_day: dict[str, dict[str, int]] = {}
    for day, type_, amount in grouped:
        day_key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        item = by_day.setdefault(day_key, {"consumed": 0, "granted": 0, "adjusted": 0, "refunded": 0})
        value = int(amount or 0)
        if type_ == "CONSUME":
            item["consumed"] += abs(value)
        elif type_ == "REFUND":
            item["refunded"] += max(0, value)
        elif type_ in _EARNED_TYPES:
            item["granted"] += value
        elif type_ == "ADMIN_ADJUST":
            item["adjusted"] += value

    trend = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        trend.append({"date": key, **by_day.get(key, {"consumed": 0, "granted": 0, "adjusted": 0, "refunded": 0})})
        cursor += timedelta(days=1)

    return R.success({
        "summary": {
            "total_users": int(total_users),
            "active_users": int(active_users),
            "current_balance": int(current_balance),
            "total_consumed": int(total_consumed),
            "total_granted": int(total_granted),
            "total_refunded": int(total_refunded),
            "total_adjusted": int(total_adjusted),
            "users_with_usage": int(users_with_usage),
        },
        "trend": trend,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    })


@router.get("/transactions")
def list_credit_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, description="用户名、邮箱或备注模糊搜索"),
    type: str | None = Query(None, description="流水类型"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """分页查询所有用户电力流水，用户展示使用用户名而非用户 ID。"""
    conditions = []
    if type:
        if type not in CREDIT_TX_TYPES:
            raise HTTPException(status_code=400, detail="流水类型不合法")
        conditions.append(CreditTransaction.type == type)
    if start_date or end_date:
        start_at, end_at, _, _ = _date_bounds(start_date, end_date)
        conditions.extend([
            CreditTransaction.created_at >= start_at,
            CreditTransaction.created_at < end_at,
        ])
    if keyword and keyword.strip():
        like = f"%{keyword.strip()}%"
        conditions.append(or_(
            User.username.like(like),
            User.email.like(like),
            CreditTransaction.note.like(like),
        ))

    count = db.execute(
        select(func.count(CreditTransaction.id))
        .join(User, User.id == CreditTransaction.user_id)
        .where(*conditions)
    ).scalar() or 0
    rows = db.execute(
        select(CreditTransaction, User.username, User.email)
        .join(User, User.id == CreditTransaction.user_id)
        .where(*conditions)
        .order_by(CreditTransaction.created_at.desc(), CreditTransaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return R.success({
        "list": [_serialize_transaction(row, username, email) for row, username, email in rows],
        "total": int(count),
        "page": page,
        "page_size": page_size,
        "type_labels": _TYPE_LABELS,
    })


@router.post("/adjust")
def adjust_credits(
    body: CreditAdjustmentRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员调整单个用户电力，正数充值、负数扣除。"""
    try:
        tx = credit_ledger.admin_adjust(
            db,
            user_id=body.user_id,
            delta=body.delta,
            note=body.note,
        )
        db.commit()
        user = db.get(User, body.user_id)
        if user is None:
            raise InvalidTransactionError("用户不存在")
        _publish_credit_adjustment_notification(tx, user)
        return R.success(_adjustment_result(tx, user), msg="电力调整成功")
    except InvalidTransactionError as exc:
        db.rollback()
        return _adjust_error(exc)
    except Exception:
        db.rollback()
        raise


@router.post("/batch-adjust")
def batch_adjust_credits(
    body: BatchCreditAdjustmentRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员批量调整电力，全部用户在一个事务中成功或全部回滚。"""
    try:
        transactions = [
            credit_ledger.admin_adjust(
                db,
                user_id=user_id,
                delta=body.delta,
                note=body.note,
            )
            for user_id in body.user_ids
        ]
        db.commit()
        users = [db.get(User, user_id) for user_id in body.user_ids]
        if any(user is None for user in users):
            raise InvalidTransactionError("存在不存在的用户，批量操作已取消")
        for tx, user in zip(transactions, users):
            _publish_credit_adjustment_notification(tx, user)
        return R.success({
            "affected": len(transactions),
            "total_delta": body.delta * len(transactions),
            "items": [_adjustment_result(tx, user) for tx, user in zip(transactions, users)],
        }, msg="批量电力调整成功")
    except InvalidTransactionError as exc:
        db.rollback()
        return _adjust_error(exc)
    except Exception:
        db.rollback()
        raise
