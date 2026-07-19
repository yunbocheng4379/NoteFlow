from sqlalchemy import Column, Integer, BigInteger, String, DateTime, Enum, ForeignKey, func

from app.db.engine import Base


ORDER_KINDS = ("RECHARGE", "SUBSCRIPTION")
ORDER_STATUSES = ("PENDING", "PAID", "CANCELLED", "REFUNDED")
ORDER_PAY_METHODS = ("MOCK_ALIPAY", "MOCK_WECHAT", "ALIPAY", "WECHAT")


class Order(Base):
    """订单表 (充值 + 订阅)"""
    __tablename__ = "orders"

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="主键")
    order_no = Column(String(32), unique=True, nullable=False, comment="订单号, BN + yyyymmdd + 12位随机")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, comment="下单用户 ID")
    kind = Column(Enum(*ORDER_KINDS, name="order_kind"), nullable=False,
                   comment="订单类型: RECHARGE=充值, SUBSCRIPTION=订阅")
    package_id = Column(Integer, ForeignKey("recharge_packages.id"), nullable=True,
                         comment="kind=RECHARGE 时引用 recharge_packages.id")
    plan_id = Column(Integer, ForeignKey("subscription_plans.id"), nullable=True,
                      comment="kind=SUBSCRIPTION 时引用 subscription_plans.id")
    is_first_subscription = Column(Integer, nullable=False, default=0,
                                    comment="创单时是否享受首单价 (仅 SUBSCRIPTION 有意义)")
    amount_cents = Column(Integer, nullable=False, comment="下单时锁定的金额 (分)")
    credits_amount = Column(Integer, nullable=False, comment="下单时锁定的电力数 (订阅订单为本期月发放量)")
    status = Column(Enum(*ORDER_STATUSES, name="order_status"), nullable=False, default="PENDING",
                     comment="订单状态")
    pay_method = Column(Enum(*ORDER_PAY_METHODS, name="order_pay_method"), nullable=True,
                         comment="支付方式: MOCK_ 前缀=mock 通道")
    mock_qrcode_token = Column(String(64), nullable=True, comment="一次性二维码 token; PAID 后清空")
    paid_at = Column(DateTime, nullable=True, comment="支付完成时间")
    cancelled_at = Column(DateTime, nullable=True, comment="取消时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
