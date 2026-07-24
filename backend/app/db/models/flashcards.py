from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func

from app.db.engine import Base


class FlashcardSet(Base):
    """闪记卡组：围绕某篇笔记生成的一组问答卡片"""
    __tablename__ = "flashcard_sets"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="卡组 ID，主键，自增")
    user_id = Column(Integer, nullable=False, index=True, comment="创建者用户 ID")
    task_id = Column(String(64), nullable=False, index=True, comment="源笔记 task_id，对应 video_tasks.task_id")
    title = Column(String(200), nullable=True, comment="卡组标题，默认取自源笔记标题")
    custom_prompt = Column(Text, nullable=True, comment="用户自定义出题要求，可为空")
    card_count = Column(Integer, nullable=False, default=10, comment="生成的卡片数量")
    provider_id = Column(String(64), nullable=True, comment="生成时使用的模型提供者 ID")
    model_name = Column(String(100), nullable=True, comment="生成时使用的模型名称")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class Flashcard(Base):
    """闪记卡单张卡片：一问一答"""
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="卡片 ID，主键，自增")
    set_id = Column(Integer, ForeignKey("flashcard_sets.id", ondelete="CASCADE"), nullable=False, index=True,
                     comment="所属卡组 ID，对应 flashcard_sets.id")
    question = Column(Text, nullable=False, comment="卡片问题")
    answer = Column(Text, nullable=False, comment="卡片答案")
    order_index = Column(Integer, nullable=False, default=0, comment="卡片顺序，从 0 开始")
