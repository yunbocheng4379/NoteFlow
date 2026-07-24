from sqlalchemy import Column, Integer, String, DateTime, Text, UniqueConstraint, func

from app.db.engine import Base


class NoteCollection(Base):
    """笔记合集：用户手动创建的分组容器，用于把同一主题的笔记归类管理"""
    __tablename__ = "note_collections"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="合集 ID，主键，自增")
    user_id = Column(Integer, nullable=False, index=True, comment="创建者用户 ID")
    name = Column(String(100), nullable=False, comment="合集名称")
    description = Column(String(500), nullable=True, comment="合集描述，可为空")
    cover_url = Column(String(512), nullable=True, comment="合集封面图片 URL，可为空，前端为空时展示默认文件夹图标")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近更新时间（含笔记增删）")


class NoteCollectionItem(Base):
    """合集与笔记的多对多关联：一篇笔记可加入多个合集，一个合集可包含多篇笔记"""
    __tablename__ = "note_collection_items"
    __table_args__ = (
        UniqueConstraint("collection_id", "task_id", name="uk_collection_task"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True, comment="关联记录 ID，主键，自增")
    collection_id = Column(Integer, nullable=False, index=True, comment="关联的合集 ID，对应 note_collections.id")
    task_id = Column(String(64), nullable=False, index=True, comment="关联的笔记任务 ID，对应 video_tasks.task_id")
    created_at = Column(DateTime, server_default=func.now(), comment="加入合集时间")
