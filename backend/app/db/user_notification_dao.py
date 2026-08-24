from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.db.engine import SessionLocal
from app.db.models.user_notifications import UserNotification


def _fmt(value):
    return value.isoformat() if hasattr(value, "isoformat") and value else value


def _to_dict(row: UserNotification) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "title": row.title,
        "content": row.content,
        "source_type": row.source_type,
        "source_id": row.source_id,
        "link": row.link,
        "severity": row.severity,
        "is_read": bool(row.is_read),
        "read_at": _fmt(row.read_at),
        "created_at": _fmt(row.created_at),
    }


def publish(
    *,
    user_id: int,
    category: str,
    title: str,
    content: str,
    source_type: str,
    source_id: str,
    link: Optional[str] = None,
    severity: str = "info",
) -> dict:
    db: Session = SessionLocal()
    try:
        row = (
            db.query(UserNotification)
            .filter(
                UserNotification.user_id == user_id,
                UserNotification.category == category,
                UserNotification.source_type == source_type,
                UserNotification.source_id == str(source_id),
            )
            .first()
        )
        if row is None:
            row = UserNotification(
                user_id=user_id,
                category=category,
                title=title,
                content=content,
                source_type=source_type,
                source_id=str(source_id),
                link=link,
                severity=severity,
            )
            db.add(row)
        else:
            row.title = title
            row.content = content
            row.link = link
            row.severity = severity
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def list_for_user(*, user_id: int, page: int = 1, page_size: int = 20, unread_only: bool = False):
    db: Session = SessionLocal()
    try:
        query = db.query(UserNotification).filter(UserNotification.user_id == user_id)
        if unread_only:
            query = query.filter(UserNotification.is_read.is_(False))
        total = query.count()
        rows = (
            query.order_by(UserNotification.created_at.desc(), UserNotification.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [_to_dict(row) for row in rows], total
    finally:
        db.close()


def unread_count(*, user_id: int) -> int:
    db: Session = SessionLocal()
    try:
        return (
            db.query(UserNotification)
            .filter(UserNotification.user_id == user_id, UserNotification.is_read.is_(False))
            .count()
        )
    finally:
        db.close()


def mark_read(*, user_id: int, notification_id: int) -> Optional[dict]:
    db: Session = SessionLocal()
    try:
        row = (
            db.query(UserNotification)
            .filter(UserNotification.id == notification_id, UserNotification.user_id == user_id)
            .first()
        )
        if row is None:
            return None
        row.is_read = True
        row.read_at = datetime.now()
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    finally:
        db.close()


def mark_all_read(*, user_id: int) -> int:
    db: Session = SessionLocal()
    try:
        now = datetime.now()
        count = (
            db.query(UserNotification)
            .filter(UserNotification.user_id == user_id, UserNotification.is_read.is_(False))
            .update({UserNotification.is_read: True, UserNotification.read_at: now}, synchronize_session=False)
        )
        db.commit()
        return int(count or 0)
    finally:
        db.close()
