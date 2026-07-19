from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class CreditPricing(Base):
    """模型计费率配置表 (按分钟单价)"""
    __tablename__ = "credit_pricing"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键")
    model_name = Column(String(128), unique=True, nullable=False,
                         comment="模型名称, 与 VideoTask.model_name 一致; __default__ 为兜底")
    rate_per_minute = Column(Integer, nullable=False, comment="每分钟消耗电力数 (整数)")
    is_active = Column(Integer, nullable=False, default=1, comment="是否启用: 1=启用, 0=停用")
    is_default = Column(Integer, nullable=False, default=0,
                         comment="是否兜底: 1=未匹配 model_name 时使用 (应用层保证全表至多一条)")
    description = Column(String(255), nullable=True, comment="描述, 展示用")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
