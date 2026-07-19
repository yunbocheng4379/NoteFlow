from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class UserTranscriberConfig(Base):
    """用户音频转写器配置表，每个用户最多一条记录"""
    __tablename__ = "user_transcriber_configs"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="记录 ID，主键，自增")
    user_id = Column(Integer, nullable=False, unique=True, index=True, comment="所属用户 ID，关联 users.id；UNIQUE 确保每用户只有一份配置")
    transcriber_type = Column(
        String(64), nullable=False, default="fast-whisper",
        comment="转写引擎类型：fast-whisper（本地 CPU/GPU）、mlx-whisper（Apple Silicon 加速）、"
                "bcut（B站 AI 字幕 API，免费但仅中文）、kuaishou（快手字幕 API）、groq（Groq 云端 Whisper，需 API Key）"
    )
    whisper_model_size = Column(
        String(32), nullable=False, default="tiny",
        comment="Whisper 模型尺寸，仅 fast-whisper / mlx-whisper 生效；"
                "可选：tiny、base、small、medium、large-v2、large-v3；"
                "模型越大精度越高，但需要更多内存和时间"
    )
    created_at = Column(DateTime, server_default=func.now(), comment="配置创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近更新时间")
