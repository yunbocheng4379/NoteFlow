from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.db.models.ai_usage import AIModelPricing, AIUsageLog
from app.db.models.users import User


def date_bounds(
    start_date: date | None = None,
    end_date: date | None = None,
    *,
    start_datetime: datetime | None = None,
    end_datetime: datetime | None = None,
) -> tuple[datetime, datetime, date, date]:
    today = date.today()
    default_start = start_date or (today - timedelta(days=6))
    default_end = end_date or today
    if start_datetime or end_datetime:
        start_at = start_datetime or datetime.combine(default_start, time.min)
        end_at = end_datetime or datetime.combine(default_end + timedelta(days=1), time.min)
        if end_at <= start_at:
            raise ValueError("结束时间不能早于或等于开始时间")
        start = start_at.date()
        end = (end_at - timedelta(microseconds=1)).date()
    else:
        start = default_start
        end = default_end
        if end < start:
            raise ValueError("结束日期不能早于开始日期")
        start_at = datetime.combine(start, time.min)
        end_at = datetime.combine(end + timedelta(days=1), time.min)
    if (end - start).days > 366:
        raise ValueError("查询范围不能超过 367 天")
    return start_at, end_at, start, end


def conditions(
    start_at: datetime,
    end_at: datetime,
    *,
    user_id: int | None = None,
    user_name: str | None = None,
    scene: str | None = None,
    provider_id: str | None = None,
    model_name: str | None = None,
    key_fingerprint: str | None = None,
    status: str | None = None,
    keyword: str | None = None,
) -> list[Any]:
    result: list[Any] = [AIUsageLog.started_at >= start_at, AIUsageLog.started_at < end_at]
    if user_id is not None:
        result.append(AIUsageLog.user_id == user_id)
    if user_name and user_name.strip():
        user_like = f"%{user_name.strip()}%"
        result.append(or_(
            AIUsageLog.user_snapshot.ilike(user_like),
            AIUsageLog.user_id.in_(
                select(User.id).where(User.username.ilike(user_like))
            ),
        ))
    if scene:
        result.append(AIUsageLog.scene == scene.strip())
    if provider_id:
        result.append(AIUsageLog.provider_id == provider_id.strip())
    if model_name:
        result.append(AIUsageLog.model_name == model_name.strip())
    if key_fingerprint and key_fingerprint.strip():
        result.append(AIUsageLog.key_fingerprint.ilike(f"%{key_fingerprint.strip()}%"))
    if status:
        result.append(AIUsageLog.status == status.strip())
    if keyword:
        like = f"%{keyword.strip()}%"
        result.append(or_(AIUsageLog.operation.like(like), AIUsageLog.resource_id.like(like), AIUsageLog.error_message.like(like)))
    return result


def _sum(column):
    return func.coalesce(func.sum(column), 0)


def _latest_attempt_id():
    latest = aliased(AIUsageLog)
    return select(func.max(latest.id)).where(latest.trace_id == AIUsageLog.trace_id).correlate(AIUsageLog).scalar_subquery()


def _failed_final_trace():
    return func.count(func.distinct(case(
        (and_(AIUsageLog.id == _latest_attempt_id(), AIUsageLog.status.in_(["failed", "timeout"])), AIUsageLog.trace_id)
    )))


def overview(db: Session, where: list[Any]) -> dict[str, Any]:
    row = db.execute(
        select(
            func.count(func.distinct(AIUsageLog.trace_id)),
            func.count(AIUsageLog.id),
            _sum(AIUsageLog.input_tokens),
            _sum(AIUsageLog.output_tokens),
            _sum(AIUsageLog.total_tokens),
            _sum(AIUsageLog.estimated_cost),
            _failed_final_trace(),
            _sum(AIUsageLog.latency_ms),
            func.sum(case((and_(
                AIUsageLog.estimated_cost.is_(None),
                or_(
                    AIUsageLog.input_tokens.is_not(None),
                    AIUsageLog.output_tokens.is_not(None),
                    AIUsageLog.total_tokens.is_not(None),
                ),
            ), 1), else_=0)),
        ).where(*where)
    ).one()
    calls = int(row[0] or 0)
    return {
        "calls": calls,
        "attempts": int(row[1] or 0),
        "input_tokens": int(row[2] or 0),
        "output_tokens": int(row[3] or 0),
        "total_tokens": int(row[4] or 0),
        "estimated_cost": float(row[5] or 0),
        "failed_calls": int(row[6] or 0),
        "failure_rate": round(int(row[6] or 0) / max(1, calls) * 100, 2),
        "average_latency_ms": round(int(row[7] or 0) / max(1, int(row[1] or 0))),
        "unpriced_attempts": int(row[8] or 0),
    }


def trend(db: Session, where: list[Any]) -> list[dict[str, Any]]:
    day = func.date(AIUsageLog.started_at).label("day")
    rows = db.execute(
        select(day, func.count(func.distinct(AIUsageLog.trace_id)), _sum(AIUsageLog.input_tokens),
               _sum(AIUsageLog.output_tokens), _sum(AIUsageLog.total_tokens),
               _sum(AIUsageLog.estimated_cost),
               _failed_final_trace())
        .where(*where).group_by(day).order_by(day)
    ).all()
    return [
        {"date": str(row[0]), "calls": int(row[1] or 0), "input_tokens": int(row[2] or 0),
         "output_tokens": int(row[3] or 0), "total_tokens": int(row[4] or 0),
         "estimated_cost": float(row[5] or 0), "failed_calls": int(row[6] or 0)}
        for row in rows
    ]


def grouped(
    db: Session,
    where: list[Any],
    group_columns: tuple[Any, ...],
    names: tuple[str, ...],
    *,
    join_user: bool = False,
) -> list[dict[str, Any]]:
    query = select(
        *group_columns,
        func.count(func.distinct(AIUsageLog.trace_id)),
        _sum(AIUsageLog.input_tokens),
               _sum(AIUsageLog.output_tokens), _sum(AIUsageLog.total_tokens), _sum(AIUsageLog.estimated_cost),
        _failed_final_trace(),
    ).select_from(AIUsageLog)
    if join_user:
        query = query.outerjoin(User, User.id == AIUsageLog.user_id)
    rows = db.execute(
        query.where(*where).group_by(*group_columns).order_by(_sum(AIUsageLog.total_tokens).desc())
    ).all()
    result = []
    for row in rows:
        item = {name: row[index] for index, name in enumerate(names)}
        calls = int(row[len(names)] or 0)
        failed = int(row[len(names) + 5] or 0)
        item.update({
            "calls": calls,
            "input_tokens": int(row[len(names) + 1] or 0),
            "output_tokens": int(row[len(names) + 2] or 0),
            "total_tokens": int(row[len(names) + 3] or 0),
            "estimated_cost": float(row[len(names) + 4] or 0),
            "failed_calls": failed,
            "failure_rate": round(failed / max(1, calls) * 100, 2),
        })
        result.append(item)
    return result


def list_logs(db: Session, where: list[Any], page: int, page_size: int) -> tuple[list[tuple[AIUsageLog, str | None]], int]:
    total = db.scalar(select(func.count(AIUsageLog.id)).where(*where)) or 0
    user_name = func.coalesce(User.username, AIUsageLog.user_snapshot).label("user_name")
    rows = db.execute(
        select(AIUsageLog, user_name)
        .select_from(AIUsageLog)
        .outerjoin(User, User.id == AIUsageLog.user_id)
        .where(*where)
        .order_by(AIUsageLog.started_at.desc(), AIUsageLog.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return rows, int(total)


def find_log(db: Session, log_id: int) -> AIUsageLog | None:
    return db.get(AIUsageLog, log_id)


def find_trace(db: Session, trace_id: str) -> list[tuple[AIUsageLog, str | None]]:
    user_name = func.coalesce(User.username, AIUsageLog.user_snapshot).label("user_name")
    return db.execute(
        select(AIUsageLog, user_name)
        .select_from(AIUsageLog)
        .outerjoin(User, User.id == AIUsageLog.user_id)
        .where(AIUsageLog.trace_id == trace_id)
        .order_by(AIUsageLog.id)
    ).all()


def overlapping_pricing(db: Session, item: AIModelPricing, exclude_id: int | None = None) -> bool:
    query = select(AIModelPricing.id).where(
        AIModelPricing.provider_id == item.provider_id,
        AIModelPricing.model_name == item.model_name,
        AIModelPricing.is_active.is_(True),
        AIModelPricing.effective_from < (item.effective_to or datetime.max),
        or_(AIModelPricing.effective_to.is_(None), AIModelPricing.effective_to > item.effective_from),
    )
    if exclude_id is not None:
        query = query.where(AIModelPricing.id != exclude_id)
    return db.scalar(query) is not None
