from sqlalchemy import Column, Integer, BigInteger, DateTime, Enum, ForeignKey, UniqueConstraint, func

from app.db.engine import Base


REFERRAL_REWARD_TYPES = ("REGISTER", "FIRST_SUBSCRIPTION")
REFERRAL_REWARD_STATUSES = ("PAID",)


class ReferralReward(Base):
    """推荐奖励记录表 (注册触发 + 首订阅触发, 同 invitee 同类型唯一)"""
    __tablename__ = "referral_rewards"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键")
    inviter_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="邀请人 user_id")
    invitee_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="被邀请人 user_id")
    reward_type = Column(Enum(*REFERRAL_REWARD_TYPES, name="referral_reward_type"), nullable=False,
                          comment="奖励类型: REGISTER=注册触发, FIRST_SUBSCRIPTION=首订阅触发")
    inviter_credits = Column(Integer, nullable=False,
                              comment="本次发给邀请人的电力 (REGISTER=20, FIRST_SUBSCRIPTION=100)")
    invitee_credits = Column(Integer, nullable=False, default=0,
                              comment="本次发给被邀请人的电力 (REGISTER=200, FIRST_SUBSCRIPTION=0)")
    trigger_order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=True,
                               comment="reward_type=FIRST_SUBSCRIPTION 时关联的订阅订单 ID")
    status = Column(Enum(*REFERRAL_REWARD_STATUSES, name="referral_reward_status"),
                     nullable=False, default="PAID", comment="状态, MVP 始终 PAID")
    paid_at = Column(DateTime, server_default=func.now(), nullable=False, comment="到账时间")

    __table_args__ = (
        UniqueConstraint("invitee_user_id", "reward_type", name="uk_invitee_type"),
    )
