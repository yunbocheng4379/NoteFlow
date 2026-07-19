"""
平台级 Cookie 池存储表.

每个平台 (bilibili / youtube / douyin / kuaishou) 可以配置多条 Cookie
(由管理员在后台批量导入), 下层 yt-dlp 下载器调用
``CookiePoolManager.pick(platform)`` 加权随机抽取; 加密后的 cookie 字符串
入库, 解密仅发生在返回给管理员 UI 或读给 downloader 使用时.

分组与配额:
- ``cohort`` 逻辑分组 (例: 'default' / 'vip' / 'test'), 方便批量管理
- ``reserved_for_tier`` JSON 列表, 空表示对所有 tier 开放, 非空则限定
  仅这些 tier 的用户能用 (tier 来自 user.role 或 user.is_vip)
- ``max_concurrent_uses`` 并发配额, 0 表示无限制; >0 时 pick 会跳过
  当前正在使用数 ≥ 该值的 cookie
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, func, text as sql_text

from app.db.engine import Base


class PlatformCookie(Base):
    """平台级 cookie 池. 多条按 weight 加权随机抽取."""
    __tablename__ = "platform_cookies"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键 ID, 自增")
    platform = Column(
        String(32),
        nullable=False,
        comment="平台标识, 取值: bilibili / youtube / douyin / kuaishou",
    )
    name = Column(
        String(64),
        nullable=False,
        comment="管理后台可见的内部别名, 例如 'B站-主账号'",
    )
    cookie_value_encrypted = Column(
        Text,
        nullable=False,
        comment="Fernet 加密后的 cookie 字符串 (Netscape 格式); 前端永远不接触密文",
    )
    remark = Column(
        Text,
        nullable=True,
        comment="管理员备注, 例如 '2026-03 导入, 高画质视频可用'",
    )

    # === 分组 / 配额 ===
    cohort = Column(
        String(64),
        nullable=False,
        default="default",
        server_default=sql_text("'default'"),
        comment="逻辑分组, 方便批量管理 (例: 'default' / 'vip' / 'test'). 字符串.",
    )
    reserved_for_tier = Column(
        Text,
        nullable=True,
        comment=(
            "JSON 列表, 限定哪些 user tier 可用. 空/None=全部 tier. "
            "例: '[\"vip\", \"admin\"]' 仅 VIP/管理员能用."
        ),
    )
    max_concurrent_uses = Column(
        Integer,
        nullable=False,
        default=0,
        server_default=sql_text("0"),
        comment="最大并发使用数; 0=无限制, >0 时同时正在使用的任务数 >= 该值则跳过.",
    )
    in_use_count = Column(
        Integer,
        nullable=False,
        default=0,
        server_default=sql_text("0"),
        comment="当前正在使用此 cookie 的任务计数 (pick 时 +1, 报告成功/失败时 -1).",
    )

    is_enabled = Column(
        Integer,
        nullable=False,
        default=1,
        comment="是否启用. 0=禁用, 1=启用. 禁用后 pick 跳过",
    )
    is_marked_invalid = Column(
        Integer,
        nullable=False,
        default=0,
        comment="自动失效标记. 1=自动判定失效, pick 跳过. 仅管理员可手动 reset",
    )
    weight = Column(
        Integer,
        nullable=False,
        default=100,
        comment="加权随机抽取权重, 范围 1~1000",
    )

    failure_count = Column(
        Integer,
        nullable=False,
        default=0,
        comment="连续失败计数. 归零条件: 一次成功 / 管理员重置",
    )
    success_count = Column(
        Integer,
        nullable=False,
        default=0,
        comment="总成功次数, 仅累加不回退",
    )
    usage_count = Column(
        Integer,
        nullable=False,
        default=0,
        comment="总使用次数 (成功+失败), 用于排查热度",
    )

    last_used_at = Column(
        DateTime,
        nullable=True,
        comment="最近一次被 pick 并尝试使用的时间",
    )
    last_failure_at = Column(
        DateTime,
        nullable=True,
        comment="最近一次失败的时间",
    )

    configured_by = Column(
        Integer,
        nullable=True,
        comment="录入者的 admin user_id, 可为空表示系统导入",
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
        # 列表页常用过滤: 平台 + 启用状态
        Index(
            "ix_platform_cookies_platform_status",
            "platform",
            "is_enabled",
            "is_marked_invalid",
        ),
        # cohort 分组查询 (管理员按分组过滤) + 上述过滤 — 复合索引
        Index(
            "ix_platform_cookies_platform_status_cohort",
            "platform",
            "is_enabled",
            "is_marked_invalid",
            "cohort",
        ),
        # 单 cohort 过滤场景: 列表页只按 cohort 过滤, 不限定其他
        Index("ix_platform_cookies_cohort", "cohort"),
    )
