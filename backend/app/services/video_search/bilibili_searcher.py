"""B站 视频搜索——走 wbi 签名接口 `/x/web-interface/wbi/search/type`。

B站 2023 年起对 web-interface 类接口引入 wbi 签名: 请求必须带 `wts`
(时间戳) + `w_rid` (md5 签名), 否则返回 412 或 -412 风控页. 签名密钥由
`/x/web-interface/nav` 里的 img_url / sub_url 文件名拼接 + 固定 64 位重排表
打乱后取前 32 位得到. 详见 https://github.com/SocialSisterYi/bilibili-API-collect
"""
import hashlib
import re
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from app.utils.logger import get_logger
from .base import SearchResult, bilibili_duration_to_seconds

logger = get_logger(__name__)

_NAV_ENDPOINT = "https://api.bilibili.com/x/web-interface/nav"
_SEARCH_ENDPOINT = "https://api.bilibili.com/x/web-interface/wbi/search/type"

_BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.bilibili.com",
}
_EM_TAG_RE = re.compile(r"<[^>]+>")

# WBI 密钥打乱表 (B站 web 前端逆向出来的常量, 长期稳定)
_WBI_ORDER = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

# 模块级 mixin_key 缓存. TTL 保守取 1 小时——B站 的 img/sub 密钥通常一天一换,
# 但风控敏感期可能更快. 命中缓存 → 少一次 nav 调用 (节省 200~500ms).
_MIXIN_KEY_CACHE: dict = {}
_MIXIN_KEY_TTL_SEC = 3600


class BilibiliRiskControlError(Exception):
    """B站 aba 风控命中——返回 HTML 而非 JSON。aggregator 会将该平台标为 failed。"""
    pass


def _get_bilibili_cookie() -> Optional[str]:
    try:
        from app.services.cookie_manager import CookieConfigManager
        return CookieConfigManager().get("bilibili")
    except Exception as e:
        logger.warning(f"bilibili_search: cookie pool read failed: {e!r}")
        return None


def _extract_cookie_value(cookie_str: str, key: str) -> Optional[str]:
    if not cookie_str:
        return None
    for pair in cookie_str.split(";"):
        pair = pair.strip()
        if pair.startswith(f"{key}="):
            return pair.split("=", 1)[1]
    return None


def _anonymous_cookie() -> str:
    """无 cookie 池配置时兜底: 伪造 buvid3+b_nut. 配合 nav 调用会让 B站 通过 Set-Cookie
    补齐真实的 buvid3/b_nut, httpx.AsyncClient session 会自动带上."""
    buvid3 = f"{str(uuid.uuid4()).upper()}infoc"
    b_nut = int(time.time())
    return f"buvid3={buvid3}; b_nut={b_nut}"


def _client_headers() -> dict:
    """AsyncClient 默认 headers + 初始 Cookie + buvid3 header."""
    headers = dict(_BASE_HEADERS)
    cookie = _get_bilibili_cookie() or _anonymous_cookie()
    headers["Cookie"] = cookie
    buvid3 = _extract_cookie_value(cookie, "buvid3")
    if buvid3:
        headers["buvid3"] = buvid3
    return headers


def _get_mixin_key(orig: str) -> str:
    """按 _WBI_ORDER 打乱 orig 后取前 32 位.  orig 应为 (img_key + sub_key)."""
    return "".join(orig[i] for i in _WBI_ORDER if i < len(orig))[:32]


def _sign_wbi(params: dict, mixin_key: str, now: Optional[int] = None) -> dict:
    """按 B站 wbi 规则给 params 加签. 返回新 dict, 不修改入参.
    - 加入 wts (时间戳)
    - 值过滤 !'()* 字符
    - 按 key 字典序拼接成 query 字符串
    - w_rid = md5(query + mixin_key)
    """
    signed = dict(params)
    signed["wts"] = int(now if now is not None else time.time())
    forbidden = str.maketrans("", "", "!'()*")
    sorted_items = sorted(signed.items())
    query = "&".join(
        f"{k}={urllib.parse.quote(str(v).translate(forbidden), safe='')}"
        for k, v in sorted_items
    )
    signed["w_rid"] = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return signed


async def _fetch_mixin_key(client: httpx.AsyncClient) -> str:
    """从 /x/web-interface/nav 拿 img_key/sub_key 并拼出 mixin_key. 带 TTL 缓存."""
    cached = _MIXIN_KEY_CACHE.get("key")
    ts = _MIXIN_KEY_CACHE.get("ts", 0)
    if cached and (time.time() - ts) < _MIXIN_KEY_TTL_SEC:
        return cached

    resp = await client.get(_NAV_ENDPOINT)
    resp.raise_for_status()
    payload = resp.json()
    wbi_img = (payload.get("data") or {}).get("wbi_img") or {}
    img_url = wbi_img.get("img_url") or ""
    sub_url = wbi_img.get("sub_url") or ""
    if not img_url or not sub_url:
        raise BilibiliRiskControlError(f"nav response missing wbi_img: {payload!r}")

    img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
    sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
    mixin_key = _get_mixin_key(img_key + sub_key)
    _MIXIN_KEY_CACHE["key"] = mixin_key
    _MIXIN_KEY_CACHE["ts"] = time.time()
    return mixin_key


def _strip_em(title: str) -> str:
    if not isinstance(title, str):
        return ""
    return _EM_TAG_RE.sub("", title)


def _pubdate_to_iso(ts: Any) -> str | None:
    if not isinstance(ts, (int, float)) or ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None


def _normalize_pic(pic: str | None) -> str | None:
    if not pic:
        return None
    if pic.startswith("//"):
        return "https:" + pic
    return pic


def _map_entry(entry: dict) -> SearchResult | None:
    if entry.get("type") != "video":
        return None
    arcurl = entry.get("arcurl") or ""
    bvid = entry.get("bvid") or ""
    if not arcurl and bvid:
        arcurl = f"https://www.bilibili.com/video/{bvid}"
    if not arcurl:
        return None
    return SearchResult(
        platform="bilibili",
        video_url=arcurl,
        title=_strip_em(entry.get("title", "")),
        cover_url=_normalize_pic(entry.get("pic")),
        author=entry.get("author") or None,
        duration=bilibili_duration_to_seconds(entry.get("duration", "")),
        publish_time=_pubdate_to_iso(entry.get("pubdate")),
        play_count=entry.get("play") if isinstance(entry.get("play"), int) else None,
    )


async def bilibili_search(keyword: str, limit: int) -> list[SearchResult]:
    if not keyword or not keyword.strip():
        return []
    limit = max(1, min(int(limit or 20), 20))

    headers = _client_headers()
    # 单个 AsyncClient session 复用 cookie jar: nav 响应里 Set-Cookie 补上的
    # buvid4/b_lsid 会自动带到 search 请求, 提高通过风控概率
    async with httpx.AsyncClient(timeout=10.0, headers=headers, follow_redirects=True) as client:
        mixin_key = await _fetch_mixin_key(client)

        raw_params = {
            "search_type": "video",
            "keyword": keyword.strip(),
            "page": 1,
            "page_size": limit,
        }
        signed_params = _sign_wbi(raw_params, mixin_key)

        resp = await client.get(_SEARCH_ENDPOINT, params=signed_params)
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").lower()
        if "application/json" not in content_type:
            raise BilibiliRiskControlError(
                f"bilibili search returned non-JSON (content-type={content_type!r}); "
                f"likely aba risk-control page. Consider configuring bilibili cookies in the pool."
            )
        try:
            payload = resp.json()
        except ValueError as e:
            raise BilibiliRiskControlError(f"bilibili search JSON decode failed: {e!r}")

    if not isinstance(payload, dict) or payload.get("code") != 0:
        logger.warning(f"bilibili search non-zero code: {payload!r}")
        return []

    data = payload.get("data") or {}
    entries = data.get("result") or []
    results: list[SearchResult] = []
    for entry in entries:
        mapped = _map_entry(entry) if isinstance(entry, dict) else None
        if mapped is not None:
            results.append(mapped)
        if len(results) >= limit:
            break
    return results
