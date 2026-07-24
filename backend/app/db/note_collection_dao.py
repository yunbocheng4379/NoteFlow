from typing import Optional, List

from sqlalchemy import func, or_

from app.db.engine import get_db
from app.db.models.note_collections import NoteCollection, NoteCollectionItem
from app.db.models.video_tasks import VideoTask
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _to_dict(c: NoteCollection, note_count: int = 0) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "cover_url": c.cover_url,
        "note_count": note_count,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def list_collections(user_id: int, keyword: Optional[str] = None) -> List[dict]:
    db = next(get_db())
    try:
        q = db.query(NoteCollection).filter(NoteCollection.user_id == user_id)
        if keyword:
            kw = f"%{keyword}%"
            q = q.filter(or_(NoteCollection.name.like(kw), NoteCollection.description.like(kw)))
        collections = q.order_by(NoteCollection.updated_at.desc()).all()

        counts = dict(
            db.query(NoteCollectionItem.collection_id, func.count(NoteCollectionItem.id))
            .join(VideoTask, VideoTask.task_id == NoteCollectionItem.task_id)
            .filter(NoteCollectionItem.collection_id.in_([c.id for c in collections]))
            .group_by(NoteCollectionItem.collection_id)
            .all()
        ) if collections else {}

        return [_to_dict(c, counts.get(c.id, 0)) for c in collections]
    finally:
        db.close()


def _count_valid_items(db, collection_id: int) -> int:
    """统计合集中仍存在对应笔记的关联记录数，避免笔记被删除后计数悬空。"""
    return (
        db.query(NoteCollectionItem)
        .join(VideoTask, VideoTask.task_id == NoteCollectionItem.task_id)
        .filter(NoteCollectionItem.collection_id == collection_id)
        .count()
    )


def get_collection(collection_id: int, user_id: int) -> Optional[dict]:
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return None
        note_count = _count_valid_items(db, collection_id)
        return _to_dict(c, note_count)
    finally:
        db.close()


def create_collection(user_id: int, name: str, description: Optional[str] = None) -> dict:
    db = next(get_db())
    try:
        c = NoteCollection(user_id=user_id, name=name, description=description)
        db.add(c)
        db.commit()
        db.refresh(c)
        return _to_dict(c, 0)
    finally:
        db.close()


def update_collection(collection_id: int, user_id: int, **kwargs) -> Optional[dict]:
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return None
        for k, v in kwargs.items():
            if hasattr(c, k) and v is not None:
                setattr(c, k, v)
        db.commit()
        db.refresh(c)
        note_count = _count_valid_items(db, collection_id)
        return _to_dict(c, note_count)
    finally:
        db.close()


def delete_collection(collection_id: int, user_id: int) -> bool:
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return False
        db.query(NoteCollectionItem).filter_by(collection_id=collection_id).delete()
        db.delete(c)
        db.commit()
        return True
    finally:
        db.close()


def _touch_collection(db, collection_id: int) -> None:
    from datetime import datetime
    c = db.query(NoteCollection).filter_by(id=collection_id).first()
    if c:
        c.updated_at = datetime.now()


def add_items(collection_id: int, user_id: int, task_ids: List[str]) -> Optional[dict]:
    """把若干笔记加入合集；task_id 须归属当前用户；已在合集中的 task_id 会被忽略。"""
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return None

        owned_task_ids = {
            row.task_id for row in
            db.query(VideoTask.task_id).filter(
                VideoTask.user_id == user_id, VideoTask.task_id.in_(task_ids)
            ).all()
        }
        existing_task_ids = {
            row.task_id for row in
            db.query(NoteCollectionItem.task_id).filter_by(collection_id=collection_id).all()
        }

        added = 0
        for task_id in task_ids:
            if task_id in owned_task_ids and task_id not in existing_task_ids:
                db.add(NoteCollectionItem(collection_id=collection_id, task_id=task_id))
                added += 1

        if added:
            _touch_collection(db, collection_id)
        db.commit()
        note_count = _count_valid_items(db, collection_id)
        return {"added": added, "note_count": note_count}
    finally:
        db.close()


def remove_items(collection_id: int, user_id: int, task_ids: List[str]) -> Optional[dict]:
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return None

        removed = (
            db.query(NoteCollectionItem)
            .filter(NoteCollectionItem.collection_id == collection_id, NoteCollectionItem.task_id.in_(task_ids))
            .delete(synchronize_session=False)
        )
        if removed:
            _touch_collection(db, collection_id)
        db.commit()
        note_count = _count_valid_items(db, collection_id)
        return {"removed": removed, "note_count": note_count}
    finally:
        db.close()


def remove_task_from_all_collections(task_id: str) -> None:
    """笔记被删除时清理其在所有合集中的关联记录，避免合集笔记数悬空不更新。"""
    db = next(get_db())
    try:
        affected = {
            row.collection_id for row in
            db.query(NoteCollectionItem.collection_id).filter_by(task_id=task_id).all()
        }
        if not affected:
            return
        db.query(NoteCollectionItem).filter_by(task_id=task_id).delete(synchronize_session=False)
        for collection_id in affected:
            _touch_collection(db, collection_id)
        db.commit()
    finally:
        db.close()


def get_item_task_ids(collection_id: int, user_id: int) -> Optional[List[str]]:
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            return None
        rows = db.query(NoteCollectionItem.task_id).filter_by(collection_id=collection_id).all()
        return [r.task_id for r in rows]
    finally:
        db.close()


def add_task_to_collection_on_generate(collection_id: int, user_id: int, task_id: str) -> None:
    """生成笔记成功后，若用户选择了目标合集，把该笔记写入关联表；合集不存在/无权限时静默跳过。"""
    db = next(get_db())
    try:
        c = db.query(NoteCollection).filter_by(id=collection_id, user_id=user_id).first()
        if not c:
            logger.warning(f"generate_note 归集失败：合集不存在或无权限 (collection_id={collection_id}, user_id={user_id})")
            return
        exists = db.query(NoteCollectionItem).filter_by(collection_id=collection_id, task_id=task_id).first()
        if not exists:
            db.add(NoteCollectionItem(collection_id=collection_id, task_id=task_id))
            _touch_collection(db, collection_id)
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"generate_note 归集异常 (collection_id={collection_id}, task_id={task_id}): {e}")
    finally:
        db.close()
