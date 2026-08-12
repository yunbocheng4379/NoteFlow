import re
import uuid
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from app.utils.logger import get_logger
from .base import SearchResult, bilibili_duration_to_seconds

logger = get_logger(__name__)

_BILI_ENDPOINT = "https://api.bilibili.com/x/web-interface/search/type"
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


class BilibiliRiskControlError(Exception):
    """B站 aba 风控命中——返回 HTML 而非 JSON。aggregator 会将该平台标为 failed。"""
    pass


def _get_bilibili_cookie() -> Optional[str]:
    """从项目已有的 cookie 池 / 文件里读一条 bilibili cookie；池空返回 None。

    与 bilibili_downloader 使用同一套 CookieConfigManager，避免重复维护。
    """
    try:
        from app.services.cookie_manager import CookieConfigManager
        return CookieConfigManager().get("bilibili")
    except Exception as e:
        logger.warning(f"bilibili_search: cookie pool read failed: {e!r}")
        return None


def _extract_cookie_value(cookie_str: str, key: str) -> Optional[str]:
    """从 'k1=v1; k2=v2' 里取指定 key 的 value。"""
    if not cookie_str:
        return None
    for pair in cookie_str.split(";"):
        pair = pair.strip()
        if pair.startswith(f"{key}="):
            return pair.split("=", 1)[1]
    return None


def _anonymous_cookie() -> str:
    """无 cookie 池配置时，伪造一个 buvid3+b_nut。绕过部分 aba 风控的兜底手段——
    不保证成功，但比彻底裸奔好。"""
    buvid3 = f"{str(uuid.uuid4()).upper()}infoc"
    b_nut = int(time.time())
    return f"buvid3={buvid3}; b_nut={b_nut}"


def _build_headers() -> dict:
    """组装请求头 + Cookie。优先用池里的真实 cookie；池空则伪造一个。"""
    headers = dict(_BASE_HEADERS)
    cookie = _get_bilibili_cookie() or _anonymous_cookie()
    headers["Cookie"] = cookie
    buvid3 = _extract_cookie_value(cookie, "buvid3")
    if buvid3:
        # B 站 API 除了 Cookie 还看 buvid3 header（downloader 里也这么做）
        headers["buvid3"] = buvid3
    return headers


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
        cover_url=entry.get("pic") or None,
        author=entry.get("author") or None,
        duration=bilibili_duration_to_seconds(entry.get("duration", "")),
        publish_time=_pubdate_to_iso(entry.get("pubdate")),
        play_count=entry.get("play") if isinstance(entry.get("play"), int) else None,
    )


async def bilibili_search(keyword: str, limit: int) -> list[SearchResult]:
    if not keyword or not keyword.strip():
        return []
    limit = max(1, min(int(limit or 20), 20))

    params = {
        "search_type": "video",
        "keyword": keyword.strip(),
        "page": 1,
        "pagesize": limit,
    }

    headers = _build_headers()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(_BILI_ENDPOINT, params=params, headers=headers)
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").lower()
        # 风控页返回 HTTP 200 + text/html — 不能盲目 resp.json() 会抛 JSONDecodeError
        # 抛异常让 aggregator 把该平台标为 failed（前端会显示"B站搜索暂不可用"）
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
