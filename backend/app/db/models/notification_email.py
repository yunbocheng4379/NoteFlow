"""Persistent audit records for administrator system-notification emails."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func

from app.db.engine import Base


EMAIL_BATCH_TYPES = {"instant", "daily"}
EMAIL_BATCH_STATUSES = {"pending", "sent", "partial", "failed", "skipped"}
EMAIL_DELIVERY_STATUSES = {"pending", "sent", "failed"}


class NotificationEmailBatch(Base):
    __tablename__ = "notification_email_batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_key = Column(String(255), nullable=False, unique=True, index=True)
    batch_type = Column(String(16), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    sent_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_notification_email_batches_type_created", "batch_type", "created_at"),
    )


class NotificationEmailBatchItem(Base):
    __tablename__ = "notification_email_batch_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("notification_email_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    notification_id = Column(
        Integer,
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    severity = Column(String(16), nullable=False)
    platform = Column(String(32), nullable=True)

    __table_args__ = (
        UniqueConstraint("batch_id", "notification_id", name="uq_notification_email_batch_item"),
        Index("ix_notification_email_batch_items_notification", "notification_id"),
    )


class NotificationEmailDelivery(Base):
    __tablename__ = "notification_email_deliveries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("notification_email_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    recipient_email = Column(String(128), nullable=False)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("batch_id", "recipient_user_id", name="uq_notification_email_delivery_recipient"),
        Index("ix_notification_email_deliveries_status", "status"),
    )
