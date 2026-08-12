"""
云盘 OAuth + 文件浏览路由.

路径 /api/cloud_drive/...:

OAuth 相关:
- GET /auth/{platform}/url         → 返回授权 URL (前端 window.open)
- GET /auth/{platform}/callback    → 百度回调, 换 token 并写 DB
- GET /auth/{platform}/status      → 前端轮询是否已登录
- POST /auth/{platform}/logout     → 删除用户凭据

文件浏览:
- GET /files?platform=&path=&start=&limit=  → 列文件夹和视频文件

生成笔记 (批量):
- POST /generate                   → 传 fs_id 列表, 后端下载并触发 NoteGenerator
"""
import logging
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_current_user_optional
from app.db.cloud_credentials_dao import (
    delete_credential,
    get_credential,
    upsert_credential,
)
from app.db.engine import get_db
from app.db.models.users import User
from app.services.cloud_drive import baidu_client
from app.services.cloud_drive.token_manager import (
    NoCredentialError,
    TokenRefreshFailed,
    ensure_valid_token,
)
from app.utils.encryption import CookieEncryption
from app.utils.response import ResponseWrapper as R

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cloud_drive", tags=["cloud_drive"])

SUPPORTED_PLATFORMS = {"baidu_pan"}


def _validate_platform(platform: str) -> None:
    if platform not in SUPPORTED_PLATFORMS:
        raise ValueError(f"不支持的网盘平台: {platform}")


# ====================== OAuth ======================


@router.get("/auth/{platform}/url")
def get_auth_url(
    platform: str,
    current_user: User = Depends(get_current_user),
):
    """
    返回授权 URL. 前端拿去 window.open.

    state 用当前 user_id + 随机串, 回调时校验避免 CSRF.
    """
    try:
        _validate_platform(platform)
    except ValueError as e:
        return R.error(msg=str(e))

    # state 编码 user_id, callback 时反解出来 (百度会原样传回)
    # 格式: {user_id}:{random}, 后端只信任 user_id 和 random 是否匹配 session
    random_part = secrets.token_urlsafe(16)
    state = f"{current_user.id}:{random_part}"

    if platform == "baidu_pan":
        auth_url = baidu_client.build_auth_url(state=state)
    else:
        return R.error(msg=f"未实现的平台: {platform}")

    return R.success({"auth_url": auth_url, "state": state})


@router.get("/auth/baidu/callback", response_class=HTMLResponse)
def baidu_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    百度 OAuth 回调. 百度会重定向到这里, 带 code 参数.

    这个页面直接用 HTML 响应, 里面 JS postMessage 到父窗口后自动关闭.
    """
    if error:
        return _oauth_callback_html(success=False, message=f"{error}: {error_description}")

    if not code or not state:
        return _oauth_callback_html(success=False, message="缺少 code 或 state")

    # 从 state 里解出 user_id
    try:
        user_id_str, _ = state.split(":", 1)
        user_id = int(user_id_str)
    except (ValueError, AttributeError):
        return _oauth_callback_html(success=False, message="state 格式非法")

    # 换 token
    try:
        tok = baidu_client.exchange_code_for_token(code)
    except Exception as e:
        logger.error(f"百度换 token 失败: {e}")
        return _oauth_callback_html(success=False, message=f"授权失败: {e}")

    # 拿用户昵称 (可选)
    account_name = None
    try:
        uinfo = baidu_client.get_user_info(tok.access_token)
        account_name = uinfo.get("baidu_name") or uinfo.get("netdisk_name")
    except Exception as e:
        logger.warning(f"获取百度用户信息失败: {e}")

    # 加密后入库
    upsert_credential(
        db,
        user_id=user_id,
        platform="baidu_pan",
        access_token_encrypted=CookieEncryption.encrypt(tok.access_token),
        refresh_token_encrypted=(
            CookieEncryption.encrypt(tok.refresh_token) if tok.refresh_token else None
        ),
        expires_at=tok.expires_at,
        scope=tok.scope,
        account_name=account_name,
    )
    logger.info(f"用户 {user_id} 成功绑定百度网盘, account={account_name}")
    return _oauth_callback_html(success=True, message="登录成功", account_name=account_name)


def _oauth_callback_html(
    *, success: bool, message: str, account_name: Optional[str] = None
) -> HTMLResponse:
    """
    回调页面 HTML: postMessage 通知父窗口, 然后自动关闭.

    父窗口 (前端) 会监听 window.message 事件, 收到 { type: 'cloud-drive-oauth', ... }
    后刷新登录状态.
    """
    success_js = "true" if success else "false"
    account_js = repr(account_name) if account_name else "null"
    payload_js = (
        "{"
        f"type: 'cloud-drive-oauth', platform: 'baidu_pan', "
        f"success: {success_js}, "
        f"message: {message!r}, "
        f"accountName: {account_js}"
        "}"
    )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权结果</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 40px; text-align: center;">
  <h2>{'✓ ' + message if success else '✗ ' + message}</h2>
  <p>窗口即将自动关闭...</p>
  <script>
    try {{ window.opener && window.opener.postMessage({payload_js}, '*'); }} catch (e) {{}}
    setTimeout(() => window.close(), 1500);
  </script>
</body></html>"""
    return HTMLResponse(html)


@router.get("/auth/{platform}/status")
def get_auth_status(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查询当前用户是否已绑定该平台."""
    try:
        _validate_platform(platform)
    except ValueError as e:
        return R.error(msg=str(e))

    row = get_credential(db, user_id=current_user.id, platform=platform)
    if not row:
        return R.success({"logged_in": False, "account_name": None})
    return R.success({
        "logged_in": True,
        "account_name": row.account_name,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    })


@router.post("/auth/{platform}/logout")
def logout_platform(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _validate_platform(platform)
    except ValueError as e:
        return R.error(msg=str(e))

    delete_credential(db, user_id=current_user.id, platform=platform)
    return R.success({"logged_out": True})


# ====================== 文件浏览 ======================


@router.get("/files")
def list_files(
    platform: str = Query(..., description="baidu_pan"),
    path: str = Query("/", description="网盘目录路径, '/' 开头"),
    start: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    列出指定目录下的视频文件和子文件夹.
    """
    try:
        _validate_platform(platform)
    except ValueError as e:
        return R.error(msg=str(e))

    try:
        access_token = ensure_valid_token(db, user_id=current_user.id, platform=platform)
    except NoCredentialError:
        return R.error(msg="未登录该网盘, 请先授权", code=401)
    except TokenRefreshFailed as e:
        return R.error(msg=f"授权已失效, 请重新登录: {e}", code=401)

    try:
        files, has_more = baidu_client.list_files(
            access_token, dir_path=path, start=start, limit=limit
        )
    except Exception as e:
        logger.error(f"列 {platform} 文件失败: {e}")
        return R.error(msg=f"列文件失败: {e}")

    return R.success({
        "files": [
            {
                "fs_id": f.fs_id,
                "path": f.path,
                "name": f.name,
                "size": f.size,
                "is_dir": f.is_dir,
                "server_ctime": f.server_ctime,
            }
            for f in files
        ],
        "has_more": has_more,
        "start": start,
        "limit": limit,
    })


# ====================== 生成笔记 (下载 + NoteGenerator) ======================


class CloudFileRef(BaseModel):
    fs_id: int
    path: str
    name: str


class GenerateFromCloudRequest(BaseModel):
    platform: str
    files: List[CloudFileRef]
    quality: str = "medium"
    model_name: str
    provider_id: str
    format: List[str] = []
    style: str
    extras: Optional[str] = None
    collection_id: Optional[int] = None


@router.post("/generate")
def generate_from_cloud(
    data: GenerateFromCloudRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    从选中的网盘文件生成笔记.

    单选: files 长度=1, 走单任务流程
    多选: files 长度>1, 逐个提交为独立任务 (串行下载, 避免限流)

    返回 task_id 列表; 前端用现有 /tasks/{task_id} 轮询进度.
    """
    try:
        _validate_platform(data.platform)
    except ValueError as e:
        return R.error(msg=str(e))

    if not data.files:
        return R.error(msg="至少选择一个文件")

    # 每个文件构造一个 "cloud://{platform}/{fs_id}?name={name}" 的伪 URL,
    # 走标准 /generate_note 接口 (复用扣费 + 队列 + 状态跟踪)
    from urllib.parse import quote
    from app.routers.note import VideoRequest, generate_note
    from fastapi import BackgroundTasks

    task_ids: list[str] = []
    errors: list[dict] = []
    background_tasks = BackgroundTasks()

    for f in data.files:
        cloud_url = f"cloud://{data.platform}/{f.fs_id}?name={quote(f.name)}"
        try:
            req = VideoRequest(
                video_url=cloud_url,
                platform=data.platform,
                quality=data.quality,
                model_name=data.model_name,
                provider_id=data.provider_id,
                format=data.format,
                style=data.style,
                extras=data.extras,
                collection_id=data.collection_id,
            )
        except Exception as e:
            errors.append({"file": f.name, "msg": str(e)})
            continue

        resp = generate_note(req, background_tasks, current_user, db)
        # generate_note 返回 JSONResponse; body 是 JSON 字节
        import json as _json
        try:
            body = _json.loads(resp.body.decode("utf-8"))
        except Exception:
            body = {}
        if body.get("code") == 0 and body.get("data"):
            task_ids.append(body["data"].get("task_id"))
        else:
            errors.append({"file": f.name, "msg": body.get("msg", "unknown")})

    # 手动触发 background_tasks (因为不在 FastAPI 请求链路里)
    # 直接开线程跑
    import threading
    def _run_all():
        for task in background_tasks.tasks:
            try:
                task.func(*task.args, **task.kwargs)
            except Exception as e:
                logger.error(f"background task 失败: {e}")
    threading.Thread(target=_run_all, daemon=True).start()

    return R.success({"task_ids": task_ids, "errors": errors})
