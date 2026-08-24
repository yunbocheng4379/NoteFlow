"""Administrator configuration for note-style AI safety screening."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_admin
from app.db.engine import SessionLocal
from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db import system_settings_dao
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R


router = APIRouter(prefix="/admin/content_moderation", tags=["admin-content-moderation"])


class ModerationModelRequest(BaseModel):
    provider_id: str = Field(..., min_length=1, max_length=64)
    model_name: str = Field(..., min_length=1, max_length=128)


def _available_models() -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(Model, Provider)
            .join(Provider, Provider.id == Model.provider_id)
            .filter(Provider.enabled == 1)
            .order_by(Provider.name.asc(), Model.model_name.asc())
            .all()
        )
        return [
            {
                "id": model.id,
                "provider_id": model.provider_id,
                "provider_name": provider.name,
                "model_name": model.model_name,
                "label": f"{provider.name} / {model.model_name}",
            }
            for model, provider in rows
        ]
    finally:
        db.close()


def _config_payload() -> dict:
    saved = system_settings_dao.get_note_style_moderation_model()
    models = _available_models()
    selected = next(
        (
            item for item in models
            if saved
            and item["provider_id"] == saved["provider_id"]
            and item["model_name"] == saved["model_name"]
        ),
        None,
    )
    return {
        "configured": selected is not None,
        "selected": selected,
        "models": models,
    }


@router.get("/config")
def get_content_moderation_config(_: User = Depends(get_current_admin)):
    return R.success(_config_payload())


@router.put("/config")
def update_content_moderation_config(
    body: ModerationModelRequest,
    current_admin: User = Depends(get_current_admin),
):
    db = SessionLocal()
    try:
        provider = (
            db.query(Provider)
            .filter(Provider.id == body.provider_id, Provider.enabled == 1)
            .first()
        )
        model = (
            db.query(Model)
            .filter(Model.provider_id == body.provider_id, Model.model_name == body.model_name)
            .first()
        )
    finally:
        db.close()

    if provider is None or model is None:
        return R.error(msg="供应商未启用或模型不存在，请刷新模型配置后重试", code=400)

    system_settings_dao.set_note_style_moderation_model(
        provider_id=body.provider_id,
        model_name=body.model_name,
        updated_by=current_admin.id,
    )
    return R.success(_config_payload(), msg="安全检测模型已更新")
