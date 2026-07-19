"""
平台配置 CRUD 接口.

GET  /platforms              — 获取所有平台列表（前端 Cookie 池等需要）
POST /platforms              — 新增平台
PUT  /platforms/{platform_id} — 更新平台（含代理配置）
DELETE /platforms/{platform_id} — 删除平台

所有接口仅管理员可访问（依赖 get_current_user + role='admin' 检查）.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth.dependencies import get_current_user
from app.db.engine import SessionLocal
from app.db.platform_dao import PlatformDAO
from app.db.models.users import User
from app.services.proxy_config_manager import ProxyConfigManager
from app.utils.response import ResponseWrapper as R
from app.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


# ---- Pydantic 请求/响应模型 ----

class PlatformCreateRequest(BaseModel):
    platform_id: str
    name: str
    icon_url: Optional[str] = None
    proxy_url: Optional[str] = None
    is_enabled: bool = True
    sort_order: int = 0


class PlatformUpdateRequest(BaseModel):
    name: Optional[str] = None
    icon_url: Optional[str] = None
    proxy_url: Optional[str] = None  # 传 ""=清空, 传 None=不修改
    is_enabled: Optional[bool] = None
    sort_order: Optional[int] = None


def _platform_to_dict(p) -> dict:
    return {
        "platform_id": p.platform_id,
        "name": p.name,
        "icon_url": p.icon_url,
        "proxy_url": p.proxy_url or "",
        "is_enabled": bool(p.is_enabled),
        "sort_order": p.sort_order,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


def _require_admin(user: User):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")


# ---- 接口 ----

@router.get("/platforms")
def list_platforms(current_user: User = Depends(get_current_user)):
    """获取所有平台配置，供前端下拉/标签切换使用."""
    try:
        db = SessionLocal()
        try:
            dao = PlatformDAO(db)
            # 启动时确保有默认数据
            platforms = dao.seed_default_if_empty()
            return R.success(data=[_platform_to_dict(p) for p in platforms])
        finally:
            db.close()
    except Exception as e:
        logger.error(f"获取平台列表失败: {e}", exc_info=True)
        return R.error(msg="获取平台列表失败")


@router.post("/platforms")
def create_platform(
    data: PlatformCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """新增平台，仅管理员."""
    _require_admin(current_user)
    try:
        db = SessionLocal()
        try:
            dao = PlatformDAO(db)
            existing = dao.get_by_platform_id(data.platform_id)
            if existing:
                return R.error(msg=f"平台 {data.platform_id} 已存在")

            p = dao.create(
                platform_id=data.platform_id,
                name=data.name,
                icon_url=data.icon_url,
                proxy_url=data.proxy_url,
                is_enabled=1 if data.is_enabled else 0,
                sort_order=data.sort_order,
            )
            # 清除缓存
            ProxyConfigManager.invalidate_platform_cache(data.platform_id)
            logger.info(f"管理员 {current_user.id} 新增平台: {data.platform_id}")
            return R.success(data=_platform_to_dict(p))
        finally:
            db.close()
    except Exception as e:
        logger.error(f"新增平台失败: {e}", exc_info=True)
        return R.error(msg="新增平台失败")


@router.put("/platforms/{platform_id}")
def update_platform(
    platform_id: str,
    data: PlatformUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """更新平台配置，仅管理员."""
    _require_admin(current_user)
    try:
        db = SessionLocal()
        try:
            dao = PlatformDAO(db)
            p = dao.update(
                platform_id=platform_id,
                name=data.name,
                icon_url=data.icon_url,
                proxy_url=data.proxy_url,  # ""=清空, None=不修改
                is_enabled=1 if data.is_enabled else 0 if data.is_enabled is not None else None,
                sort_order=data.sort_order,
            )
            if not p:
                return R.error(msg=f"平台 {platform_id} 不存在")
            # 清除缓存让新代理生效
            ProxyConfigManager.invalidate_platform_cache(platform_id)
            # is_enabled 变更时刷新 cookie 池内存缓存（禁用平台→清空可用列表；启用→下次 pick 重新加载）
            if data.is_enabled is not None:
                from app.services.cookie_pool_manager import CookiePoolManager
                CookiePoolManager.instance().reload()
                logger.info(f"平台 {platform_id} is_enabled={p.is_enabled}，已刷新 Cookie 池缓存")
            logger.info(f"管理员 {current_user.id} 更新平台: {platform_id}")
            return R.success(data=_platform_to_dict(p))
        finally:
            db.close()
    except Exception as e:
        logger.error(f"更新平台失败: {e}", exc_info=True)
        return R.error(msg="更新平台配置失败")


@router.delete("/platforms/{platform_id}")
def delete_platform(
    platform_id: str,
    current_user: User = Depends(get_current_user),
):
    """删除平台，仅管理员."""
    _require_admin(current_user)
    try:
        db = SessionLocal()
        try:
            dao = PlatformDAO(db)
            ok = dao.delete(platform_id)
            if not ok:
                return R.error(msg=f"平台 {platform_id} 不存在")
            ProxyConfigManager.invalidate_platform_cache(platform_id)
            logger.info(f"管理员 {current_user.id} 删除平台: {platform_id}")
            return R.success(msg="删除成功")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"删除平台失败: {e}", exc_info=True)
        return R.error(msg="删除平台失败")
