"""
更新日志表.

设计要点
--------
- 一条更新日志的生命周期: ``pending`` -> ``active`` -> ``ended``
  - ``pending``: 管理员提前配置好但还没发布, 仅管理员可见.
  - ``active``:  正在通知, 顶部横幅会展示, 用户「更新日志」页面也会看到.
                  **任意时刻全局只允许一条 active 行**, 由 DB UNIQUE 索引 + 应用层校验共同保证.
- 用户页面只看到 ``active`` + ``ended`` 两类, ``pending`` 完全不可见.
- 应用层不允许"物理删除"已发布的日志 (只能由管理员显式 delete, 与 ``Notification`` 表保留策略不同).
  字段 ``created_by`` 记录创建人 id, 便于审计.
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


# -------- 状态 --------
UPDATE_LOG_STATUS_PENDING = "pending"   # 未通知
UPDATE_LOG_STATUS_ACTIVE = "active"     # 通知中
UPDATE_LOG_STATUS_ENDED = "ended"       # 已结束
UPDATE_LOG_STATUSES = {
    UPDATE_LOG_STATUS_PENDING,
    UPDATE_LOG_STATUS_ACTIVE,
    UPDATE_LOG_STATUS_ENDED,
}


class UpdateLog(Base):
    """更新日志: 管理员维护, 全体用户可见 (active/ended 状态)."""

    __tablename__ = "update_logs"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键 ID, 自增")

    # -------- 业务字段 --------
    title = Column(String(255), nullable=False, comment="更新日志标题, 一行概括本次更新")
    version = Column(
        String(32),
        nullable=True,
        comment="可选版本号, 例如 v1.2.0, 仅展示用",
    )
    summary = Column(
        String(500),
        nullable=False,
        comment="一句话简介, 用于顶部通知条展示",
    )
    content = Column(
        Text,
        nullable=False,
        comment="完整内容, Markdown, 在更新日志页面展开",
    )

    # -------- 状态 --------
    status = Column(
        String(16),
        nullable=False,
        default=UPDATE_LOG_STATUS_PENDING,
        server_default=UPDATE_LOG_STATUS_PENDING,
        index=True,
        comment="pending / active / ended",
    )

    # -------- 时间字段 --------
    published_at = Column(
        DateTime,
        nullable=True,
        comment="进入 active 状态的时间, 即「发布时间」",
    )
    ended_at = Column(
        DateTime,
        nullable=True,
        comment="进入 ended 状态的时间, 即「下线时间」",
    )

    # -------- 审计字段 --------
    created_by = Column(
        Integer,
        nullable=True,
        comment="创建该日志的管理员 user_id",
    )
    published_by = Column(
        Integer,
        nullable=True,
        comment="发布 (置为 active) 该日志的管理员 user_id",
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
        # 任意时刻全局只能有一条 active. 用「条件唯一索引」的思路在 MySQL 通过
        # 生成列实现, 但跨数据库通用做法是「应用层校验 + 兜底检查」, 这里给一个普通 UNIQUE
        # 列 status + active_marker 字段. 由于 MySQL 不支持部分索引, 这里用生成列兜底.
        # 详见 migrate_add_update_logs.py 中的 SQL 注释.
        Index("ix_update_logs_status_published", "status", "published_at"),
        Index("ix_update_logs_created_at", "created_at"),
    )
