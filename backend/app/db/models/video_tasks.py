from sqlalchemy import Column, Integer, String, DateTime, func

from app.db.engine import Base


class VideoTask(Base):
    """视频笔记生成任务记录表，用于前端通过 task_id 轮询任务状态"""
    __tablename__ = "video_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="记录 ID，主键，自增")
    user_id = Column(Integer, nullable=True, index=True, comment="发起任务的用户 ID；NULL 表示未登录/匿名任务")
    video_id = Column(String(512), nullable=False, comment="视频唯一标识，通常为平台视频 ID（如 BV 号、YouTube video_id）或本地文件路径")
    platform = Column(
        String(64), nullable=False,
        comment="视频来源平台，用于选择对应下载器：bilibili、youtube、douyin、kuaishou、local"
    )
    task_id = Column(String(64), unique=True, nullable=False, comment="任务唯一标识，UUID 字符串，前端凭此轮询 /task_status/{task_id}")
    video_url = Column(String(1024), nullable=True, comment="原始视频链接")
    model_name = Column(String(128), nullable=True, comment="生成笔记使用的模型名称")
    status = Column(String(32), nullable=False, server_default="PENDING", comment="任务状态：PENDING/DOWNLOADING/TRANSCRIBING/GENERATING/SUCCESS/FAILED")
    credits_used = Column(Integer, nullable=False, server_default="20", comment="本次任务消耗的电力，默认 20")
    completed_at = Column(DateTime, nullable=True, comment="任务完成时间（SUCCESS 或 FAILED 时写入）")
    created_at = Column(DateTime, server_default=func.now(), comment="任务创建时间")
