from sqlalchemy import JSON, BigInteger, Column, DateTime, Index, Integer, String, func

from app.db.engine import Base


class AnalyticsEvent(Base):
    """A single privacy-conscious product analytics event."""

    __tablename__ = "analytics_events"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    event_name = Column(String(64), nullable=False)
    page_path = Column(String(255), nullable=False, default="")
    target = Column(String(128), nullable=True)
    user_id = Column(Integer, nullable=True, index=True)
    visitor_key = Column(String(64), nullable=True)
    identity_key = Column(String(96), nullable=True)
    session_id = Column(String(64), nullable=True)
    properties = Column(JSON, nullable=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("ix_analytics_events_time_event", "occurred_at", "event_name"),
        Index("ix_analytics_events_time_identity", "occurred_at", "identity_key"),
        Index("ix_analytics_events_time_page", "occurred_at", "page_path"),
    )
