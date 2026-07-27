from typing import Optional

from app.db.engine import get_db
from app.db.models.kb_index_status import KbIndexStatus
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_status(task_id: str) -> Optional[str]:
    db = next(get_db())
    try:
        row = db.query(KbIndexStatus).filter_by(task_id=task_id).first()
        return row.status if row else None
    finally:
        db.close()


def set_status(task_id: str, status: str) -> None:
    db = next(get_db())
    try:
        row = db.query(KbIndexStatus).filter_by(task_id=task_id).first()
        if row:
            row.status = status
        else:
            db.add(KbIndexStatus(task_id=task_id, status=status))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"set_status (kb_index_status) failed: task_id={task_id}, {e}")
    finally:
        db.close()


def get_statuses(task_ids: list[str]) -> dict:
    if not task_ids:
        return {}
    db = next(get_db())
    try:
        rows = db.query(KbIndexStatus).filter(KbIndexStatus.task_id.in_(task_ids)).all()
        return {r.task_id: r.status for r in rows}
    finally:
        db.close()
