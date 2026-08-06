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
                "supports_reasoning": bool(model.supports_reasoning),
                "supports_vision": bool(model.supports_vision),
                "created_at": model.created_at,
            }
        return None
    finally:
        db.close()


def insert_model(provider_id: int, model_name: str, tier: str = "normal", supports_reasoning: int = 0,
                  supports_vision: int = 0, created_by: Optional[int] = None):
    """新增全局模型（仅管理员可调用）；created_by 记录创建人 id，仅用于追溯，不参与查询过滤

    副作用: 会自动往 credit_pricing 表镜像插入一条默认费率行 (若尚不存在),
    这样管理员在「电力规则」页面能直接看到并调整该模型的单价.
    """
    db = next(get_db())
    try:
        model = Model(provider_id=provider_id, model_name=model_name, user_id=created_by, tier=tier,
                      supports_reasoning=supports_reasoning, supports_vision=supports_vision)
        db.add(model)
        db.commit()
        db.refresh(model)
        result = {
            "id": model.id,
            "provider_id": model.provider_id,
            "model_name": model.model_name,
            "tier": model.tier,
            "supports_reasoning": bool(model.supports_reasoning),
            "supports_vision": bool(model.supports_vision),
            "created_at": model.created_at,
        }
    finally:
        db.close()

    from app.db.credit_pricing_dao import sync_add_model_rate
    sync_add_model_rate(model_name)
    return result


def get_models_by_provider(provider_id: int, tier_filter: Optional[list] = None):
    db = next(get_db())
    try:
        q = db.query(Model).filter_by(provider_id=provider_id)
        if tier_filter is not None:
            q = q.filter(Model.tier.in_(tier_filter))
        models = q.all()
        return [{"id": m.id, "model_name": m.model_name, "tier": m.tier,
                 "supports_reasoning": bool(m.supports_reasoning),
                 "supports_vision": bool(m.supports_vision)} for m in models]
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


def update_model_supports_reasoning(model_id: int, enabled: bool) -> bool:
    """更新模型是否支持深度思考（仅管理员可调用）"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if not model:
            return False
        model.supports_reasoning = 1 if enabled else 0
        db.commit()
        return True
    finally:
        db.close()


def update_model_supports_vision(model_id: int, enabled: bool) -> bool:
    """更新模型是否支持视觉/多模态输入（仅管理员可调用）"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if not model:
            return False
        model.supports_vision = 1 if enabled else 0
        db.commit()
        return True
    finally:
        db.close()


def update_model(model_id: int, tier: str, supports_reasoning: int, supports_vision: int) -> bool:
    """同时更新模型等级 + 深度思考支持 + 视觉支持（仅管理员可调用），供"保存模型"重新保存已存在模型时使用"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if not model:
            return False
        model.tier = tier
        model.supports_reasoning = supports_reasoning
        model.supports_vision = supports_vision
        db.commit()
        return True
    finally:
        db.close()


def delete_model(model_id: int):
    """删除模型（仅管理员可调用）

    副作用: 若其它 provider 已经没有这个 model_name 了, 会把 credit_pricing 里对应行也清理掉,
    避免「电力规则」页面残留孤儿费率. 有其它 provider 还在用则保留.
    """
    deleted_model_name: Optional[str] = None
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if model:
            deleted_model_name = model.model_name
            db.delete(model)
            db.commit()
    finally:
        db.close()

    if deleted_model_name:
        from app.db.credit_pricing_dao import sync_remove_model_rate_if_orphan
        sync_remove_model_rate_if_orphan(deleted_model_name)


def get_all_models(tier_filter: Optional[list] = None):
    db = next(get_db())
    try:
        q = db.query(Model).join(Provider, Model.provider_id == Provider.id).filter(Provider.enabled == 1)
        if tier_filter is not None:
            q = q.filter(Model.tier.in_(tier_filter))
        models = q.all()
        return [
            {
                "id": m.id,
                "provider_id": m.provider_id,
                "model_name": m.model_name,
                "tier": m.tier,
                "supports_reasoning": bool(m.supports_reasoning),
                "supports_vision": bool(m.supports_vision),
            }
            for m in models
        ]
    finally:
        db.close()
