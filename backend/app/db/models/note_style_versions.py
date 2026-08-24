from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func

from app.db.engine import Base


NOTE_STYLE_VERSION_STATUSES = {
    "DRAFT",
    "PENDING_REVIEW",
    "REJECTED",
    "PUBLISHED",
    "UNPUBLISHED",
}


class NoteStyleVersion(Base):
    """笔记风格不可变提交快照。公开内容始终从已审核版本读取。"""

    __tablename__ = "note_style_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    style_id = Column(Integer, ForeignKey("note_styles.id", ondelete="CASCADE"), nullable=False, index=True)
    version_no = Column(Integer, nullable=False)
    name = Column(String(50), nullable=False)
    value = Column(String(128), nullable=False, index=True)
    description = Column(String(200), nullable=True)
    prompt = Column(Text, nullable=False)
    icon = Column(String(32), nullable=True)
    status = Column(String(24), nullable=False, default="DRAFT", server_default="DRAFT", index=True)
    ai_status = Column(String(24), nullable=True, comment="passed/risk/failed/not_configured")
    ai_risk_level = Column(String(16), nullable=True, comment="none/low/medium/high/unknown")
    ai_categories = Column(String(500), nullable=True, comment="JSON 风险类别列表")
    ai_summary = Column(String(1000), nullable=True)
    ai_recommendations = Column(String(2000), nullable=True, comment="JSON AI 修改建议列表")
    ai_provider = Column(String(64), nullable=True)
    ai_checked_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("style_id", "version_no", name="uq_note_style_version_no"),
        Index("ix_note_style_versions_status_created", "status", "created_at"),
    )
