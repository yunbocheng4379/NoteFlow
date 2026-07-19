from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, func

from app.db.engine import Base


class NoteStyle(Base):
    """笔记风格模板表，存储系统内置风格和用户自定义风格"""
    __tablename__ = "note_styles"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="记录 ID，主键，自增")
    name = Column(String(50), nullable=False, comment="风格显示名称，如 '精简'、'学术'，最长 50 字")
    value = Column(String(64), nullable=False, index=True, comment="风格唯一标识键，英文下划线命名，如 'minimal'、'xiaohongshu'；传给 LLM 时用于查找对应 prompt，创建后不可修改")
    description = Column(String(200), nullable=True, comment="风格简介，对用户展示，可为空，最长 200 字")
    prompt = Column(Text, nullable=False, comment="注入到 LLM 提示词中的风格指令，描述具体的输出格式和语气要求，最长 2000 字")
    source = Column(String(16), nullable=False, default="user", comment="来源类型：system=系统内置（随版本预置，不可删除）；user=用户自定义")
    user_id = Column(Integer, nullable=True, index=True, comment="创建该风格的用户 ID；source=system 时为 NULL")
    is_public = Column(Boolean, nullable=False, default=False, comment="是否公开到广场：True=所有用户可见并使用，False=仅创建者可见")
    icon = Column(String(32), nullable=True, comment="图标 key，对应前端预置图标集中的键名；为空时前端使用首字母头像兜底展示")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近更新时间")
