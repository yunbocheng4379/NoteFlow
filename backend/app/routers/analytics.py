"""Login-optional product analytics ingestion."""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user_optional
from app.auth.jwt_handler import SECRET_KEY
from app.db.engine import get_db
from app.db.models.analytics_events import AnalyticsEvent
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R

router = APIRouter(prefix="/analytics", tags=["analytics"])

_EVENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_.-]{1,63}$")
_PROPERTY_KEY_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,31}$")
_PRIMITIVE_TYPES = (str, int, float, bool)


class AnalyticsEventPayload(BaseModel):
    event_name: str
    page_path: str = ""
    target: str | None = None
    visitor_id: str | None = None
    session_id: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_name")
    @classmethod
    def validate_event_name(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EVENT_NAME_RE.fullmatch(value):
            raise ValueError("event_name 格式无效")
        return value

    @field_validator("page_path")
    @classmethod
    def validate_page_path(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 255:
            raise ValueError("page_path 过长")
        return value

    @field_validator("target", "visitor_id", "session_id")
    @classmethod
    def validate_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value[:128] if value else None

    @field_validator("properties")
    @classmethod
    def validate_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 12:
            raise ValueError("properties 最多支持 12 个字段")
        safe: dict[str, Any] = {}
        for key, item in value.items():
            if not _PROPERTY_KEY_RE.fullmatch(str(key)):
                raise ValueError("properties 存在无效字段名")
            if item is not None and not isinstance(item, _PRIMITIVE_TYPES):
                raise ValueError("properties 只支持基础类型")
            if isinstance(item, str) and len(item) > 160:
                raise ValueError("properties 字符串值过长")
            safe[str(key)] = item
        return safe


class AnalyticsBatchRequest(BaseModel):
    events: list[AnalyticsEventPayload] = Field(min_length=1, max_length=50)


def _visitor_key(visitor_id: str | None) -> str | None:
    if not visitor_id:
        return None
    return hmac.new(
        SECRET_KEY.encode("utf-8"),
        visitor_id.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@router.post("/events")
def ingest_events(
    body: AnalyticsBatchRequest,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Store a bounded batch of analytics events without blocking product flows."""
    user_id = int(current_user.id) if current_user else None
    records: list[AnalyticsEvent] = []
    now = datetime.now()

    for event in body.events:
        visitor_key = _visitor_key(event.visitor_id)
        identity_key = f"u:{user_id}" if user_id is not None else (
            f"v:{visitor_key}" if visitor_key else None
        )
        records.append(
            AnalyticsEvent(
                event_name=event.event_name,
                page_path=event.page_path,
                target=event.target,
                user_id=user_id,
                visitor_key=visitor_key,
                identity_key=identity_key,
                session_id=event.session_id,
                properties=event.properties or None,
                occurred_at=now,
            )
        )

    try:
        db.add_all(records)
        db.commit()
    except Exception:
        db.rollback()
        # Analytics must never turn into a product outage. The client already
        # treats this endpoint as best-effort, so acknowledge the batch safely.
        return R.success({"accepted": 0})

    return R.success({"accepted": len(records)})
