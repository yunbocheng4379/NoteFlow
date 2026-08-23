"""Administrator-only analytics queries for PV/UV and product events."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.db.engine import get_db
from app.db.models.analytics_events import AnalyticsEvent
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/admin/analytics", tags=["admin-analytics"])

_FEATURE_EVENTS = ("feature_click", "feature_submit", "feature_success", "feature_error")


def _date_bounds(start_date: date | None, end_date: date | None) -> tuple[datetime, datetime, date, date]:
    today = date.today()
    start = start_date or (today - timedelta(days=6))
    end = end_date or today
    if end < start:
        raise HTTPException(status_code=400, detail="结束日期不能早于开始日期")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="查询范围不能超过 367 天")
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min), start, end


def _conditions(
    start_at: datetime,
    end_at: datetime,
    event_name: str | None = None,
    page_path: str | None = None,
    target: str | None = None,
):
    conditions: list[Any] = [
        AnalyticsEvent.occurred_at >= start_at,
        AnalyticsEvent.occurred_at < end_at,
    ]
    if event_name:
        conditions.append(AnalyticsEvent.event_name == event_name.strip().lower())
    if page_path:
        conditions.append(AnalyticsEvent.page_path == page_path.strip())
    if target:
        conditions.append(AnalyticsEvent.target == target.strip())
    return conditions


def _query_params(
    start_date: date | None,
    end_date: date | None,
    event_name: str | None,
    page_path: str | None,
    target: str | None,
):
    start_at, end_at, start, end = _date_bounds(start_date, end_date)
    return start_at, end_at, start, end, _conditions(start_at, end_at, event_name, page_path, target)


@router.get("/overview")
def analytics_overview(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    event_name: str | None = Query(None),
    page_path: str | None = Query(None),
    target: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    start_at, end_at, start, end, conditions = _query_params(
        start_date, end_date, event_name, page_path, target
    )
    page_view_conditions = [*conditions, AnalyticsEvent.event_name == "page_view"]
    feature_conditions = [*conditions, AnalyticsEvent.event_name.in_(_FEATURE_EVENTS)]
    row = db.execute(
        select(
            func.count(AnalyticsEvent.id),
            func.count(func.distinct(AnalyticsEvent.identity_key)),
            func.count(func.distinct(case((AnalyticsEvent.user_id.is_not(None), AnalyticsEvent.user_id)))),
            func.count(func.distinct(case((AnalyticsEvent.user_id.is_(None), AnalyticsEvent.visitor_key)))),
        ).where(*page_view_conditions)
    ).one()
    feature_count = db.execute(
        select(func.count(AnalyticsEvent.id)).where(*feature_conditions)
    ).scalar_one()
    success_count = db.execute(
        select(func.count(AnalyticsEvent.id)).where(
            *conditions,
            AnalyticsEvent.event_name == "feature_success",
        )
    ).scalar_one()
    error_count = db.execute(
        select(func.count(AnalyticsEvent.id)).where(
            *conditions,
            AnalyticsEvent.event_name == "feature_error",
        )
    ).scalar_one()

    return R.success({
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "pv": int(row[0] or 0),
        "uv": int(row[1] or 0),
        "logged_in_uv": int(row[2] or 0),
        "anonymous_uv": int(row[3] or 0),
        "active_users": int(row[1] or 0),
        "feature_events": int(feature_count or 0),
        "feature_success": int(success_count or 0),
        "feature_error": int(error_count or 0),
        "feature_success_rate": round(
            int(success_count or 0) / max(1, int(success_count or 0) + int(error_count or 0)) * 100,
            1,
        ),
    })


@router.get("/trend")
def analytics_trend(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    page_path: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    start_at, end_at, start, end, conditions = _query_params(start_date, end_date, None, page_path, None)
    day = func.date(AnalyticsEvent.occurred_at).label("day")
    rows = db.execute(
        select(
            day,
            func.count(AnalyticsEvent.id),
            func.count(func.distinct(AnalyticsEvent.identity_key)),
            func.count(func.distinct(case((AnalyticsEvent.user_id.is_not(None), AnalyticsEvent.user_id)))),
            func.count(func.distinct(case((AnalyticsEvent.user_id.is_(None), AnalyticsEvent.visitor_key)))),
        )
        .where(*conditions, AnalyticsEvent.event_name == "page_view")
        .group_by(day)
        .order_by(day)
    ).all()
    values = {
        str(row[0]): {
            "date": str(row[0]),
            "pv": int(row[1] or 0),
            "uv": int(row[2] or 0),
            "logged_in_uv": int(row[3] or 0),
            "anonymous_uv": int(row[4] or 0),
        }
        for row in rows
    }
    result = []
    cursor = start
    while cursor <= end:
        result.append(values.get(cursor.isoformat(), {
            "date": cursor.isoformat(), "pv": 0, "uv": 0,
            "logged_in_uv": 0, "anonymous_uv": 0,
        }))
        cursor += timedelta(days=1)
    return R.success(result)


@router.get("/features")
def analytics_features(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    page_path: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _, _, _, _, conditions = _query_params(start_date, end_date, None, page_path, None)
    active_uv = db.execute(
        select(func.count(func.distinct(AnalyticsEvent.identity_key))).where(
            *conditions,
            AnalyticsEvent.event_name == "page_view",
        )
    ).scalar_one()
    feature = func.coalesce(AnalyticsEvent.target, AnalyticsEvent.event_name).label("feature")
    rows = db.execute(
        select(
            feature,
            func.count(case((AnalyticsEvent.event_name == "feature_click", 1))),
            func.count(case((AnalyticsEvent.event_name == "feature_submit", 1))),
            func.count(case((AnalyticsEvent.event_name == "feature_success", 1))),
            func.count(case((AnalyticsEvent.event_name == "feature_error", 1))),
            func.count(func.distinct(AnalyticsEvent.identity_key)),
        )
        .where(*conditions, AnalyticsEvent.event_name.in_(_FEATURE_EVENTS))
        .group_by(feature)
        .order_by(func.count(AnalyticsEvent.id).desc())
    ).all()
    return R.success([
        {
            "feature": str(row[0]),
            "clicks": int(row[1] or 0),
            "submits": int(row[2] or 0),
            "successes": int(row[3] or 0),
            "errors": int(row[4] or 0),
            "users": int(row[5] or 0),
            "usage_rate": round(int(row[5] or 0) / max(1, int(active_uv or 0)) * 100, 1),
            "success_rate": round(int(row[3] or 0) / max(1, int(row[3] or 0) + int(row[4] or 0)) * 100, 1),
        }
        for row in rows
    ])


@router.get("/users")
def analytics_users(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _, _, _, _, conditions = _query_params(start_date, end_date, None, None, None)
    conditions.append(AnalyticsEvent.user_id.is_not(None))
    user_day = func.date(AnalyticsEvent.occurred_at)
    base = (
        select(
            AnalyticsEvent.user_id.label("user_id"),
            func.sum(case((AnalyticsEvent.event_name == "page_view", 1), else_=0)).label("pv"),
            func.count(func.distinct(user_day)).label("active_days"),
            func.count(func.distinct(AnalyticsEvent.target)).label("feature_count"),
            func.max(AnalyticsEvent.occurred_at).label("last_seen_at"),
        )
        .join(User, User.id == AnalyticsEvent.user_id)
        .where(*conditions)
        .group_by(AnalyticsEvent.user_id)
    )
    if keyword:
        like = f"%{keyword.strip()}%"
        base = base.where(or_(User.username.like(like), User.email.like(like)))
    subquery = base.subquery()
    total = db.execute(select(func.count()).select_from(subquery)).scalar_one()
    rows = db.execute(
        select(subquery, User.username, User.email)
        .join(User, User.id == subquery.c.user_id)
        .order_by(subquery.c.pv.desc(), subquery.c.last_seen_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return R.success({
        "list": [
            {
                "user_id": int(row.user_id),
                "username": row.username,
                "email": row.email,
                "pv": int(row.pv or 0),
                "active_days": int(row.active_days or 0),
                "feature_count": int(row.feature_count or 0),
                "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
            }
            for row in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    })


@router.get("/events")
def analytics_events(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    event_name: str | None = Query(None),
    page_path: str | None = Query(None),
    target: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _, _, _, _, conditions = _query_params(start_date, end_date, event_name, page_path, target)
    base = select(AnalyticsEvent, User.username).outerjoin(User, User.id == AnalyticsEvent.user_id).where(*conditions)
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.order_by(AnalyticsEvent.occurred_at.desc(), AnalyticsEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return R.success({
        "list": [
            {
                "id": int(event.id),
                "event_name": event.event_name,
                "page_path": event.page_path,
                "target": event.target,
                "user_type": "登录用户" if event.user_id is not None else "匿名访客",
                "username": username,
                "properties": event.properties or {},
                "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
            }
            for event, username in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    })
