from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index, func

from app.db.engine import Base


# 反馈状态枚举（用字符串而非数字，便于排查日志与未来扩展）
FEEDBACK_STATUS_PENDING = "pending"       # 未处理
FEEDBACK_STATUS_PROCESSING = "processing" # 处理中
FEEDBACK_STATUS_DONE = "done"             # 已完成
FEEDBACK_STATUS_STALLED = "stalled"       # 已停滞

FEEDBACK_STATUSES = {
    FEEDBACK_STATUS_PENDING,
    FEEDBACK_STATUS_PROCESSING,
    FEEDBACK_STATUS_DONE,
    FEEDBACK_STATUS_STALLED,
}

FEEDBACK_CATEGORIES = {"bug", "feature", "ui", "perf", "other"}


class Feedback(Base):
    """用户问题反馈记录表"""
    __tablename__ = "feedbacks"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="反馈 ID")
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="提交者用户 ID；账号被删时置 NULL 以保留反馈历史",
    )
    category = Column(String(32), nullable=False, comment="反馈分类：bug/feature/ui/perf/other")
    title = Column(String(200), nullable=True, comment="一句话标题，可选")
    content = Column(Text, nullable=False, comment="详细描述")
    contact = Column(String(128), nullable=True, comment="联系方式（邮箱/微信），可选")

    status = Column(
        String(16),
        nullable=False,
        default=FEEDBACK_STATUS_PENDING,
        server_default=FEEDBACK_STATUS_PENDING,
        index=True,
        comment="处理状态：pending=未处理 processing=处理中 done=已完成 stalled=已停滞",
    )
    admin_note = Column(Text, nullable=True, comment="处理人备注 / 内部跟进说明")
    handled_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="最近一次更新状态的处理人 user_id",
    )
    handled_at = Column(DateTime, nullable=True, comment="最近一次状态变更时间")

    created_at = Column(DateTime, server_default=func.now(), comment="提交时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最后更新时间")

    # 列表页常用过滤：按状态 + 时间倒序；多列联合索引能直接命中
    __table_args__ = (
        Index("ix_feedbacks_status_created_at", "status", "created_at"),
    )
