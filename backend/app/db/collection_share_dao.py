import uuid
from typing import Optional

from app.db.engine import get_db
from app.db.models.collection_share import CollectionShare
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _token() -> str:
    return uuid.uuid4().hex  # 32-char hex, URL-safe


def get_by_collection_id(collection_id: int) -> Optional[CollectionShare]:
    db = next(get_db())
    try:
        return db.query(CollectionShare).filter_by(collection_id=collection_id).first()
    finally:
        db.close()


def get_by_token(token: str) -> Optional[CollectionShare]:
    db = next(get_db())
    try:
        return db.query(CollectionShare).filter_by(share_token=token).first()
    finally:
        db.close()


def enable_share(collection_id: int, user_id: int) -> CollectionShare:
    """开启分享：已有记录则激活并返回，否则新建。"""
    db = next(get_db())
    try:
        record = db.query(CollectionShare).filter_by(collection_id=collection_id).first()
        if record:
            record.is_active = True
            db.commit()
            db.refresh(record)
        else:
            record = CollectionShare(
                collection_id=collection_id, user_id=user_id, share_token=_token(),
                is_active=True, view_count=0,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
        return record
    except Exception as e:
        db.rollback()
        logger.error(f"enable_share (collection) failed: {e}")
        raise
    finally:
        db.close()


def disable_share(collection_id: int) -> Optional[CollectionShare]:
    db = next(get_db())
    try:
        record = db.query(CollectionShare).filter_by(collection_id=collection_id).first()
        if record:
            record.is_active = False
            db.commit()
            db.refresh(record)
        return record
    except Exception as e:
        db.rollback()
        logger.error(f"disable_share (collection) failed: {e}")
        raise
    finally:
        db.close()


def increment_view(token: str) -> None:
    db = next(get_db())
    try:
        record = db.query(CollectionShare).filter_by(share_token=token).first()
        if record and record.is_active:
            record.view_count = (record.view_count or 0) + 1
            db.commit()
    except Exception as e:
        logger.error(f"increment_view (collection) failed: {e}")
    finally:
        db.close()
