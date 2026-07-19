from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class Model(Base):
    """LLM 模型配置表，全局资源，仅管理员可增删改；按 tier 分级向用户展示"""
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="模型记录 ID，主键，自增")
    user_id = Column(Integer, nullable=True, index=True, comment="创建人 id，记录添加该模型的管理员用户 id；不参与查询过滤，仅用于追溯")
    provider_id = Column(String(64), nullable=False, comment="关联的供应商 ID，对应 providers.id")
    model_name = Column(String(128), nullable=False, comment="模型名称，如 'gpt-4o'、'deepseek-chat'，直接传给 API 的 model 参数")
    tier = Column(String(16), nullable=False, default="normal", server_default="normal",
                  comment="模型等级：normal=普通用户可用，pro=仅 Pro 会员可用")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
