"""
管理员: Cookie 池管理 API.

前缀: ``/api/admin/cookies`` (注册时由 app/__init__.py 统一加 ``/api`` 前缀).

所有接口要求 ``get_current_admin`` 依赖, 拿不到 admin 角色返回 403.

**安全注意**: ``cookie`` 字段在响应中以**明文**形式返回 (管理员视图,
需要看到内容用于核对). 业务层禁止给普通用户暴露此字段.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status as http_status
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_admin
from app.db import platform_cookie_dao
from app.db.models.users import User
from app.services.cookie_pool_manager import CookiePoolManager
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode


router = APIRouter(prefix="/admin/cookies", tags=["admin-cookies"])


VALID_PLATFORMS = {"bilibili", "youtube", "douyin", "kuaishou"}


# ==== Schemas ====

class CreateCookieRequest(BaseModel):
    platform: str = Field(..., description="bilibili / youtube / douyin / kuaishou")
    name: str = Field(..., min_length=1, max_length=64)
    cookie: str = Field(..., min_length=1, max_length=100_000)
    weight: int = Field(100, ge=1, le=1000)
    remark: Optional[str] = Field(None, max_length=1000)
    cohort: Optional[str] = Field("default", max_length=64,
                                  description="逻辑分组, 例: 'default' / 'vip' / 'test'")
    reserved_for_tier: Optional[List[str]] = Field(
        None, description="限定哪些 user tier 可用; 空=全部. 例: ['vip','admin']"
    )
    max_concurrent_uses: Optional[int] = Field(
        0, ge=0, description="最大并发使用数; 0=无限制"
    )


class UpdateCookieRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    remark: Optional[str] = Field(None, max_length=1000)
    is_enabled: Optional[bool] = None
    weight: Optional[int] = Field(None, ge=1, le=1000)
    cohort: Optional[str] = Field(None, max_length=64)
    # 传空列表 [] 表示清空"限定 tier" (即对所有 tier 开放).
    # 字段完全省略 (None) 表示不动这一列.
    reserved_for_tier: Optional[List[str]] = None
    max_concurrent_uses: Optional[int] = Field(None, ge=0)


class ImportItem(BaseModel):
    name: str
    cookie: str
    weight: Optional[int] = 100
    remark: Optional[str] = None
    cohort: Optional[str] = "default"
    reserved_for_tier: Optional[List[str]] = None
    max_concurrent_uses: Optional[int] = 0


class ImportRequest(BaseModel):
    platform: str
    items: List[ImportItem] = Field(..., min_length=1, max_length=500)


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="handled / closed / ignored")
    handler_note: Optional[str] = Field(None, max_length=2000)


def _validate_platform(p: str) -> Optional[dict]:
    if p not in VALID_PLATFORMS:
        return R.error(
            code=StatusCode.PARAM_ERROR,
            msg=f"非法平台: {p}, 允许: {sorted(VALID_PLATFORMS)}",
        )
    return None


# ==== List / summary ====

@router.get("")
def list_cookies(
    platform: Optional[str] = Query(None),
    include_invalid: bool = Query(True, description="是否包含已标记失效的"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: Optional[str] = Query(None),
    cohort: Optional[str] = Query(None, description="按 cohort 过滤"),
    _: User = Depends(get_current_admin),
):
    if platform and platform not in VALID_PLATFORMS:
        return R.error(code=StatusCode.PARAM_ERROR, msg="非法平台")
    items, total = platform_cookie_dao.list_filter(
        platform=platform,
        include_invalid=include_invalid,
        page=page, page_size=page_size,
        keyword=keyword,
        cohort=cohort,
    )
    return R.success({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/summary")
def summary(_: User = Depends(get_current_admin)):
    return R.success(platform_cookie_dao.summary_by_platform())


@router.get("/{cookie_id}")
def get_cookie(
    cookie_id: int,
    _: User = Depends(get_current_admin),
):
    row = platform_cookie_dao.get_by_id(cookie_id)
    if not row:
        return R.error(msg="Cookie 不存在")
    return R.success(row)


# ==== Create / Update / Delete ====

@router.post("", status_code=http_status.HTTP_201_CREATED)
def create_cookie(
    body: CreateCookieRequest,
    current_admin: User = Depends(get_current_admin),
):
    err = _validate_platform(body.platform)
    if err:
        return err
    try:
        row = platform_cookie_dao.create_cookie(
            platform=body.platform,
            name=body.name,
            cookie=body.cookie,
            weight=body.weight,
            remark=body.remark,
            configured_by=current_admin.id,
            cohort=body.cohort or "default",
            reserved_for_tier=body.reserved_for_tier or [],
            max_concurrent_uses=body.max_concurrent_uses or 0,
        )
    except Exception as e:
        return R.error(msg=f"新增失败: {e}")
    CookiePoolManager.instance().reload()
    return R.success(row)


@router.post("/import")
def import_cookies(
    body: ImportRequest,
    current_admin: User = Depends(get_current_admin),
):
    err = _validate_platform(body.platform)
    if err:
        return err
    try:
        inserted = platform_cookie_dao.bulk_create(
            platform=body.platform,
            items=[i.model_dump() for i in body.items],
            configured_by=current_admin.id,
        )
    except Exception as e:
        return R.error(msg=f"导入失败: {e}")
    CookiePoolManager.instance().reload()
    return R.success({
        "requested": len(body.items),
        "inserted": inserted,
    })


@router.patch("/{cookie_id}")
def update_cookie(
    cookie_id: int,
    body: UpdateCookieRequest,
    _: User = Depends(get_current_admin),
):
    data = body.model_dump(exclude_unset=True)
    row = platform_cookie_dao.update_cookie(cookie_id=cookie_id, **data)
    if not row:
        return R.error(msg="Cookie 不存在")
    CookiePoolManager.instance().reload()
    return R.success(row)


@router.post("/{cookie_id}/reset")
def reset_cookie(
    cookie_id: int,
    _: User = Depends(get_current_admin),
):
    ok = platform_cookie_dao.reset_state(cookie_id)
    if not ok:
        return R.error(msg="Cookie 不存在")
    CookiePoolManager.instance().reload()
    return R.success({"reset": True})


@router.delete("/{cookie_id}")
def delete_cookie(
    cookie_id: int,
    _: User = Depends(get_current_admin),
):
    ok = platform_cookie_dao.delete_cookie(cookie_id)
    if not ok:
        return R.error(msg="Cookie 不存在")
    CookiePoolManager.instance().reload()
    return R.success({"deleted": True})


@router.post("/reload")
def reload_pool(_: User = Depends(get_current_admin)):
    """显式通知 CookiePoolManager 立即重载缓存 (管理员改完之后立即生效)."""
    CookiePoolManager.instance().reload()
    return R.success({"reloaded": True})
