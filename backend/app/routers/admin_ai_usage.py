from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.db import ai_usage_dao
from app.db.engine import get_db
from app.db.models.ai_usage import AIModelPricing, AIUsageLog
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/admin/ai-usage", tags=["admin-ai-usage"])


def _bounds(start_date: date | None, end_date: date | None):
    try:
        return ai_usage_dao.date_bounds(start_date, end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _where(start_date: date | None, end_date: date | None, **filters: Any):
    start_at, end_at, start, end = _bounds(start_date, end_date)
    return start_at, end_at, start, end, ai_usage_dao.conditions(start_at, end_at, **filters)


def _log_item(row: AIUsageLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "request_id": row.request_id,
        "trace_id": row.trace_id,
        "parent_log_id": row.parent_log_id,
        "user_id": row.user_id,
        "user_snapshot": row.user_snapshot,
        "scene": row.scene,
        "operation": row.operation,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "provider_id": row.provider_id,
        "provider_name": row.provider_name,
        "model_id": row.model_id,
        "model_name": row.model_name,
        "key_alias": row.key_alias,
        "key_fingerprint": row.key_fingerprint,
        "key_masked": row.key_masked,
        "request_mode": row.request_mode,
        "attempt_no": row.attempt_no,
        "status": row.status,
        "error_type": row.error_type,
        "error_message": row.error_message,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "latency_ms": row.latency_ms,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "cached_input_tokens": row.cached_input_tokens,
        "reasoning_tokens": row.reasoning_tokens,
        "total_tokens": row.total_tokens,
        "token_source": row.token_source,
        "input_price_per_million": float(row.input_price_per_million) if row.input_price_per_million is not None else None,
        "output_price_per_million": float(row.output_price_per_million) if row.output_price_per_million is not None else None,
        "currency": row.currency,
        "estimated_cost": float(row.estimated_cost) if row.estimated_cost is not None else None,
        "prompt_content": row.prompt_content,
        "response_content": row.response_content,
        "prompt_sha256": row.prompt_sha256,
        "response_sha256": row.response_sha256,
        "metadata_json": row.metadata_json,
    }


@router.get("/overview")
def ai_usage_overview(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    user_id: int | None = Query(None),
    scene: str | None = Query(None),
    provider_id: str | None = Query(None),
    model_name: str | None = Query(None),
    key_fingerprint: str | None = Query(None),
    status: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    start_at, end_at, start, end, where = _where(
        start_date, end_date, user_id=user_id, scene=scene, provider_id=provider_id,
        model_name=model_name, key_fingerprint=key_fingerprint, status=status,
    )
    return R.success({
        **ai_usage_dao.overview(db, where),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    })


@router.get("/trend")
def ai_usage_trend(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    user_id: int | None = Query(None),
    scene: str | None = Query(None),
    provider_id: str | None = Query(None),
    model_name: str | None = Query(None),
    key_fingerprint: str | None = Query(None),
    status: str | None = Query(None),
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    start_at, end_at, start, end, where = _where(
        start_date, end_date, user_id=user_id, scene=scene, provider_id=provider_id,
        model_name=model_name, key_fingerprint=key_fingerprint, status=status,
    )
    values = {item["date"]: item for item in ai_usage_dao.trend(db, where)}
    result = []
    cursor = start
    while cursor <= end:
        result.append(values.get(cursor.isoformat(), {
            "date": cursor.isoformat(), "calls": 0, "input_tokens": 0,
            "output_tokens": 0, "total_tokens": 0, "estimated_cost": 0,
            "failed_calls": 0,
        }))
        cursor = cursor.fromordinal(cursor.toordinal() + 1)
    return R.success(result)


@router.get("/by-user")
def ai_usage_by_user(
    start_date: date | None = Query(None), end_date: date | None = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    scene: str | None = Query(None), model_name: str | None = Query(None),
    _: User = Depends(get_current_admin), db: Session = Depends(get_db),
):
    _, _, _, _, where = _where(start_date, end_date, scene=scene, model_name=model_name)
    values = ai_usage_dao.grouped(db, where, (AIUsageLog.user_id, AIUsageLog.user_snapshot), ("user_id", "user_snapshot"))
    offset = (page - 1) * page_size
    return R.success({"items": values[offset:offset + page_size], "total": len(values), "page": page, "page_size": page_size})


@router.get("/by-model")
def ai_usage_by_model(
    start_date: date | None = Query(None), end_date: date | None = Query(None),
    scene: str | None = Query(None), user_id: int | None = Query(None),
    _: User = Depends(get_current_admin), db: Session = Depends(get_db),
):
    _, _, _, _, where = _where(start_date, end_date, scene=scene, user_id=user_id)
    return R.success(ai_usage_dao.grouped(
        db, where,
        (AIUsageLog.provider_name, AIUsageLog.model_name, AIUsageLog.key_masked),
        ("provider_name", "model_name", "key_masked"),
    ))


@router.get("/by-scene")
def ai_usage_by_scene(
    start_date: date | None = Query(None), end_date: date | None = Query(None),
    user_id: int | None = Query(None), model_name: str | None = Query(None),
    _: User = Depends(get_current_admin), db: Session = Depends(get_db),
):
    _, _, _, _, where = _where(start_date, end_date, user_id=user_id, model_name=model_name)
    return R.success(ai_usage_dao.grouped(db, where, (AIUsageLog.scene,), ("scene",)))


@router.get("/logs")
def ai_usage_logs(
    start_date: date | None = Query(None), end_date: date | None = Query(None),
    user_id: int | None = Query(None), scene: str | None = Query(None),
    provider_id: str | None = Query(None), model_name: str | None = Query(None),
    key_fingerprint: str | None = Query(None), status: str | None = Query(None),
    keyword: str | None = Query(None), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(get_current_admin), db: Session = Depends(get_db),
):
    _, _, _, _, where = _where(
        start_date, end_date, user_id=user_id, scene=scene, provider_id=provider_id,
        model_name=model_name, key_fingerprint=key_fingerprint, status=status, keyword=keyword,
    )
    rows, total = ai_usage_dao.list_logs(db, where, page, page_size)
    return R.success({"items": [_log_item(row) for row in rows], "total": total, "page": page, "page_size": page_size})


@router.get("/logs/{log_id}")
def ai_usage_log_detail(log_id: int, _: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    row = ai_usage_dao.find_log(db, log_id)
    if not row:
        raise HTTPException(status_code=404, detail="AI 调用日志不存在")
    return R.success({"log": _log_item(row), "trace": [_log_item(item) for item in ai_usage_dao.find_trace(db, row.trace_id)]})


@router.get("/export")
def ai_usage_export(
    start_date: date | None = Query(None), end_date: date | None = Query(None),
    user_id: int | None = Query(None), scene: str | None = Query(None),
    provider_id: str | None = Query(None), model_name: str | None = Query(None),
    key_fingerprint: str | None = Query(None), status: str | None = Query(None), keyword: str | None = Query(None),
    _: User = Depends(get_current_admin), db: Session = Depends(get_db),
):
    _, _, _, _, where = _where(
        start_date, end_date, user_id=user_id, scene=scene, provider_id=provider_id,
        model_name=model_name, key_fingerprint=key_fingerprint, status=status, keyword=keyword,
    )
    rows, total = ai_usage_dao.list_logs(db, where, 1, 10_000)
    if total > 10_000:
        raise HTTPException(status_code=400, detail="导出结果超过 10000 条，请缩小筛选范围")
    output = io.StringIO()
    writer = csv.writer(output)
    fields = ["id", "started_at", "user_id", "scene", "provider_name", "model_name", "key_masked", "status", "input_tokens", "output_tokens", "total_tokens", "estimated_cost", "currency", "error_message"]
    writer.writerow(fields)
    for row in rows:
        item = _log_item(row)
        writer.writerow([item.get(field, "") for field in fields])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=ai_usage_logs.csv"})


class PricingCreate(BaseModel):
    provider_id: str | None = None
    provider_name: str = ""
    model_name: str = Field(min_length=1, max_length=160)
    input_price_per_million: Decimal = Field(ge=0)
    output_price_per_million: Decimal = Field(ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    effective_from: datetime
    effective_to: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class PricingPatch(BaseModel):
    input_price_per_million: Decimal | None = Field(default=None, ge=0)
    output_price_per_million: Decimal | None = Field(default=None, ge=0)
    effective_to: datetime | None = None
    is_active: bool | None = None
    note: str | None = Field(default=None, max_length=500)


def _pricing_item(row: AIModelPricing) -> dict[str, Any]:
    return {
        "id": row.id, "provider_id": row.provider_id, "provider_name": row.provider_name,
        "model_name": row.model_name, "input_price_per_million": float(row.input_price_per_million),
        "output_price_per_million": float(row.output_price_per_million), "currency": row.currency,
        "effective_from": row.effective_from.isoformat(), "effective_to": row.effective_to.isoformat() if row.effective_to else None,
        "is_active": bool(row.is_active), "note": row.note, "created_by": row.created_by,
    }


@router.get("/pricing")
def list_pricing(_: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AIModelPricing).order_by(AIModelPricing.effective_from.desc(), AIModelPricing.id.desc())).all()
    return R.success([_pricing_item(row) for row in rows])


@router.post("/pricing")
def create_pricing(data: PricingCreate, current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if data.effective_to and data.effective_to <= data.effective_from:
        raise HTTPException(status_code=400, detail="价格生效结束时间必须晚于开始时间")
    row = AIModelPricing(**data.model_dump(), created_by=current_admin.id)
    if ai_usage_dao.overlapping_pricing(db, row):
        raise HTTPException(status_code=400, detail="同一 Provider/模型的价格生效时间存在重叠")
    db.add(row)
    db.commit()
    db.refresh(row)
    return R.success(_pricing_item(row))


@router.patch("/pricing/{pricing_id}")
def patch_pricing(pricing_id: int, data: PricingPatch, _: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    row = db.get(AIModelPricing, pricing_id)
    if not row:
        raise HTTPException(status_code=404, detail="价格规则不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    if row.effective_to and row.effective_to <= row.effective_from:
        raise HTTPException(status_code=400, detail="价格生效结束时间必须晚于开始时间")
    if ai_usage_dao.overlapping_pricing(db, row, exclude_id=row.id):
        raise HTTPException(status_code=400, detail="同一 Provider/模型的价格生效时间存在重叠")
    db.commit()
    db.refresh(row)
    return R.success(_pricing_item(row))
