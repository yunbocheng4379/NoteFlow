from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.db.models.ai_usage import AIModelPricing, AIUsageLog


def date_bounds(start_date: date | None, end_date: date | None) -> tuple[datetime, datetime, date, date]:
    today = date.today()
    start = start_date or (today - timedelta(days=6))
    end = end_date or today
    if end < start:
        raise ValueError("结束日期不能早于开始日期")
    if (end - start).days > 366:
        raise ValueError("查询范围不能超过 367 天")
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min), start, end


def conditions(
    start_at: datetime,
    end_at: datetime,
    *,
    user_id: int | None = None,
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
    if scene:
        result.append(AIUsageLog.scene == scene.strip())
    if provider_id:
        result.append(AIUsageLog.provider_id == provider_id.strip())
    if model_name:
        result.append(AIUsageLog.model_name == model_name.strip())
    if key_fingerprint:
        result.append(AIUsageLog.key_fingerprint == key_fingerprint.strip())
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
            func.sum(case((AIUsageLog.estimated_cost.is_(None), 1), else_=0)),
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


def grouped(db: Session, where: list[Any], group_columns: tuple[Any, ...], names: tuple[str, ...]) -> list[dict[str, Any]]:
    rows = db.execute(
        select(*group_columns, func.count(func.distinct(AIUsageLog.trace_id)), _sum(AIUsageLog.input_tokens),
               _sum(AIUsageLog.output_tokens), _sum(AIUsageLog.total_tokens), _sum(AIUsageLog.estimated_cost),
               _failed_final_trace())
        .where(*where).group_by(*group_columns).order_by(_sum(AIUsageLog.total_tokens).desc())
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


def list_logs(db: Session, where: list[Any], page: int, page_size: int) -> tuple[list[AIUsageLog], int]:
    total = db.scalar(select(func.count(AIUsageLog.id)).where(*where)) or 0
    rows = db.scalars(
        select(AIUsageLog).where(*where)
        .order_by(AIUsageLog.started_at.desc(), AIUsageLog.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return rows, int(total)


def find_log(db: Session, log_id: int) -> AIUsageLog | None:
    return db.get(AIUsageLog, log_id)


def find_trace(db: Session, trace_id: str) -> list[AIUsageLog]:
    return db.scalars(select(AIUsageLog).where(AIUsageLog.trace_id == trace_id).order_by(AIUsageLog.id)).all()


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
