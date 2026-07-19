"""
视频解析平台配置表.

每个平台 (bilibili / youtube / douyin / kuaishou) 可以独立配置：
- 是否启用（有些平台不想对外暴露时可以关闭）
- 专属代理地址（覆盖全局代理；留空则走全局代理）
- 显示顺序（管理后台的排列）
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, func

from app.db.engine import Base


class Platform(Base):
    """平台配置表，可动态增删，后端下载器按 platform 取对应配置."""
    __tablename__ = "platforms"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键 ID")

    # 平台唯一标识，如 'youtube', 'bilibili' — 必须唯一
    platform_id = Column(
        String(32),
        nullable=False,
        unique=True,
        comment="平台唯一标识, 对应 downloader 的 platform 参数",
    )

    # 显示名称
    name = Column(
        String(64),
        nullable=False,
        comment="前端展示名称，如 'YouTube', '哔哩哔哩'",
    )

    # 可选图标 URL（存储在 static/ 或外部 CDN）
    icon_url = Column(
        String(256),
        nullable=True,
        comment="平台图标 URL",
    )

    # 代理配置：留空走全局代理
    proxy_url = Column(
        Text,
        nullable=True,
        comment="该平台专属代理地址；空/None 则使用全局代理",
    )

    # 是否启用该平台
    is_enabled = Column(
        Integer,
        nullable=False,
        default=1,
        comment="是否启用. 0=禁用, 1=启用",
    )

    # 排序权重
    sort_order = Column(
        Integer,
        nullable=False,
        default=0,
        comment="管理后台列表排序，数字越小越靠前",
    )

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    __table_args__ = (
        Index("ix_platforms_platform_id", "platform_id"),
        Index("ix_platforms_sort_order", "sort_order"),
    )
