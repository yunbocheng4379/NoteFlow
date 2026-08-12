"""
百度网盘 OAuth + 文件访问客户端.

官方文档: https://pan.baidu.com/union/document/basic

流程:
1. 前端 window.open(build_auth_url()) 打开授权页
2. 用户在百度页登录并授权后, 百度重定向到 REDIRECT_URI?code=xxx
3. 后端在 callback 处调用 exchange_code_for_token(code) 换 access_token + refresh_token
4. 后续所有 API 调用带 access_token; 过期前调 refresh_access_token()
5. 列文件走 list_files(access_token, dir); 下载走 get_download_url + stream

失败模式:
- OAuth 授权码过期 (10 分钟): 用户重新登录
- access_token 过期 (通常 30 天): 用 refresh_token 换新
- refresh_token 过期 (通常 10 年, 但用户改密后立即失效): 用户重新登录
- API 限流: 百度按应用维度限流, 429 时上层退避重试
"""
import os
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

# 百度 OAuth + 网盘 API 地址
OAUTH_AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize"
OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token"
PAN_API_BASE = "https://pan.baidu.com/rest/2.0/xpan"
DOWNLOAD_HOST = "https://d.pcs.baidu.com"

# 需要的权限:
# - basic: 获取用户基本信息 (昵称等)
# - netdisk: 读写网盘文件 (列文件 + 下载都需要)
DEFAULT_SCOPE = "basic,netdisk"

# 只把视频文件展示给用户
VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv",
    ".webm", ".m4v", ".ts", ".rmvb", ".rm", ".mpg", ".mpeg",
}


@dataclass
class BaiduTokenResponse:
    """/oauth/2.0/token 的返回."""
    access_token: str
    refresh_token: Optional[str]
    expires_in: int  # 秒, 通常 30 天 = 2592000
    scope: str

    @property
    def expires_at(self) -> datetime:
        # 提前 60 秒过期, 避免临界点被拒
        return datetime.utcnow() + timedelta(seconds=self.expires_in - 60)


@dataclass
class BaiduFile:
    fs_id: int
    path: str
    name: str
    size: int
    is_dir: bool
    server_ctime: int  # unix timestamp


def _get_env(key: str) -> str:
    v = os.getenv(key)
    if not v:
        raise RuntimeError(
            f"百度网盘凭据未配置: 请在 backend/.env 里设置 {key}"
        )
    return v


def get_app_key() -> str:
    return _get_env("BAIDU_PAN_APP_KEY")


def get_secret_key() -> str:
    return _get_env("BAIDU_PAN_SECRET_KEY")


def get_redirect_uri() -> str:
    return _get_env("BAIDU_PAN_REDIRECT_URI")


def build_auth_url(state: str) -> str:
    """
    构造百度 OAuth 授权 URL, 前端用 window.open 打开.

    :param state: CSRF 防护随机串, 回调时原样返回, 后端要校验
    """
    params = {
        "response_type": "code",
        "client_id": get_app_key(),
        "redirect_uri": get_redirect_uri(),
        "scope": DEFAULT_SCOPE,
        "state": state,
        "display": "page",
    }
    return f"{OAUTH_AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code_for_token(code: str) -> BaiduTokenResponse:
    """
    OAuth callback 收到 code 后, 换 access_token.

    :raises RuntimeError: 百度返回错误 (通常是 code 过期 / redirect_uri 不匹配)
    """
    params = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": get_app_key(),
        "client_secret": get_secret_key(),
        "redirect_uri": get_redirect_uri(),
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(OAUTH_TOKEN_URL, params=params)
        data = resp.json()

    if "error" in data:
        raise RuntimeError(
            f"百度 OAuth 换 token 失败: {data.get('error')} - {data.get('error_description')}"
        )
    return BaiduTokenResponse(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token"),
        expires_in=int(data.get("expires_in", 2592000)),
        scope=data.get("scope", DEFAULT_SCOPE),
    )


def refresh_access_token(refresh_token: str) -> BaiduTokenResponse:
    """access_token 过期时用 refresh_token 换新的."""
    params = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": get_app_key(),
        "client_secret": get_secret_key(),
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(OAUTH_TOKEN_URL, params=params)
        data = resp.json()

    if "error" in data:
        raise RuntimeError(
            f"百度 refresh_token 失败: {data.get('error')} - {data.get('error_description')}"
        )
    return BaiduTokenResponse(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token", refresh_token),
        expires_in=int(data.get("expires_in", 2592000)),
        scope=data.get("scope", DEFAULT_SCOPE),
    )


def get_user_info(access_token: str) -> dict:
    """获取百度网盘用户信息, 用于展示账号昵称."""
    params = {
        "method": "uinfo",
        "access_token": access_token,
    }
    url = f"{PAN_API_BASE}/nas"
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(url, params=params)
        data = resp.json()
    if data.get("errno") != 0:
        logger.warning(f"获取百度用户信息失败: {data}")
        return {}
    return data


def list_files(
    access_token: str,
    dir_path: str = "/",
    start: int = 0,
    limit: int = 100,
) -> tuple[list[BaiduFile], bool]:
    """
    列出指定目录下的文件夹和视频文件.

    :param dir_path: 网盘目录路径, 必须 '/' 开头, 例如 '/' 或 '/Videos'
    :param start: 分页起始
    :param limit: 每页数量 (百度上限 1000, 我们默认 100 快)
    :return: (文件列表, has_more)
    """
    params = {
        "method": "list",
        "access_token": access_token,
        "dir": dir_path,
        "order": "name",
        "start": start,
        "limit": limit,
        "web": 1,
    }
    with httpx.Client(timeout=20.0) as client:
        resp = client.get(f"{PAN_API_BASE}/file", params=params)
        data = resp.json()

    if data.get("errno") != 0:
        raise RuntimeError(f"百度列文件失败 (errno={data.get('errno')}): {data}")

    items = data.get("list", [])
    files: list[BaiduFile] = []
    for item in items:
        is_dir = bool(item.get("isdir"))
        name = item.get("server_filename", "")
        # 只展示文件夹 + 视频文件
        if not is_dir:
            ext = os.path.splitext(name.lower())[1]
            if ext not in VIDEO_EXTENSIONS:
                continue
        files.append(BaiduFile(
            fs_id=int(item["fs_id"]),
            path=item.get("path", ""),
            name=name,
            size=int(item.get("size", 0)),
            is_dir=is_dir,
            server_ctime=int(item.get("server_ctime", 0)),
        ))
    # 百度的 list API 没直接返回 has_more, 用返回条数是否等于 limit 判断
    has_more = len(items) >= limit
    return files, has_more


def get_download_url(access_token: str, fs_id: int) -> tuple[str, str]:
    """
    获取文件的临时下载链接.

    先调 filemetas 拿到 dlink, 再拼 access_token 才是最终可用的下载 URL.

    :return: (下载URL, 文件名)
    """
    params = {
        "method": "filemetas",
        "access_token": access_token,
        "fsids": f"[{fs_id}]",
        "dlink": 1,
    }
    with httpx.Client(timeout=20.0) as client:
        resp = client.get(f"{PAN_API_BASE}/multimedia", params=params)
        data = resp.json()

    if data.get("errno") != 0:
        raise RuntimeError(f"百度获取下载链接失败 (errno={data.get('errno')}): {data}")

    items = data.get("list", [])
    if not items:
        raise RuntimeError(f"百度文件不存在: fs_id={fs_id}")

    item = items[0]
    dlink = item.get("dlink")
    if not dlink:
        raise RuntimeError(f"百度未返回 dlink: {item}")

    # 追加 access_token 才能真正下载
    sep = "&" if "?" in dlink else "?"
    final_url = f"{dlink}{sep}access_token={access_token}"
    filename = item.get("filename", str(fs_id))
    return final_url, filename


def download_file(download_url: str, output_path: str) -> str:
    """
    流式下载文件到本地. 必须带 User-Agent='pan.baidu.com', 否则百度会 403.

    :param download_url: get_download_url 返回的 URL
    :param output_path: 本地目标路径
    :return: output_path
    """
    headers = {"User-Agent": "pan.baidu.com"}
    # 百度大文件下载没时间上限, connect timeout 30s 就够
    timeout = httpx.Timeout(30.0, read=None)
    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", download_url) as resp:
            resp.raise_for_status()
            with open(output_path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
    return output_path
