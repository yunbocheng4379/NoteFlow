"""
通知 DAO. 应用层不允许物理删除; 只允许状态流转.
"""
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models.notifications import (
    Notification,
    NOTIFICATION_STATUSES,
    NOTIFICATION_CATEGORIES,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _fmt(v):
    return v.isoformat() if hasattr(v, "isoformat") and v else v


def _to_dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "category": n.category,
        "severity": n.severity,
        "title": n.title,
        "content": n.content,
        "source_type": n.source_type,
        "source_id": n.source_id,
        "platform": n.platform,
        "status": n.status,
        "dedup_key": n.dedup_key,
        "first_seen_at": _fmt(n.first_seen_at),
        "last_seen_at": _fmt(n.last_seen_at),
        "occurrence_count": n.occurrence_count,
        "handled_by": n.handled_by,
        "handled_at": _fmt(n.handled_at),
        "handler_note": n.handler_note,
        "created_at": _fmt(n.created_at),
        "updated_at": _fmt(n.updated_at),
    }


def find_by_dedup_key(dedup_key: str) -> Optional[Notification]:
    db: Session = next(get_db())
    try:
        return db.query(Notification).filter(Notification.dedup_key == dedup_key).first()
    finally:
        db.close()


def upsert_for_publish(
    *,
    dedup_key: str,
    category: str,
    severity: str,
    title: str,
    content: str,
    source_type: Optional[str],
    source_id: Optional[str],
    platform: Optional[str],
    dedup_window_seconds: int = 60,
) -> Tuple[Notification, str]:
    """幂等 publish.

    返回 (record, state), 其中 state ∈ ``"created" | "merged"``.
    - "created": 本次在窗口外命中, 新建或重新打开已有记录 (last_seen_at / occurrence_count).
    - "merged": 窗口内命中, 只更新 last_seen_at / occurrence_count, 不创建新行.
    """
    if category not in NOTIFICATION_CATEGORIES:
        raise ValueError(f"非法通知分类: {category}")

    db: Session = next(get_db())
    try:
        existing = (
            db.query(Notification)
            .filter(Notification.dedup_key == dedup_key)
            .first()
        )

        now = datetime.now()
        if existing is None:
            row = Notification(
                dedup_key=dedup_key,
                category=category,
                severity=severity,
                title=title,
                content=content,
                source_type=source_type,
                source_id=source_id,
                platform=platform,
                first_seen_at=now,
                last_seen_at=now,
                occurrence_count=1,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row, "created"

        # 已有 dedup_key
        in_window = (now - existing.last_seen_at) < timedelta(seconds=dedup_window_seconds)
        if in_window:
            # 窗口内: 不增加 occurrence_count, 只刷新 last_seen_at
            # 这里选择性累加 1 表示「最近窗口又触发过一次」, 业务可读
            existing.last_seen_at = now
            existing.occurrence_count = (existing.occurrence_count or 0)
            # 复用: occurrence_count 在面板展示时仍递增, 这样管理员能看到该问题持续
            # 但不在数据库里塞新行.
            existing.occurrence_count += 1
            db.commit()
            db.refresh(existing)
            return existing, "merged"

        # 窗口外: 重新激活, occurrence_count 重置为 1
        existing.last_seen_at = now
        existing.occurrence_count = 1
        # 窗口外不能自动改 status — 由管理员决定
        db.commit()
        db.refresh(existing)
        return existing, "created"
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_by_id(notification_id: int) -> Optional[Notification]:
    db: Session = next(get_db())
    try:
        return db.query(Notification).filter(Notification.id == notification_id).first()
    finally:
        db.close()


def list_filter(
    *,
    status: Optional[str] = None,
    category: Optional[str] = None,
    platform: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[dict], int]:
    if status and status not in NOTIFICATION_STATUSES:
        raise ValueError(f"非法状态: {status}")
    if category and category not in NOTIFICATION_CATEGORIES:
        raise ValueError(f"非法分类: {category}")
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20

    db: Session = next(get_db())
    try:
        q = db.query(Notification)
        if status:
            q = q.filter(Notification.status == status)
        if category:
            q = q.filter(Notification.category == category)
        if platform:
            q = q.filter(Notification.platform == platform)
        if keyword:
            like = f"%{keyword.strip()}%"
            q = q.filter(
                (Notification.title.like(like)) | (Notification.content.like(like))
            )

        total = q.count()
        rows = (
            q.order_by(Notification.last_seen_at.desc(), Notification.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [_to_dict(r) for r in rows], total
    finally:
        db.close()


def count_by_status() -> dict:
    db: Session = next(get_db())
    try:
        counts = {s: 0 for s in NOTIFICATION_STATUSES}
        counts["total"] = 0
        rows = db.query(Notification.status, Notification.id).all()
        for status, _ in rows:
            counts["total"] += 1
            if status in counts:
                counts[status] += 1
        return counts
    finally:
        db.close()


def count_unread() -> int:
    """pending 数量, 顶栏 badge 用."""
    db: Session = next(get_db())
    try:
        return (
            db.query(Notification)
            .filter(Notification.status == "pending")
            .count()
        )
    finally:
        db.close()


def update_status(
    *,
    notification_id: int,
    status: str,
    handler_note: Optional[str],
    handled_by: Optional[int],
) -> Optional[Notification]:
    if status not in NOTIFICATION_STATUSES:
        raise ValueError(f"非法状态: {status}")
    db: Session = next(get_db())
    try:
        row = db.query(Notification).filter(Notification.id == notification_id).first()
        if not row:
            return None
        row.status = status
        if handler_note is not None:
            row.handler_note = handler_note.strip() or None
        row.handled_by = handled_by
        row.handled_at = datetime.now()
        db.commit()
        db.refresh(row)
        return row
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
