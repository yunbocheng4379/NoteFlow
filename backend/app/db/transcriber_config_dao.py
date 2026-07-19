from typing import Dict, Any, Optional

from app.db.engine import get_db
from app.db.models.user_transcriber_configs import UserTranscriberConfig
from app.utils.logger import get_logger

logger = get_logger(__name__)

_DEFAULTS = {
    "transcriber_type": "fast-whisper",
    "whisper_model_size": "tiny",
}


def get_transcriber_config(user_id: int) -> Dict[str, Any]:
    db = next(get_db())
    try:
        row = db.query(UserTranscriberConfig).filter_by(user_id=user_id).first()
        if row:
            return {
                "transcriber_type": row.transcriber_type,
                "whisper_model_size": row.whisper_model_size,
            }
        return dict(_DEFAULTS)
    finally:
        db.close()


def update_transcriber_config(
    user_id: int,
    transcriber_type: str,
    whisper_model_size: Optional[str] = None,
) -> Dict[str, Any]:
    db = next(get_db())
    try:
        row = db.query(UserTranscriberConfig).filter_by(user_id=user_id).first()
        if row:
            row.transcriber_type = transcriber_type
            if whisper_model_size is not None:
                row.whisper_model_size = whisper_model_size
        else:
            db.add(UserTranscriberConfig(
                user_id=user_id,
                transcriber_type=transcriber_type,
                whisper_model_size=whisper_model_size or _DEFAULTS["whisper_model_size"],
            ))
        db.commit()
        return get_transcriber_config(user_id)
    except Exception as e:
        logger.error(f"update_transcriber_config failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()
