from sqlalchemy import Column, Integer, String, Boolean, DateTime, func

from app.db.engine import Base


class CollectionShare(Base):
    """合集分享记录表，存储分享 token、状态与访问次数"""
    __tablename__ = "collection_shares"

    id = Column(Integer, primary_key=True, autoincrement=True)
    collection_id = Column(Integer, unique=True, nullable=False, index=True, comment="关联的合集 ID，对应 note_collections.id")
    user_id = Column(Integer, nullable=False, index=True, comment="合集所有者用户 ID")
    share_token = Column(String(64), unique=True, nullable=False, index=True, comment="分享凭证，UUID 去掉连字符")
    is_active = Column(Boolean, nullable=False, default=True, comment="True=分享开启，False=已关闭")
    view_count = Column(Integer, nullable=False, default=0, comment="无需登录访问次数")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
