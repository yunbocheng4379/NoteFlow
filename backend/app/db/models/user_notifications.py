from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func

from app.db.engine import Base


class UserNotification(Base):
    """面向登录用户的站内通知。"""

    __tablename__ = "user_notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(64), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    source_type = Column(String(64), nullable=True)
    source_id = Column(String(128), nullable=True)
    link = Column(String(255), nullable=True)
    severity = Column(String(16), nullable=False, default="info", server_default="info")
    is_read = Column(Boolean, nullable=False, default=False, server_default="0", index=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)

    __table_args__ = (
        UniqueConstraint("user_id", "category", "source_type", "source_id", name="uq_user_notification_source"),
        Index("ix_user_notifications_user_read_created", "user_id", "is_read", "created_at"),
    )
