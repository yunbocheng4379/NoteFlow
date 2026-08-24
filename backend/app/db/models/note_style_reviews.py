from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func

from app.db.engine import Base


class NoteStyleReview(Base):
    """笔记风格审核流水，保留管理员动作和 AI 初筛结果。"""

    __tablename__ = "note_style_reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    style_id = Column(Integer, ForeignKey("note_styles.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("note_style_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(32), nullable=False, comment="submit/approve/reject/unpublish/republish/resubmit")
    from_status = Column(String(24), nullable=True)
    to_status = Column(String(24), nullable=False)
    reviewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason = Column(Text, nullable=True)
    ai_status = Column(String(24), nullable=True)
    ai_risk_level = Column(String(16), nullable=True)
    ai_categories = Column(String(500), nullable=True)
    ai_summary = Column(String(1000), nullable=True)
    ai_recommendations = Column(String(2000), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_note_style_reviews_style_created", "style_id", "created_at"),)
