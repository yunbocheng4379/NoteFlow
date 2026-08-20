import asyncio

from app.utils.logger import get_logger
from .base import PlatformStatus, SearchResult
from .bilibili_searcher import bilibili_search
from .youtube_searcher import youtube_search

logger = get_logger(__name__)

# 外部平台搜索不可控，单个平台不能阻塞整个聚合接口。
PLATFORM_TIMEOUT_SEC = 8.0


def interleave(lists: list[list[SearchResult]]) -> list[SearchResult]:
    """Round-robin merge across lists, deduping by video_url. Preserves per-list order."""
    seen: set[str] = set()
    merged: list[SearchResult] = []
    if not lists:
        return merged
    max_len = max((len(lst) for lst in lists), default=0)
    for i in range(max_len):
        for lst in lists:
            if i >= len(lst):
                continue
            item = lst[i]
            if item.video_url in seen:
                continue
            seen.add(item.video_url)
            merged.append(item)
    return merged


async def search_all(
    keyword: str, per_platform: int = 20
) -> tuple[list[SearchResult], dict[str, PlatformStatus]]:
    """Fan out to per-platform searchers, tolerate individual failures."""

    async def _search_with_timeout(searcher, platform: str):
        try:
            return await asyncio.wait_for(
                searcher(keyword, per_platform), timeout=PLATFORM_TIMEOUT_SEC
            )
        except asyncio.TimeoutError:
            logger.warning(
                "video_search platform '%s' timed out after %.1fs",
                platform,
                PLATFORM_TIMEOUT_SEC,
            )
            raise

    platforms = ("bilibili", "youtube")
    coros = (
        _search_with_timeout(bilibili_search, "bilibili"),
        _search_with_timeout(youtube_search, "youtube"),
    )
    settled = await asyncio.gather(*coros, return_exceptions=True)

    status: dict[str, PlatformStatus] = {}
    lists: list[list[SearchResult]] = []
    for name, result in zip(platforms, settled):
        if isinstance(result, Exception):
            logger.warning(f"video_search platform '{name}' failed: {result!r}")
            status[name] = "failed"
            lists.append([])
        else:
            status[name] = "ok"
            lists.append(result)

    return interleave(lists), status
