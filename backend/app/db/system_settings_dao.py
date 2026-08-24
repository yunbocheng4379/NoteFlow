"""Persistence helpers for administrator-managed system settings."""

import json
from typing import Optional

from app.db.engine import SessionLocal
from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.system_settings import SystemSetting


NOTE_STYLE_MODERATION_MODEL_KEY = "note_style_moderation_model"


def get_value(key: str) -> Optional[str]:
    db = SessionLocal()
    try:
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        return setting.value if setting else None
    finally:
        db.close()


def set_value(key: str, value: Optional[str], updated_by: Optional[int] = None) -> None:
    db = SessionLocal()
    try:
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if value is None:
            if setting:
                db.delete(setting)
        elif setting:
            setting.value = value
            setting.updated_by = updated_by
        else:
            db.add(SystemSetting(key=key, value=value, updated_by=updated_by))
        db.commit()
    finally:
        db.close()


def get_note_style_moderation_model() -> Optional[dict]:
    raw = get_value(NOTE_STYLE_MODERATION_MODEL_KEY)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    provider_id = str(value.get("provider_id") or "").strip()
    model_name = str(value.get("model_name") or "").strip()
    if not provider_id or not model_name:
        return None
    return {"provider_id": provider_id, "model_name": model_name}


def set_note_style_moderation_model(provider_id: str, model_name: str, updated_by: int) -> dict:
    value = {
        "provider_id": provider_id.strip(),
        "model_name": model_name.strip(),
    }
    set_value(NOTE_STYLE_MODERATION_MODEL_KEY, json.dumps(value, ensure_ascii=False), updated_by)
    return value


def is_active_note_style_moderation_model(config: Optional[dict]) -> bool:
    if not config:
        return False
    db = SessionLocal()
    try:
        provider = (
            db.query(Provider)
            .filter(Provider.id == config.get("provider_id"), Provider.enabled == 1)
            .first()
        )
        model = (
            db.query(Model)
            .filter(
                Model.provider_id == config.get("provider_id"),
                Model.model_name == config.get("model_name"),
            )
            .first()
        )
        return provider is not None and model is not None
    finally:
        db.close()
