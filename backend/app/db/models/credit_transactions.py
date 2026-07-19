from sqlalchemy import Column, Integer, BigInteger, String, DateTime, Enum, ForeignKey, func

from app.db.engine import Base


CREDIT_TX_TYPES = (
    "RECHARGE",            # 充值到账
    "CONSUME",             # 生成笔记消耗
    "REFUND",              # 笔记失败退费
    "MONTHLY_GRANT",       # 会员月度发放
    "REGISTER_GRANT",      # 新用户注册赠送 100
    "REGISTER_INVITEE",    # 被邀请人注册奖励 200
    "REGISTER_INVITER",    # 邀请人注册奖励 20
    "FIRST_SUB_INVITER",   # 邀请人在被邀请人首订阅时奖励 100
    "ADMIN_ADJUST",        # 管理员手动调整
)


class CreditTransaction(Base):
    """电力流水/账本 (永久保留, 仅 INSERT, refunded_at 例外)"""
    __tablename__ = "credit_transactions"

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="流水主键")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                      comment="用户 ID, 即被记账的用户")
    type = Column(Enum(*CREDIT_TX_TYPES, name="credit_tx_type"), nullable=False, comment="流水类型")
    amount = Column(Integer, nullable=False, comment="变动量, 正=加电, 负=扣电")
    balance_after = Column(Integer, nullable=False, comment="本次操作后 users.credits 余额 (审计快照)")
    related_task_id = Column(String(64), nullable=True, comment="关联 video_tasks.task_id (CONSUME/REFUND 必填)")
    related_order_id = Column(BigInteger, nullable=True,
                               comment="关联 orders.id (RECHARGE/MONTHLY_GRANT/FIRST_SUB_INVITER)")
    related_subscription_id = Column(BigInteger, nullable=True,
                                      comment="关联 subscriptions.id (MONTHLY_GRANT)")
    related_referral_id = Column(BigInteger, nullable=True,
                                  comment="关联 referral_rewards.id (REGISTER_INVITEE/INVITER, FIRST_SUB_INVITER)")
    refunded_at = Column(DateTime, nullable=True,
                          comment="仅 type=CONSUME 行使用: 被退费时间; NULL=未退费, 用于防重放")
    note = Column(String(255), nullable=True, comment="备注文本")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
