import logging
from typing import Optional
from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user, get_current_admin
from app.db.models.users import User
from app.exceptions.provider import ProviderError
from app.services.model import ModelService
from app.utils.error_messages import translate_connect_error
from app.utils.response import ResponseWrapper as R
from app.services.provider import ProviderService
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class ProviderRequest(BaseModel):
    name: str
    api_key: str
    base_url: str
    logo: Optional[str] = None
    type: str


class TestRequest(BaseModel):
    id: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ProviderUpdateRequest(BaseModel):
    id: str
    name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    logo: Optional[str] = None
    type: Optional[str] = None
    enabled: Optional[int] = None


@router.post("/add_provider")
def add_provider(data: ProviderRequest, current_user: User = Depends(get_current_admin)):
    try:
        res = ProviderService.add_provider(
            name=data.name,
            api_key=data.api_key,
            base_url=data.base_url,
            logo=data.logo,
            type_=data.type,
            user_id=current_user.id,
        )
        return R.success(msg='添加模型供应商成功', data=res)
    except Exception as e:
        logger.error(f"添加供应商失败: {e}", exc_info=True)
        return R.error(msg=f"添加供应商失败：{str(e)[:100]}")


@router.get("/get_all_providers")
def get_all_providers(current_user: User = Depends(get_current_user)):
    try:
        res = ProviderService.get_all_providers_safe()
        return R.success(data=res)
    except Exception as e:
        logger.error(f"获取供应商列表失败: {e}", exc_info=True)
        return R.error(msg="获取供应商列表失败，请刷新页面重试")


@router.get("/get_provider_by_id/{id}")
def get_provider_by_id(id: str, current_user: User = Depends(get_current_user)):
    try:
        res = ProviderService.get_provider_by_id_safe(id)
        if res is None:
            return R.error(msg="供应商不存在", code=404)
        return R.success(data=res)
    except Exception as e:
        logger.error(f"获取供应商 {id} 失败: {e}", exc_info=True)
        return R.error(msg="获取供应商信息失败，请刷新页面重试")


@router.post("/update_provider")
def update_provider(data: ProviderUpdateRequest, current_user: User = Depends(get_current_admin)):
    try:
        if all(
            field is None
            for field in [data.name, data.api_key, data.base_url, data.logo, data.type, data.enabled]
        ):
            return R.error(msg='请至少填写一个参数')

        updated_provider = ProviderService.update_provider(
            id=data.id,
            data=dict(data),
            user_id=current_user.id,
        )
        if updated_provider:
            return R.success(msg='更新模型供应商成功', data=updated_provider)
        else:
            return R.error(msg='更新模型供应商失败，请检查供应商是否存在')
    except Exception as e:
        logger.error(f"更新供应商 {data.id} 失败: {e}", exc_info=True)
        return R.error(msg=f"更新供应商失败：{str(e)[:100]}")


@router.post('/connect_test')
def gpt_connect_test(data: TestRequest, current_user: User = Depends(get_current_admin)):
    try:
        ModelService().connect_test(
            data.id,
            model=data.model,
            api_key=data.api_key,
            base_url=data.base_url,
        )
        return R.success(msg='连接成功')
    except ProviderError as e:
        logger.error(f"连通性测试失败 [{data.id}]: {e.message}", exc_info=True)
        friendly = translate_connect_error(e)
        return R.error(msg=friendly, code=e.code.code if hasattr(e.code, 'code') else 500)
    except Exception as e:
        logger.error(f"连通性测试异常 [{data.id}]: {e}", exc_info=True)
        friendly = translate_connect_error(e)
        return R.error(msg=friendly)
