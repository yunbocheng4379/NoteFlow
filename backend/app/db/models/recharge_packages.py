from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class RechargePackage(Base):
    """充值套餐定义表"""
    __tablename__ = "recharge_packages"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键")
    code = Column(String(32), unique=True, nullable=False, comment="套餐编码, 程序内引用, 如 PKG_BASIC")
    name = Column(String(64), nullable=False, comment="展示名称, 如 入门包")
    price_cents = Column(Integer, nullable=False, comment="价格 (分), 1 元 = 100 分")
    credits = Column(Integer, nullable=False, comment="充值获得的电力数")
    unit_price_text = Column(String(32), nullable=True, comment="展示用单价文案, 如 ¥0.099/电力")
    sort_order = Column(Integer, nullable=False, default=0, comment="展示排序 (升序)")
    badge = Column(String(32), nullable=True, comment="徽章文案, 如 最受欢迎")
    is_active = Column(Integer, nullable=False, default=1, comment="是否上架: 1/0")
    description = Column(String(255), nullable=True, comment="描述, 如 ≈5 篇 30 分钟视频")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
