"""
系统通知表 (统一管理 cookie 失效 / 池耗尽 / 用户反馈三类条目).

设计要点:
- 所有通知走幂等 publish: 同 (category, source_type, source_id) 在窗口内
  多次触发只更新 last_seen_at, 不增加记录数 (极端抖动的 cookie 不会暴增行).
- 通知永久只读: 应用层不允许物理删除, 管理员通过 status 字段
  (pending / handled / closed / ignored) 表达「处理状态」.
- ``dedup_key`` 加 UNIQUE 索引, 防止并发 publish 出现重复行.
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Index,
    UniqueConstraint,
    func,
)

from app.db.engine import Base


# -------- 通知分类 (应用的语义类型) --------
NOTIFICATION_CATEGORY_COOKIE_FAILURE = "cookie_failure"
NOTIFICATION_CATEGORY_POOL_EXHAUSTED = "pool_exhausted"
NOTIFICATION_CATEGORIES = {
    NOTIFICATION_CATEGORY_COOKIE_FAILURE,
    NOTIFICATION_CATEGORY_POOL_EXHAUSTED,
}

# -------- 严重等级 --------
NOTIFICATION_SEVERITY_INFO = "info"
NOTIFICATION_SEVERITY_WARNING = "warning"
NOTIFICATION_SEVERITY_ERROR = "error"
NOTIFICATION_SEVERITIES = {
    NOTIFICATION_SEVERITY_INFO,
    NOTIFICATION_SEVERITY_WARNING,
    NOTIFICATION_SEVERITY_ERROR,
}

# -------- 处理状态 --------
NOTIFICATION_STATUS_PENDING = "pending"
NOTIFICATION_STATUS_HANDLED = "handled"
NOTIFICATION_STATUS_CLOSED = "closed"
NOTIFICATION_STATUS_IGNORED = "ignored"
NOTIFICATION_STATUSES = {
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_HANDLED,
    NOTIFICATION_STATUS_CLOSED,
    NOTIFICATION_STATUS_IGNORED,
}


class Notification(Base):
    """系统通知 (cookie 失效 / 池耗尽 / 用户反馈 / 未来扩展)."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键 ID, 自增")

    # -------- 业务字段 --------
    category = Column(
        String(64),
        nullable=False,
        comment="通知分类: cookie_failure / pool_exhausted (用户反馈已迁回 Feedback 表)",
    )
    severity = Column(
        String(16),
        nullable=False,
        default=NOTIFICATION_SEVERITY_WARNING,
        comment="严重等级: info / warning / error",
    )
    title = Column(String(255), nullable=False, comment="一句话标题, 列表显示")
    content = Column(Text, nullable=False, comment="详细描述, 详情面板展开")

    source_type = Column(
        String(64),
        nullable=True,
        comment="来源类型: platform_cookie / task (其它系统检测)",
    )
    source_id = Column(
        String(128),
        nullable=True,
        comment="来源记录 ID, 字符串形式保留扩展性 (例如 '12' 或 'task-abc')",
    )
    platform = Column(
        String(32),
        nullable=True,
        comment="关联平台 (cookie 失效类专用), 便于按平台过滤",
    )

    # -------- 状态字段 --------
    status = Column(
        String(16),
        nullable=False,
        default=NOTIFICATION_STATUS_PENDING,
        server_default=NOTIFICATION_STATUS_PENDING,
        index=True,
        comment="处理状态: pending / handled / closed / ignored",
    )

    # -------- 去重 (幂等 publish 的关键) --------
    dedup_key = Column(
        String(255),
        nullable=False,
        comment="去重 key = '{category}:{source_type}:{source_id}'",
    )

    # -------- 时间字段 --------
    first_seen_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        comment="首次发现时间, 永不变动",
    )
    last_seen_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        comment="最近一次发现时间, 每次 publish 命中都更新",
    )
    occurrence_count = Column(
        Integer,
        nullable=False,
        default=1,
        comment="窗口内累计触发次数, 用于面板展示'继续发生 N 次'",
    )

    # -------- 处理信息 --------
    handled_by = Column(
        Integer,
        nullable=True,
        comment="标记处理的管理员 user_id, pending 状态时为 NULL",
    )
    handled_at = Column(
        DateTime,
        nullable=True,
        comment="最近一次状态变更时间",
    )
    handler_note = Column(
        Text,
        nullable=True,
        comment="处理备注 / 跟进说明, 由管理员填写",
    )

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        comment="创建时间",
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间, 任一字段修改自动刷新",
    )

    __table_args__ = (
        # dedup_key 必须唯一, 给幂等 publish 上保险
        UniqueConstraint("dedup_key", name="uq_notifications_dedup_key"),
        # 列表页常用过滤: 状态 + 时间倒序
        Index("ix_notifications_status_last_seen", "status", "last_seen_at"),
        # 按类别过滤常见
        Index("ix_notifications_category", "category"),
    )
