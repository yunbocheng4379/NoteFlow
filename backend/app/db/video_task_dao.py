from datetime import datetime
from typing import Optional

from app.db.models.video_tasks import VideoTask
from app.db.engine import get_db
from app.utils.logger import get_logger

logger = get_logger(__name__)


def insert_video_task(
    video_id: str,
    platform: str,
    task_id: str,
    user_id: Optional[int] = None,
    video_url: Optional[str] = None,
    model_name: Optional[str] = None,
    status: str = "PENDING",
    credits_used: int = 20,
):
    db = next(get_db())
    try:
        task = VideoTask(
            video_id=video_id,
            platform=platform,
            task_id=task_id,
            user_id=user_id,
            video_url=video_url,
            model_name=model_name,
            status=status,
            credits_used=credits_used,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        logger.info(f"Video task inserted. video_id={video_id}, platform={platform}, task_id={task_id}")
    except Exception as e:
        logger.error(f"Failed to insert video task: {e}")
    finally:
        db.close()


def update_task_status(task_id: str, status: str, completed: bool = False):
    db = next(get_db())
    try:
        task = db.query(VideoTask).filter_by(task_id=task_id).first()
        if task:
            task.status = status
            if completed:
                task.completed_at = datetime.now()
            db.commit()
    except Exception as e:
        logger.error(f"Failed to update task status: {e}")
    finally:
        db.close()


def get_task_by_video(video_id: str, platform: str, user_id: Optional[int] = None):
    db = next(get_db())
    try:
        q = db.query(VideoTask).filter_by(video_id=video_id, platform=platform)
        if user_id is not None:
            q = q.filter(VideoTask.user_id == user_id)
        task = q.order_by(VideoTask.created_at.desc()).first()
        return task.task_id if task else None
    except Exception as e:
        logger.error(f"Failed to get task by video: {e}")
    finally:
        db.close()


def get_task_by_task_id(task_id: str):
    db = next(get_db())
    try:
        return db.query(VideoTask).filter_by(task_id=task_id).first()
    except Exception as e:
        logger.error(f"Failed to get task by task_id: {e}")
    finally:
        db.close()


def delete_task_by_video(video_id: str, platform: str, user_id: Optional[int] = None):
    db = next(get_db())
    try:
        q = db.query(VideoTask).filter_by(video_id=video_id, platform=platform)
        if user_id is not None:
            q = q.filter(VideoTask.user_id == user_id)
        for task in q.all():
            db.delete(task)
        db.commit()
        logger.info(f"Task(s) deleted for video_id={video_id}, platform={platform}")
    except Exception as e:
        logger.error(f"Failed to delete task by video: {e}")
    finally:
        db.close()
