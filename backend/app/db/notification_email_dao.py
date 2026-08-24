"""Persistence helpers for administrator system-notification email delivery."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError

from app.db.engine import SessionLocal
from app.db.models.notifications import Notification
from app.db.models.users import User
from app.db.models.notification_email import (
    NotificationEmailBatch,
    NotificationEmailBatchItem,
    NotificationEmailDelivery,
)


def _fmt(value):
    return value.isoformat() if hasattr(value, "isoformat") and value else value


def _batch_to_dict(row: NotificationEmailBatch) -> dict:
    return {
        "id": row.id,
        "batch_key": row.batch_key,
        "batch_type": row.batch_type,
        "status": row.status,
        "created_at": _fmt(row.created_at),
        "sent_at": _fmt(row.sent_at),
        "last_error": row.last_error,
    }


def _notification_to_dict(row: Notification) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "severity": row.severity,
        "title": row.title,
        "content": row.content,
        "platform": row.platform,
        "status": row.status,
        "first_seen_at": _fmt(row.first_seen_at),
        "last_seen_at": _fmt(row.last_seen_at),
        "occurrence_count": row.occurrence_count,
    }


def _delivery_to_dict(row: NotificationEmailDelivery) -> dict:
    return {
        "id": row.id,
        "batch_id": row.batch_id,
        "recipient_user_id": row.recipient_user_id,
        "recipient_email": row.recipient_email,
        "status": row.status,
        "attempt_count": row.attempt_count,
        "last_error": row.last_error,
        "sent_at": _fmt(row.sent_at),
        "updated_at": _fmt(row.updated_at),
    }


def create_batch(*, batch_key: str, batch_type: str) -> dict:
    db = SessionLocal()
    try:
        existing = db.query(NotificationEmailBatch).filter_by(batch_key=batch_key).first()
        if existing:
            return _batch_to_dict(existing)

        row = NotificationEmailBatch(batch_key=batch_key, batch_type=batch_type)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.query(NotificationEmailBatch).filter_by(batch_key=batch_key).one()
            return _batch_to_dict(row)
        db.refresh(row)
        return _batch_to_dict(row)
    finally:
        db.close()


def get_batch_by_key(batch_key: str) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.query(NotificationEmailBatch).filter_by(batch_key=batch_key).first()
        return _batch_to_dict(row) if row else None
    finally:
        db.close()


def add_batch_items(*, batch_id: int, notifications: Iterable[dict]) -> list[dict]:
    db = SessionLocal()
    try:
        existing_ids = {
            item.notification_id
            for item in db.query(NotificationEmailBatchItem)
            .filter(NotificationEmailBatchItem.batch_id == batch_id)
            .all()
        }
        rows = []
        for item in notifications:
            if item["id"] in existing_ids:
                continue
            rows.append(
                NotificationEmailBatchItem(
                    batch_id=batch_id,
                    notification_id=item["id"],
                    title=item["title"],
                    content=item["content"],
                    severity=item.get("severity") or "warning",
                    platform=item.get("platform"),
                )
            )
        if rows:
            db.add_all(rows)
            db.commit()
            for row in rows:
                db.refresh(row)
        return [
            {
                "id": row.id,
                "notification_id": row.notification_id,
                "title": row.title,
                "content": row.content,
                "severity": row.severity,
                "platform": row.platform,
            }
            for row in rows
        ]
    finally:
        db.close()


def get_batch_items(batch_id: int) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(NotificationEmailBatchItem)
            .filter(NotificationEmailBatchItem.batch_id == batch_id)
            .order_by(NotificationEmailBatchItem.id.asc())
            .all()
        )
        return [
            {
                "id": row.id,
                "notification_id": row.notification_id,
                "title": row.title,
                "content": row.content,
                "severity": row.severity,
                "platform": row.platform,
            }
            for row in rows
        ]
    finally:
        db.close()


def list_eligible_admins(*, require_pending_preference: bool = True) -> list[dict]:
    db = SessionLocal()
    try:
        filters = [
            User.is_admin == 1,
            User.is_active == 1,
            User.email_notify_enabled == 1,
            User.email.isnot(None),
            User.email != "",
        ]
        if require_pending_preference:
            filters.append(User.pending_notification_email_enabled == 1)
        rows = (
            db.query(User)
            .filter(*filters)
            .order_by(User.id.asc())
            .all()
        )
        return [{"id": row.id, "email": row.email, "username": row.username} for row in rows]
    finally:
        db.close()


def list_pending_notifications() -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(Notification)
            .filter(Notification.status == "pending")
            .order_by(Notification.last_seen_at.desc(), Notification.id.desc())
            .all()
        )
        return [_notification_to_dict(row) for row in rows]
    finally:
        db.close()


def get_or_create_delivery(*, batch_id: int, recipient_user_id: int, recipient_email: str) -> dict:
    db = SessionLocal()
    try:
        row = (
            db.query(NotificationEmailDelivery)
            .filter(
                NotificationEmailDelivery.batch_id == batch_id,
                NotificationEmailDelivery.recipient_user_id == recipient_user_id,
            )
            .first()
        )
        if row:
            return _delivery_to_dict(row)
        row = NotificationEmailDelivery(
            batch_id=batch_id,
            recipient_user_id=recipient_user_id,
            recipient_email=recipient_email,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = (
                db.query(NotificationEmailDelivery)
                .filter(
                    NotificationEmailDelivery.batch_id == batch_id,
                    NotificationEmailDelivery.recipient_user_id == recipient_user_id,
                )
                .one()
            )
            return _delivery_to_dict(row)
        db.refresh(row)
        return _delivery_to_dict(row)
    finally:
        db.close()


def mark_delivery_result(
    *,
    delivery_id: int,
    status: str,
    attempt_count: int,
    last_error: Optional[str] = None,
) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.get(NotificationEmailDelivery, delivery_id)
        if not row:
            return None
        row.status = status
        row.attempt_count = attempt_count
        row.last_error = last_error
        row.updated_at = datetime.now()
        if status == "sent":
            row.sent_at = datetime.now()
        db.commit()
        db.refresh(row)
        return _delivery_to_dict(row)
    finally:
        db.close()


def update_batch_status(
    *, batch_id: int, status: str, last_error: Optional[str] = None
) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.get(NotificationEmailBatch, batch_id)
        if not row:
            return None
        row.status = status
        row.last_error = last_error
        if status == "sent":
            row.sent_at = datetime.now()
        db.commit()
        db.refresh(row)
        return _batch_to_dict(row)
    finally:
        db.close()
