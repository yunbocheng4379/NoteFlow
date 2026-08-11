import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.utils.logger import get_logger
from .base import SearchResult, bilibili_duration_to_seconds

logger = get_logger(__name__)

_BILI_ENDPOINT = "https://api.bilibili.com/x/web-interface/search/type"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com",
}
_EM_TAG_RE = re.compile(r"<[^>]+>")


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

    async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
        resp = await client.get(_BILI_ENDPOINT, params=params)
        resp.raise_for_status()
        payload = resp.json()

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
