from datetime import datetime
from typing import Optional, List, Tuple

from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models.feedbacks import (
    Feedback,
    FEEDBACK_STATUS_PENDING,
    FEEDBACK_STATUSES,
    FEEDBACK_CATEGORIES,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_feedback(
    *,
    user_id: Optional[int],
    category: str,
    content: str,
    title: Optional[str] = None,
    contact: Optional[str] = None,
) -> Feedback:
    if category not in FEEDBACK_CATEGORIES:
        raise ValueError(f"非法反馈分类: {category}")
    if not content or not content.strip():
        raise ValueError("反馈内容不能为空")

    db: Session = next(get_db())
    try:
        record = Feedback(
            user_id=user_id,
            category=category,
            title=(title or None),
            content=content.strip(),
            contact=(contact or None),
            status=FEEDBACK_STATUS_PENDING,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except Exception as e:
        db.rollback()
        logger.error(f"create_feedback failed: {e}")
        raise
    finally:
        db.close()


def get_feedback(feedback_id: int) -> Optional[Feedback]:
    db: Session = next(get_db())
    try:
        return db.query(Feedback).filter(Feedback.id == feedback_id).first()
    finally:
        db.close()


def list_feedbacks(
    *,
    status: Optional[str] = None,
    category: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Feedback], int]:
    """按筛选条件分页查询反馈。返回 (items, total)。"""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20

    db: Session = next(get_db())
    try:
        q = db.query(Feedback)
        if status:
            if status not in FEEDBACK_STATUSES:
                raise ValueError(f"非法状态: {status}")
            q = q.filter(Feedback.status == status)
        if category:
            if category not in FEEDBACK_CATEGORIES:
                raise ValueError(f"非法分类: {category}")
            q = q.filter(Feedback.category == category)
        if keyword:
            like = f"%{keyword.strip()}%"
            q = q.filter((Feedback.title.like(like)) | (Feedback.content.like(like)))

        total = q.count()
        items = (
            q.order_by(Feedback.created_at.desc(), Feedback.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total
    finally:
        db.close()


def update_status(
    *,
    feedback_id: int,
    status: str,
    admin_note: Optional[str],
    handled_by: Optional[int],
) -> Optional[Feedback]:
    if status not in FEEDBACK_STATUSES:
        raise ValueError(f"非法状态: {status}")

    db: Session = next(get_db())
    try:
        record = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not record:
            return None
        record.status = status
        # admin_note 显式传 None 时清空；不传则保持原值（路由层用 sentinel 区分）
        if admin_note is not None:
            record.admin_note = admin_note.strip() or None
        record.handled_by = handled_by
        record.handled_at = datetime.now()
        db.commit()
        db.refresh(record)
        return record
    except Exception as e:
        db.rollback()
        logger.error(f"update_status failed: {e}")
        raise
    finally:
        db.close()


def count_by_status() -> dict:
    """统计各状态数量，用于看板顶部小卡片。"""
    db: Session = next(get_db())
    try:
        rows = (
            db.query(Feedback.status, Feedback.id)
            .all()
        )
        counts = {s: 0 for s in FEEDBACK_STATUSES}
        counts["total"] = 0
        for status, _ in rows:
            counts["total"] += 1
            if status in counts:
                counts[status] += 1
        return counts
    finally:
        db.close()


def delete_feedback(feedback_id: int) -> bool:
    db: Session = next(get_db())
    try:
        record = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not record:
            return False
        db.delete(record)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"delete_feedback failed: {e}")
        raise
    finally:
        db.close()


def batch_delete_feedbacks(ids: List[int]) -> int:
    """批量删除，返回实际删除条数。空列表直接返回 0，避免误删全表。"""
    if not ids:
        return 0
    db: Session = next(get_db())
    try:
        deleted = (
            db.query(Feedback)
            .filter(Feedback.id.in_(ids))
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(deleted or 0)
    except Exception as e:
        db.rollback()
        logger.error(f"batch_delete_feedbacks failed: {e}")
        raise
    finally:
        db.close()
