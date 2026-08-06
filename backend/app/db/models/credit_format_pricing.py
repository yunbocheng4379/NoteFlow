from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class CreditFormatPricing(Base):
    """笔记格式计费率配置表 (按分钟单价, 与 credit_pricing 的模型费率叠加)"""
    __tablename__ = "credit_format_pricing"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键")
    format_key = Column(String(64), unique=True, nullable=False,
                         comment="格式标识: toc/link/screenshot/summary, 与前端 note_formats.value 一致")
    rate_per_minute = Column(Integer, nullable=False, default=0, comment="每分钟消耗电力数 (整数)")
    is_active = Column(Integer, nullable=False, default=1, comment="是否启用: 1=启用, 0=停用")
    description = Column(String(255), nullable=True, comment="描述, 展示用")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
