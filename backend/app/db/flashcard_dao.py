from typing import List, Optional

from app.db.engine import get_db
from app.db.models.flashcards import FlashcardSet, Flashcard
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_set(
    user_id: int,
    task_id: str,
    title: Optional[str],
    custom_prompt: Optional[str],
    card_count: int,
    provider_id: Optional[str],
    model_name: Optional[str],
    cards: List[dict],
) -> FlashcardSet:
    """创建卡组并批量写入卡片，cards 形如 [{"question": str, "answer": str}, ...]"""
    db = next(get_db())
    try:
        flashcard_set = FlashcardSet(
            user_id=user_id,
            task_id=task_id,
            title=title,
            custom_prompt=custom_prompt,
            card_count=len(cards),
            provider_id=provider_id,
            model_name=model_name,
        )
        db.add(flashcard_set)
        db.flush()

        for idx, card in enumerate(cards):
            db.add(Flashcard(
                set_id=flashcard_set.id,
                question=card["question"],
                answer=card["answer"],
                order_index=idx,
            ))

        db.commit()
        db.refresh(flashcard_set)
        return flashcard_set
    except Exception as e:
        db.rollback()
        logger.error(f"create_set (flashcard) failed: {e}")
        raise
    finally:
        db.close()


def list_sets_by_task(task_id: str, user_id: int) -> List[FlashcardSet]:
    db = next(get_db())
    try:
        return (
            db.query(FlashcardSet)
            .filter_by(task_id=task_id, user_id=user_id)
            .order_by(FlashcardSet.created_at.desc())
            .all()
        )
    finally:
        db.close()


def get_set(set_id: int, user_id: int) -> Optional[FlashcardSet]:
    db = next(get_db())
    try:
        return db.query(FlashcardSet).filter_by(id=set_id, user_id=user_id).first()
    finally:
        db.close()


def get_cards(set_id: int) -> List[Flashcard]:
    db = next(get_db())
    try:
        return (
            db.query(Flashcard)
            .filter_by(set_id=set_id)
            .order_by(Flashcard.order_index.asc())
            .all()
        )
    finally:
        db.close()


def delete_set(set_id: int, user_id: int) -> bool:
    db = next(get_db())
    try:
        record = db.query(FlashcardSet).filter_by(id=set_id, user_id=user_id).first()
        if not record:
            return False
        db.query(Flashcard).filter_by(set_id=set_id).delete()
        db.delete(record)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"delete_set (flashcard) failed: {e}")
        raise
    finally:
        db.close()
