from sqlalchemy import Column, Integer, BigInteger, DateTime, Enum, ForeignKey, func

from app.db.engine import Base


SUBSCRIPTION_STATUSES = ("ACTIVE", "EXPIRED", "CANCELLED")


class Subscription(Base):
    """用户订阅记录表"""
    __tablename__ = "subscriptions"

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="主键")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, comment="订阅用户 ID")
    plan_id = Column(Integer, ForeignKey("subscription_plans.id"), nullable=False, comment="订阅方案 ID")
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False, comment="激活该订阅的订单 ID")
    start_at = Column(DateTime, nullable=False, comment="订阅开始时间")
    end_at = Column(DateTime, nullable=False, comment="订阅结束时间 (start_at + plan.duration_days)")
    status = Column(Enum(*SUBSCRIPTION_STATUSES, name="subscription_status"),
                     nullable=False, default="ACTIVE", comment="订阅状态")
    last_grant_at = Column(DateTime, nullable=True, comment="最近一次月度发放时间")
    next_grant_at = Column(DateTime, nullable=True, comment="下次预定发放时间")
    grant_count = Column(Integer, nullable=False, default=0,
                          comment="已发放次数, 不超过 ceil(duration_days/30)")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
