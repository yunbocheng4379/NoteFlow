from sqlalchemy import Column, Integer, String, Text, DateTime, func

from app.db.engine import Base


class SubscriptionPlan(Base):
    """会员订阅方案表 (按订阅时长分档)"""
    __tablename__ = "subscription_plans"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键")
    code = Column(String(32), unique=True, nullable=False, comment="方案编码, 如 SUB_MONTHLY")
    name = Column(String(64), nullable=False, comment="展示名称, 如 月度会员")
    duration_days = Column(Integer, nullable=False, comment="订阅时长 (天), 30/90/365")
    monthly_credits = Column(Integer, nullable=False, comment="每月发放电力数")
    first_price_cents = Column(Integer, nullable=False, comment="首单价 (分), 用户首次订阅此 plan 适用")
    renewal_price_cents = Column(Integer, nullable=False, comment="续费价 (分), 用户再次订阅此 plan 适用")
    original_price_cents = Column(Integer, nullable=True, comment="展示用原价 (分), 用于划线显示")
    sort_order = Column(Integer, nullable=False, default=0, comment="展示排序")
    badge = Column(String(32), nullable=True, comment="徽章文案, 如 推荐 · 立省 17%")
    is_active = Column(Integer, nullable=False, default=1, comment="是否上架: 1/0")
    description = Column(Text, nullable=True, comment="权益描述, 支持 markdown 或 JSON 列表")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
