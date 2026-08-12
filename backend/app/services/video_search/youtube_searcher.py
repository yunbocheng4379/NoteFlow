import asyncio
from typing import Any

import yt_dlp

from app.utils.logger import get_logger
from .base import SearchResult

logger = get_logger(__name__)

_OPTS = {
    "quiet": True,
    "skip_download": True,
    "extract_flat": True,
    "default_search": "ytsearch",
    "noplaylist": True,
}


def _pick_thumbnail(entry: dict) -> str | None:
    thumbs = entry.get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        last = thumbs[-1]
        if isinstance(last, dict) and last.get("url"):
            return last["url"]
    vid = entry.get("id")
    if vid:
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    return None


def _map_entry(entry: dict) -> SearchResult | None:
    vid = entry.get("id")
    if not vid:
        return None
    return SearchResult(
        platform="youtube",
        video_url=f"https://www.youtube.com/watch?v={vid}",
        title=entry.get("title") or "",
        cover_url=_pick_thumbnail(entry),
        author=entry.get("uploader") or entry.get("channel") or None,
        duration=int(entry["duration"]) if isinstance(entry.get("duration"), (int, float)) else None,
        publish_time=None,  # flat 模式拿不到
        play_count=int(entry["view_count"]) if isinstance(entry.get("view_count"), (int, float)) else None,
    )


def _sync_extract(keyword: str, limit: int) -> dict[str, Any]:
    with yt_dlp.YoutubeDL(_OPTS) as ydl:
        return ydl.extract_info(f"ytsearch{limit}:{keyword}", download=False) or {}


async def youtube_search(keyword: str, limit: int) -> list[SearchResult]:
    if not keyword or not keyword.strip():
        return []
    limit = max(1, min(int(limit or 20), 20))

    loop = asyncio.get_running_loop()
    info = await loop.run_in_executor(None, _sync_extract, keyword.strip(), limit)

    entries = info.get("entries") or []
    results: list[SearchResult] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        mapped = _map_entry(entry)
        if mapped is not None:
            results.append(mapped)
        if len(results) >= limit:
            break
    return results
