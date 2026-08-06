import json
from datetime import datetime
from typing import Optional, List

from app.db.engine import get_db
from app.db.models.kb_conversations import KbConversation, KbMessage
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _conversation_to_dict(c: KbConversation) -> dict:
    return {
        "id": c.id,
        "title": c.title,
        "provider_id": c.provider_id,
        "model_name": c.model_name,
        "is_pinned": bool(getattr(c, "is_pinned", False)),
        "is_unread": bool(getattr(c, "is_unread", False)),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _message_to_dict(m: KbMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "reasoning_content": m.reasoning_content,
        "sources": json.loads(m.sources) if m.sources else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def create_conversation(user_id: int) -> dict:
    db = next(get_db())
    try:
        c = KbConversation(user_id=user_id)
        db.add(c)
        db.commit()
        db.refresh(c)
        return _conversation_to_dict(c)
    except Exception as e:
        db.rollback()
        logger.error(f"create_conversation failed: user_id={user_id}, {e}")
        raise
    finally:
        db.close()


def list_conversations(user_id: int) -> List[dict]:
    db = next(get_db())
    try:
        rows = (
            db.query(KbConversation)
            .filter_by(user_id=user_id)
            .order_by(KbConversation.is_pinned.desc(), KbConversation.updated_at.desc())
            .all()
        )
        return [_conversation_to_dict(c) for c in rows]
    except Exception as e:
        logger.error(f"list_conversations failed: user_id={user_id}, {e}")
        return []
    finally:
        db.close()


def get_conversation(conversation_id: int, user_id: int) -> Optional[dict]:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id, user_id=user_id).first()
        return _conversation_to_dict(c) if c else None
    except Exception as e:
        logger.error(f"get_conversation failed: conversation_id={conversation_id}, {e}")
        return None
    finally:
        db.close()


def delete_conversation(conversation_id: int, user_id: int) -> bool:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id, user_id=user_id).first()
        if not c:
            return False
        db.query(KbMessage).filter_by(conversation_id=conversation_id).delete()
        db.delete(c)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"delete_conversation failed: conversation_id={conversation_id}, {e}")
        return False
    finally:
        db.close()


def update_conversation_meta(
    conversation_id: int,
    *,
    title: Optional[str] = None,
    provider_id: Optional[str] = None,
    model_name: Optional[str] = None,
) -> None:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id).first()
        if not c:
            return
        if title is not None:
            c.title = title
        if provider_id is not None:
            c.provider_id = provider_id
        if model_name is not None:
            c.model_name = model_name
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"update_conversation_meta failed: conversation_id={conversation_id}, {e}")
    finally:
        db.close()


def patch_conversation(
    conversation_id: int,
    user_id: int,
    *,
    title: Optional[str] = None,
    is_pinned: Optional[bool] = None,
    is_unread: Optional[bool] = None,
) -> Optional[dict]:
    """按用户身份幂等地更新会话可编辑属性；返回最新会话 dict 或 None（未找到/无权访问）。"""
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id, user_id=user_id).first()
        if not c:
            return None
        if title is not None:
            c.title = title
        if is_pinned is not None:
            c.is_pinned = bool(is_pinned)
        if is_unread is not None:
            c.is_unread = bool(is_unread)
        db.commit()
        db.refresh(c)
        return _conversation_to_dict(c)
    except Exception as e:
        db.rollback()
        logger.error(f"patch_conversation failed: conversation_id={conversation_id}, {e}")
        return None
    finally:
        db.close()


def touch_conversation(conversation_id: int) -> None:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id).first()
        if c:
            c.updated_at = datetime.now()
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"touch_conversation failed: conversation_id={conversation_id}, {e}")
    finally:
        db.close()


def add_message(
    conversation_id: int,
    role: str,
    content: str,
    reasoning_content: Optional[str] = None,
    sources: Optional[list] = None,
) -> dict:
    db = next(get_db())
    try:
        m = KbMessage(
            conversation_id=conversation_id,
            role=role,
            content=content,
            reasoning_content=reasoning_content,
            sources=json.dumps(sources, ensure_ascii=False) if sources is not None else None,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return _message_to_dict(m)
    except Exception as e:
        db.rollback()
        logger.error(f"add_message failed: conversation_id={conversation_id}, {e}")
        raise
    finally:
        db.close()


def list_messages(conversation_id: int, limit: Optional[int] = None) -> List[dict]:
    db = next(get_db())
    try:
        q = db.query(KbMessage).filter_by(conversation_id=conversation_id)
        if limit is not None:
            rows = q.order_by(KbMessage.created_at.desc()).limit(limit).all()
            rows = list(reversed(rows))
        else:
            rows = q.order_by(KbMessage.created_at.asc()).all()
        return [_message_to_dict(m) for m in rows]
    except Exception as e:
        logger.error(f"list_messages failed: conversation_id={conversation_id}, {e}")
        return []
    finally:
        db.close()
