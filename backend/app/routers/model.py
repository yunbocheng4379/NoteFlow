import logging

from fastapi import APIRouter, Depends, Query
from typing import Optional
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, get_current_admin
from app.db.models.users import User
from app.services.model import ModelService
from app.utils.error_messages import translate_model_error
from app.utils.response import ResponseWrapper as R

logger = logging.getLogger(__name__)
router = APIRouter()
modelService = ModelService()


def _tier_filter_for(user: User) -> list:
    """免费用户只能看 normal 模型，Pro 会员可看 normal + pro"""
    if user.active_subscription_id:
        return ["normal", "pro"]
    return ["normal"]


class CreateModelRequest(BaseModel):
    provider_id: str
    model_name: str
    tier: str = "normal"


class UpdateModelTierRequest(BaseModel):
    tier: str


class ModelItem(BaseModel):
    id: int
    model_name: str


@router.get("/model_list")
def model_list(current_user: User = Depends(get_current_user)):
    try:
        tier_filter = _tier_filter_for(current_user)
        return R.success(modelService.get_all_models(tier_filter=tier_filter, verbose=True), msg="获取模型列表成功")
    except Exception as e:
        logger.error(f"获取模型列表失败: {e}", exc_info=True)
        return R.error("获取模型列表失败，请刷新页面重试")


@router.get("/models/delete/{model_id}")
def delete_model(model_id: int, current_user: User = Depends(get_current_admin)):
    try:
        success = modelService.delete_model_by_id(model_id)
        if success:
            return R.success(msg="模型删除成功")
        else:
            return R.error("模型不存在或无权删除")
    except Exception as e:
        logger.error(f"删除模型 {model_id} 失败: {e}", exc_info=True)
        return R.error("删除模型失败，请重试")


@router.get("/model_list/{provider_id}")
def model_list_by_provider(
    provider_id: str,
    api_key: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_admin),
):
    try:
        result = modelService.get_all_models_by_id(
            provider_id, api_key=api_key
        )
        return R.success(result)
    except Exception as e:
        logger.error(f"获取供应商 {provider_id} 模型列表失败: {e}", exc_info=True)
        friendly = translate_model_error(e)
        return R.error(msg=friendly)


@router.post("/models")
def create_model(data: CreateModelRequest, current_user: User = Depends(get_current_admin)):
    try:
        success = ModelService.add_new_model(
            data.provider_id, data.model_name, tier=data.tier, created_by=current_user.id
        )
        if not success:
            return R.error("模型添加失败，请确认供应商是否存在")
        return R.success(msg="模型添加成功")
    except Exception as e:
        logger.error(f"添加模型失败 provider={data.provider_id} model={data.model_name}: {e}", exc_info=True)
        friendly = translate_model_error(e)
        return R.error(msg=friendly)


@router.post("/models/{model_id}/tier")
def update_model_tier(
    model_id: int, data: UpdateModelTierRequest, current_user: User = Depends(get_current_admin)
):
    try:
        if data.tier not in ("normal", "pro"):
            return R.error("tier 只能是 normal 或 pro")
        success = ModelService.set_model_tier(model_id, data.tier)
        if not success:
            return R.error("模型不存在或无权修改")
        return R.success(msg="模型等级已更新")
    except Exception as e:
        logger.error(f"更新模型 {model_id} 等级失败: {e}", exc_info=True)
        return R.error("更新模型等级失败，请重试")


@router.get("/model_enable/{provider_id}")
def get_enabled_models_by_provider(provider_id: str, current_user: User = Depends(get_current_user)):
    try:
        tier_filter = _tier_filter_for(current_user)
        models = modelService.get_enabled_models_by_provider(provider_id, tier_filter=tier_filter)
        return R.success(models, msg="获取启用模型成功")
    except Exception as e:
        logger.error(f"获取启用模型失败 provider={provider_id}: {e}", exc_info=True)
        return R.error("获取启用模型失败，请刷新页面重试")
