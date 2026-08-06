"""
管理员: 电力计费率管理 API.

前缀: ``/api/admin/pricing`` (注册时由 app/__init__.py 加 ``/api`` 前缀).

覆盖两张费率表:
  - credit_pricing:        模型每分钟费率 (含 __default__ 兜底行)
  - credit_format_pricing: 笔记格式 (toc/link/screenshot/summary) 每分钟叠加费率

仅管理员可访问.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.db.credit_format_pricing_dao import CreditFormatPricingDAO
from app.db.credit_pricing_dao import CreditPricingDAO
from app.db.engine import get_db
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/admin/pricing", tags=["admin-pricing"])


# ============================================================================
# 序列化
# ============================================================================

def _serialize_model_rate(row) -> dict:
    return {
        "id": row.id,
        "model_name": row.model_name,
        "rate_per_minute": row.rate_per_minute,
        "is_active": bool(row.is_active),
        "is_default": bool(row.is_default),
        "description": row.description,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_format_rate(row) -> dict:
    return {
        "id": row.id,
        "format_key": row.format_key,
        "rate_per_minute": row.rate_per_minute,
        "is_active": bool(row.is_active),
        "description": row.description,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ============================================================================
# 模型费率 (credit_pricing)
# ============================================================================

class UpsertModelRateRequest(BaseModel):
    model_name: str = Field(..., min_length=1, max_length=128,
                             description="模型名, __default__ 表示兜底行")
    rate_per_minute: int = Field(..., ge=0, description="每分钟消耗电力 (整数, >=0)")
    is_active: Optional[bool] = True
    is_default: Optional[bool] = False
    description: Optional[str] = None


class UpdateModelRateRequest(BaseModel):
    rate_per_minute: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


@router.get("/model")
def list_model_rates(
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    rows = CreditPricingDAO(db).get_all()
    return R.success([_serialize_model_rate(r) for r in rows])


@router.post("/model")
def upsert_model_rate(
    body: UpsertModelRateRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """新增/覆盖一条模型费率. 已存在 (按 model_name) 则更新, 否则新增."""
    dao = CreditPricingDAO(db)
    existing = dao.get_by_model_name(body.model_name)
    if existing:
        row = dao.update(
            body.model_name,
            rate_per_minute=body.rate_per_minute,
            is_active=1 if body.is_active else 0,
            is_default=1 if body.is_default else 0,
            description=body.description,
        )
    else:
        row = dao.create(
            model_name=body.model_name,
            rate_per_minute=body.rate_per_minute,
            is_active=1 if body.is_active else 0,
            is_default=1 if body.is_default else 0,
            description=body.description,
        )
    return R.success(_serialize_model_rate(row))


@router.patch("/model/{model_name}")
def update_model_rate(
    model_name: str,
    body: UpdateModelRateRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    dao = CreditPricingDAO(db)
    row = dao.update(
        model_name,
        rate_per_minute=body.rate_per_minute,
        is_active=(1 if body.is_active else 0) if body.is_active is not None else None,
        is_default=(1 if body.is_default else 0) if body.is_default is not None else None,
        description=body.description,
    )
    if not row:
        return R.error(msg=f"未找到模型费率: {model_name}", code=404)
    return R.success(_serialize_model_rate(row))


@router.delete("/model/{model_name}")
def delete_model_rate(
    model_name: str,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if model_name == "__default__":
        return R.error(msg="__default__ 兜底行不允许删除, 请改成停用", code=400)
    ok = CreditPricingDAO(db).delete(model_name)
    if not ok:
        return R.error(msg=f"未找到模型费率: {model_name}", code=404)
    return R.success({"deleted": model_name})


# ============================================================================
# 格式费率 (credit_format_pricing)
# ============================================================================

class UpsertFormatRateRequest(BaseModel):
    format_key: str = Field(..., min_length=1, max_length=64,
                             description="格式标识: toc/link/screenshot/summary")
    rate_per_minute: int = Field(..., ge=0)
    is_active: Optional[bool] = True
    description: Optional[str] = None


class UpdateFormatRateRequest(BaseModel):
    rate_per_minute: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    description: Optional[str] = None


@router.get("/format")
def list_format_rates(
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    rows = CreditFormatPricingDAO(db).get_all()
    return R.success([_serialize_format_rate(r) for r in rows])


@router.post("/format")
def upsert_format_rate(
    body: UpsertFormatRateRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    dao = CreditFormatPricingDAO(db)
    existing = dao.get_by_format_key(body.format_key)
    if existing:
        row = dao.update(
            body.format_key,
            rate_per_minute=body.rate_per_minute,
            is_active=1 if body.is_active else 0,
            description=body.description,
        )
    else:
        row = dao.create(
            format_key=body.format_key,
            rate_per_minute=body.rate_per_minute,
            is_active=1 if body.is_active else 0,
            description=body.description,
        )
    return R.success(_serialize_format_rate(row))


@router.patch("/format/{format_key}")
def update_format_rate(
    format_key: str,
    body: UpdateFormatRateRequest,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    dao = CreditFormatPricingDAO(db)
    row = dao.update(
        format_key,
        rate_per_minute=body.rate_per_minute,
        is_active=(1 if body.is_active else 0) if body.is_active is not None else None,
        description=body.description,
    )
    if not row:
        return R.error(msg=f"未找到格式费率: {format_key}", code=404)
    return R.success(_serialize_format_rate(row))


@router.delete("/format/{format_key}")
def delete_format_rate(
    format_key: str,
    _: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    ok = CreditFormatPricingDAO(db).delete(format_key)
    if not ok:
        return R.error(msg=f"未找到格式费率: {format_key}", code=404)
    return R.success({"deleted": format_key})
