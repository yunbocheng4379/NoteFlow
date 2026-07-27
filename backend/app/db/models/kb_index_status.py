from sqlalchemy import Column, String, DateTime, func

from app.db.engine import Base


class KbIndexStatus(Base):
    """笔记向量索引状态（持久化），供 /chat/* 与 /kb/* 共用，替代原先进程内 dict"""
    __tablename__ = "kb_index_status"

    task_id = Column(String(64), primary_key=True, comment="对应 video_tasks.task_id")
    status = Column(String(16), nullable=False, comment="索引状态：indexing / indexed / failed")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近状态变更时间")
