"""
更新日志 DAO.

约束
----
- 任意时刻全局只能有一条 ``status='active'`` 行, 由 DB 层 ``uq_update_logs_active``
  生成列 UNIQUE 索引保证; 这里额外在应用层提供 "ensure only one active" 防御.
- 业务上不强制做物理删除, 但留了 ``delete_update_log`` 方便管理员在「pending 阶段
  写错了」时不发就直接删掉.  ``active`` / ``ended`` 行理论上仍允许删除, 删前 DAO
  返回受影响行数让路由层决定是否报错.
"""
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models.update_logs import (
    UpdateLog,
    UPDATE_LOG_STATUSES,
)


def _to_dict(row: UpdateLog) -> dict:
    def _fmt(v):
        return v.isoformat() if hasattr(v, "isoformat") and v else v

    return {
        "id": row.id,
        "title": row.title,
        "version": row.version,
        "summary": row.summary,
        "content": row.content,
        "status": row.status,
        "published_at": _fmt(row.published_at),
        "ended_at": _fmt(row.ended_at),
        "created_by": row.created_by,
        "published_by": row.published_by,
        "created_at": _fmt(row.created_at),
        "updated_at": _fmt(row.updated_at),
    }


# ============ 读 ============

def get_by_id(update_log_id: int) -> Optional[dict]:
    db: Session = next(get_db())
    try:
        row = db.query(UpdateLog).filter(UpdateLog.id == update_log_id).first()
        return _to_dict(row) if row else None
    finally:
        db.close()


def get_active() -> Optional[dict]:
    """当前全局唯一一条 ``status=active`` 的更新日志, 用于顶部横幅 + 用户页."""
    db: Session = next(get_db())
    try:
        row = (
            db.query(UpdateLog)
            .filter(UpdateLog.status == "active")
            .order_by(UpdateLog.published_at.desc(), UpdateLog.id.desc())
            .first()
        )
        return _to_dict(row) if row else None
    finally:
        db.close()


def list_for_admin(
    *,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[dict], int]:
    """管理员用: 列出全部状态, 包含 pending / active / ended, 倒序."""
    if status and status not in UPDATE_LOG_STATUSES:
        raise ValueError(f"非法 status: {status}")
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20

    db: Session = next(get_db())
    try:
        q = db.query(UpdateLog)
        if status:
            q = q.filter(UpdateLog.status == status)
        if keyword:
            like = f"%{keyword.strip()}%"
            q = q.filter(
                (UpdateLog.title.like(like))
                | (UpdateLog.summary.like(like))
                | (UpdateLog.content.like(like))
            )

        total = q.count()
        rows = (
            q.order_by(UpdateLog.created_at.desc(), UpdateLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [_to_dict(r) for r in rows], total
    finally:
        db.close()


def list_for_user(
    *,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[dict], int]:
    """用户用: 只返回 ``active`` + ``ended`` 行, 按 published_at desc; 不展示 pending."""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20

    db: Session = next(get_db())
    try:
        q = db.query(UpdateLog).filter(UpdateLog.status.in_(("active", "ended")))
        total = q.count()
        rows = (
            q.order_by(
                # active 永远在前面 (排序键 0 < 1), 内部再按发布时间倒序
                case({"active": 0, "ended": 1}, value=UpdateLog.status).asc(),
                UpdateLog.published_at.desc(),
                UpdateLog.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return [_to_dict(r) for r in rows], total
    finally:
        db.close()


# ============ 写 ============

def create_update_log(
    *,
    title: str,
    summary: str,
    content: str,
    version: Optional[str] = None,
    created_by: Optional[int] = None,
) -> dict:
    """新增一行, 默认状态 pending."""
    if not title.strip():
        raise ValueError("title 不能为空")
    if not summary.strip():
        raise ValueError("summary 不能为空")
    if not content.strip():
        raise ValueError("content 不能为空")

    db: Session = next(get_db())
    try:
        row = UpdateLog(
            title=title.strip(),
            version=(version or "").strip() or None,
            summary=summary.strip(),
            content=content,
            status="pending",
            created_by=created_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def update_update_log(
    *,
    update_log_id: int,
    title: Optional[str] = None,
    version: Optional[str] = None,
    summary: Optional[str] = None,
    content: Optional[str] = None,
) -> Optional[dict]:
    """更新任意字段, 但不修改 status / 时间戳; status 用专门的 publish / end 流转."""
    db: Session = next(get_db())
    try:
        row = db.query(UpdateLog).filter(UpdateLog.id == update_log_id).first()
        if not row:
            return None
        if title is not None:
            if not title.strip():
                raise ValueError("title 不能为空")
            row.title = title.strip()
        if summary is not None:
            if not summary.strip():
                raise ValueError("summary 不能为空")
            row.summary = summary.strip()
        if content is not None:
            if not content.strip():
                raise ValueError("content 不能为空")
            row.content = content
        if version is not None:
            row.version = (version or "").strip() or None
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def publish(update_log_id: int, *, published_by: int) -> Optional[dict]:
    """把 ``pending`` (或 ``ended``) 转成 ``active``, 设置 published_* 时间戳.

    同一时刻全局只能一条 active. 失败 → 抛 IntegrityError 让路由层翻译.
    """
    db: Session = next(get_db())
    try:
        row = db.query(UpdateLog).filter(UpdateLog.id == update_log_id).first()
        if not row:
            return None
        now = datetime.now()
        row.status = "active"
        row.published_at = now
        row.ended_at = None
        row.published_by = published_by
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except IntegrityError:
        # uq_update_logs_active 触发, 说明已经有别的 active 行
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def end(update_log_id: int) -> Optional[dict]:
    """把 ``active`` 转成 ``ended``, 设置 ended_at."""
    db: Session = next(get_db())
    try:
        row = db.query(UpdateLog).filter(UpdateLog.id == update_log_id).first()
        if not row:
            return None
        row.status = "ended"
        row.ended_at = datetime.now()
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def delete_update_log(update_log_id: int) -> bool:
    db: Session = next(get_db())
    try:
        row = db.query(UpdateLog).filter(UpdateLog.id == update_log_id).first()
        if not row:
            return False
        db.delete(row)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
