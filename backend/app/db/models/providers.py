from sqlalchemy import Column, String, Integer, DateTime, func

from app.db.engine import Base


class Provider(Base):
    """LLM 服务供应商配置表（如 OpenAI、DeepSeek、通义千问等）；全局资源，仅管理员可增删改"""
    __tablename__ = "providers"

    id = Column(String(64), primary_key=True, comment="供应商唯一标识，UUID 字符串，由业务层生成")
    user_id = Column(Integer, nullable=True, index=True, comment="配置/最近编辑该供应商的用户 id，仅用于追溯，不参与查询过滤；无特定配置人时为 NULL")
    name = Column(String(128), nullable=False, comment="供应商显示名称，如 'OpenAI'、'DeepSeek'")
    logo = Column(String(512), nullable=False, comment="供应商 Logo 图片路径或 URL")
    type = Column(String(64), nullable=False, comment="供应商类型/接口协议，如 'openai'、'anthropic'，决定调用哪个 SDK 适配器")
    api_key = Column(String(512), nullable=False, comment="API 密钥，前端读取时会脱敏处理（只显示末 4 位）")
    base_url = Column(String(512), nullable=False, comment="API 基础地址，支持自定义代理或私有部署地址")
    enabled = Column(Integer, default=1, comment="启用状态：1=启用，0=停用；停用后该供应商下的模型不可选")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
