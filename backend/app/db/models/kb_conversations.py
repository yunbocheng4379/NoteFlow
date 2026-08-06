from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey, func

from app.db.engine import Base


class KbConversation(Base):
    """知识库会话：用户跨笔记 AI 问答的一次多轮对话"""
    __tablename__ = "kb_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="会话 ID，主键，自增")
    user_id = Column(Integer, nullable=False, index=True, comment="所属用户 ID")
    title = Column(String(200), nullable=True, comment="会话标题，首次提问后取问题前 30 字自动生成")
    provider_id = Column(String(64), nullable=True, comment="该会话最近使用的供应商 ID，用于下次打开默认选中")
    model_name = Column(String(128), nullable=True, comment="该会话最近使用的模型名")
    is_pinned = Column(Boolean, nullable=False, server_default="0", default=False, comment="是否置顶，置顶会话在列表最上方")
    is_unread = Column(Boolean, nullable=False, server_default="0", default=False, comment="是否标记为未读，仅前端展示提醒用")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近一次问答时间，用于会话列表排序")


class KbMessage(Base):
    """知识库消息：会话中的单条问答记录"""
    __tablename__ = "kb_messages"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="消息 ID，主键，自增")
    conversation_id = Column(Integer, ForeignKey("kb_conversations.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属会话 ID")
    role = Column(String(16), nullable=False, comment="角色：user / assistant")
    content = Column(Text, nullable=False, comment="最终答案正文（不含思考过程），或用户提问内容")
    reasoning_content = Column(Text, nullable=True, comment="深度思考过程内容，仅 assistant 且开启深度思考时有值")
    sources = Column(Text, nullable=True, comment="JSON 字符串，引用的跨笔记片段列表（含 task_id、笔记标题、片段文本）")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间，决定消息在会话内的顺序")
