from typing import Optional

from app.db.engine import get_db
from app.db.models.models import Model
from app.db.models.providers import Provider


def get_model_by_provider_and_name(provider_id: int, model_name: str):
    """按 provider_id + model_name 判重/查询；模型是全局资源，不按创建人过滤"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(provider_id=provider_id, model_name=model_name).first()
        if model:
            return {
                "id": model.id,
                "provider_id": model.provider_id,
                "model_name": model.model_name,
                "tier": model.tier,
                "created_at": model.created_at,
            }
        return None
    finally:
        db.close()


def insert_model(provider_id: int, model_name: str, tier: str = "normal", created_by: Optional[int] = None):
    """新增全局模型（仅管理员可调用）；created_by 记录创建人 id，仅用于追溯，不参与查询过滤"""
    db = next(get_db())
    try:
        model = Model(provider_id=provider_id, model_name=model_name, user_id=created_by, tier=tier)
        db.add(model)
        db.commit()
        db.refresh(model)
        return {
            "id": model.id,
            "provider_id": model.provider_id,
            "model_name": model.model_name,
            "tier": model.tier,
            "created_at": model.created_at,
        }
    finally:
        db.close()


def get_models_by_provider(provider_id: int, tier_filter: Optional[list] = None):
    db = next(get_db())
    try:
        q = db.query(Model).filter_by(provider_id=provider_id)
        if tier_filter is not None:
            q = q.filter(Model.tier.in_(tier_filter))
        models = q.all()
        return [{"id": m.id, "model_name": m.model_name, "tier": m.tier} for m in models]
    finally:
        db.close()


def update_model_tier(model_id: int, tier: str) -> bool:
    """更新模型等级（仅管理员可调用）"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if not model:
            return False
        model.tier = tier
        db.commit()
        return True
    finally:
        db.close()


def delete_model(model_id: int):
    """删除模型（仅管理员可调用）"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if model:
            db.delete(model)
            db.commit()
    finally:
        db.close()


def get_all_models(tier_filter: Optional[list] = None):
    db = next(get_db())
    try:
        q = db.query(Model).join(Provider, Model.provider_id == Provider.id).filter(Provider.enabled == 1)
        if tier_filter is not None:
            q = q.filter(Model.tier.in_(tier_filter))
        models = q.all()
        return [
            {"id": m.id, "provider_id": m.provider_id, "model_name": m.model_name, "tier": m.tier}
            for m in models
        ]
    finally:
        db.close()
