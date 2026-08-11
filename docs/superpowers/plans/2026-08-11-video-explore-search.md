# 视频探索搜索功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页 EmptyState 上增加"探索"tab，用户输入关键词一次搜索 B站 + YouTube，卡片式展示 ~40 条结果，点击卡片走现有 `handleQuickGenerate` 流程或"更多设置"预填 NoteForm 弹窗。

**Architecture:** 后端新增 `services/video_search/` 目录隔离搜索逻辑（B站走 `api.bilibili.com/x/web-interface/search/type` 公开接口 + `httpx`；YouTube 走 `yt_dlp ytsearch20:`），`aggregator.py` 用 `asyncio.gather(return_exceptions=True)` 并行调度、交错合并、单平台故障容错。前端 EmptyState 改造成"链接 / 探索"双 tab，`ExplorePanel` 组件不持有生成状态，通过回调复用 EmptyState 已有的 `handleQuickGenerate` 和 `onMoreSettings`。

**Tech Stack:** 后端 FastAPI + Python 3.11 + `httpx.AsyncClient` + `yt_dlp` + `pytest`；前端 React 19 + TypeScript + Tailwind + shadcn/ui + `axios` + `react-hot-toast`。

## Global Constraints

- 后端所有响应走 `app.utils.response.ResponseWrapper`（`R.success(data=...)` / `R.error(code=..., msg=...)`）
- 后端日志走 `app.utils.logger.get_logger(__name__)`
- 后端路由必须在 `backend/app/__init__.py` 里注册到 `/api` 前缀
- 每平台条数硬上限 20；关键词 trim 后长度必须在 [1, 50]
- 单平台失败时 aggregator 返回该平台的空列表 + `platform_status[platform] = "failed"`，绝不抛异常给 router
- `SearchResult` dataclass 字段严格按 spec 第 4.2 节，不外泄 raw yt-dlp / B站响应结构
- 前端引用文件路径统一用 `@/` 别名（`vite.config.ts` 已配置）
- 前端 toast 用 `react-hot-toast`
- Spec 参考：`docs/superpowers/specs/2026-08-11-video-explore-search-design.md`

---

## File Structure

**Create:**
- `backend/app/services/video_search/__init__.py` — 导出 `search_all`
- `backend/app/services/video_search/base.py` — `SearchResult` dataclass + `PlatformStatus` 类型别名
- `backend/app/services/video_search/bilibili_searcher.py` — 调 B站公开搜索接口
- `backend/app/services/video_search/youtube_searcher.py` — 调 `yt_dlp ytsearch20:`
- `backend/app/services/video_search/aggregator.py` — `search_all` 并行调度 + 交错合并
- `backend/app/routers/video_search.py` — `GET /api/video_search`
- `backend/tests/test_video_search.py` — 后端所有测试
- `NoteFlow_frontend/src/services/videoSearch.ts` — 前端 API client
- `NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/index.tsx` — 搜索面板
- `NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/ResultCard.tsx` — 单卡片

**Modify:**
- `backend/app/__init__.py` — 注册 `video_search.router`
- `NoteFlow_frontend/src/pages/HomePage/components/EmptyState.tsx` — 顶部加"链接 / 探索"tab 切换，把现有输入区块包进"链接"tab

---

## Task 1: Backend SearchResult dataclass + duration helper

**Files:**
- Create: `backend/app/services/video_search/__init__.py`
- Create: `backend/app/services/video_search/base.py`
- Test: `backend/tests/test_video_search.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SearchResult` dataclass with fields `platform, video_url, title, cover_url, author, duration, publish_time, play_count`
  - `PlatformStatus = Literal["ok", "failed"]`
  - `bilibili_duration_to_seconds(s: str) -> int` — `"10:45"` → 645，`"1:02:03"` → 3723，无效字符串 → 0

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_video_search.py
from app.services.video_search.base import SearchResult, bilibili_duration_to_seconds


def test_search_result_can_be_constructed():
    r = SearchResult(
        platform="bilibili",
        video_url="https://www.bilibili.com/video/BV1xx",
        title="标题",
        cover_url="https://i2.hdslb.com/x.jpg",
        author="up",
        duration=645,
        publish_time="2024-03-12",
        play_count=100,
    )
    assert r.platform == "bilibili"
    assert r.duration == 645


def test_bilibili_duration_mmss():
    assert bilibili_duration_to_seconds("10:45") == 645


def test_bilibili_duration_hmmss():
    assert bilibili_duration_to_seconds("1:02:03") == 3723


def test_bilibili_duration_seconds_only():
    assert bilibili_duration_to_seconds("42") == 42


def test_bilibili_duration_invalid_returns_zero():
    assert bilibili_duration_to_seconds("abc") == 0
    assert bilibili_duration_to_seconds("") == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.services.video_search'`

- [ ] **Step 3: Create the module**

```python
# backend/app/services/video_search/__init__.py
# 空文件占位，Task 5 会导出 search_all
```

```python
# backend/app/services/video_search/base.py
from dataclasses import dataclass
from typing import Literal, Optional

PlatformStatus = Literal["ok", "failed"]
Platform = Literal["bilibili", "youtube"]


@dataclass
class SearchResult:
    platform: Platform
    video_url: str
    title: str
    cover_url: Optional[str]
    author: Optional[str]
    duration: Optional[int]
    publish_time: Optional[str]
    play_count: Optional[int]


def bilibili_duration_to_seconds(s: str) -> int:
    """B站搜索 API 返回的 duration 字符串（如 "10:45" / "1:02:03"）转秒。无效返回 0。"""
    if not s or not isinstance(s, str):
        return 0
    parts = s.split(":")
    try:
        parts_int = [int(p) for p in parts]
    except ValueError:
        return 0
    if len(parts_int) == 1:
        return parts_int[0]
    if len(parts_int) == 2:
        return parts_int[0] * 60 + parts_int[1]
    if len(parts_int) == 3:
        return parts_int[0] * 3600 + parts_int[1] * 60 + parts_int[2]
    return 0
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_search/__init__.py backend/app/services/video_search/base.py backend/tests/test_video_search.py
git commit -m "feat(video-search): add SearchResult dataclass and duration helper"
```

---

## Task 2: Bilibili searcher

**Files:**
- Create: `backend/app/services/video_search/bilibili_searcher.py`
- Test: extend `backend/tests/test_video_search.py`

**Interfaces:**
- Consumes: `SearchResult` and `bilibili_duration_to_seconds` from Task 1
- Produces: `async def bilibili_search(keyword: str, limit: int) -> list[SearchResult]` — 调 B站公开搜索接口。返回 empty list 如果 keyword 空。任何异常（超时/-412/网络）**必须冒泡**给 aggregator，由 aggregator 转成 failed 状态

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_video_search.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

from app.services.video_search.bilibili_searcher import bilibili_search


BILI_SAMPLE = {
    "code": 0,
    "data": {
        "result": [
            {
                "type": "video",
                "bvid": "BV1AB",
                "arcurl": "https://www.bilibili.com/video/BV1AB",
                "pic": "//i2.hdslb.com/xxx.jpg",
                "title": "瑞克<em class=\"keyword\">和莫蒂</em>",
                "author": "光年字幕组",
                "duration": "10:45",
                "pubdate": 1710230400,
                "play": 123456,
            },
            {
                "type": "live_room",  # should be filtered out
                "bvid": "",
                "title": "直播",
            },
            {
                "type": "video",
                "bvid": "BV2CD",
                "arcurl": "https://www.bilibili.com/video/BV2CD",
                "pic": "https://i0.hdslb.com/y.jpg",
                "title": "普通标题",
                "author": "up2",
                "duration": "1:02:03",
                "pubdate": 1712000000,
                "play": 500,
            },
        ]
    },
}


@pytest.mark.asyncio
async def test_bilibili_search_parses_response():
    mock_response = AsyncMock()
    mock_response.json = lambda: BILI_SAMPLE
    mock_response.raise_for_status = lambda: None

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client:
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)

        results = await bilibili_search("瑞克", 20)

    assert len(results) == 2
    assert results[0].platform == "bilibili"
    assert results[0].video_url == "https://www.bilibili.com/video/BV1AB"
    assert results[0].title == "瑞克和莫蒂"  # em tags stripped
    assert results[0].cover_url == "//i2.hdslb.com/xxx.jpg"
    assert results[0].duration == 645
    assert results[0].publish_time == "2024-03-12"
    assert results[0].play_count == 123456
    assert results[1].duration == 3723


@pytest.mark.asyncio
async def test_bilibili_search_empty_keyword_returns_empty():
    results = await bilibili_search("", 20)
    assert results == []
    results = await bilibili_search("   ", 20)
    assert results == []


@pytest.mark.asyncio
async def test_bilibili_search_no_result_returns_empty():
    empty_sample = {"code": 0, "data": {"result": []}}
    mock_response = AsyncMock()
    mock_response.json = lambda: empty_sample
    mock_response.raise_for_status = lambda: None

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client:
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)
        results = await bilibili_search("nothing", 20)
    assert results == []


@pytest.mark.asyncio
async def test_bilibili_search_data_missing_returns_empty():
    """B站返回 code != 0 或 data 缺失时（例如 -412 风控），返回空列表而不抛异常"""
    bad_sample = {"code": -412, "message": "请求被拦截", "data": None}
    mock_response = AsyncMock()
    mock_response.json = lambda: bad_sample
    mock_response.raise_for_status = lambda: None

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client:
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)
        results = await bilibili_search("kw", 20)
    assert results == []
```

**Note:** `pytest-asyncio` should already be installed via `pytest` extras; if `pytest.mark.asyncio` errors, add `pytest-asyncio` to `backend/requirements.txt` — check first with `pip show pytest-asyncio`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: 4 new tests FAIL with `ModuleNotFoundError: bilibili_searcher`

- [ ] **Step 3: Implement bilibili_searcher.py**

```python
# backend/app/services/video_search/bilibili_searcher.py
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: all tests PASS. If `pytest.mark.asyncio` errors, run `pip install pytest-asyncio` and add to `requirements.txt`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_search/bilibili_searcher.py backend/tests/test_video_search.py
# if requirements.txt modified:
git add backend/requirements.txt
git commit -m "feat(video-search): add bilibili searcher via public search API"
```

---

## Task 3: YouTube searcher

**Files:**
- Create: `backend/app/services/video_search/youtube_searcher.py`
- Test: extend `backend/tests/test_video_search.py`

**Interfaces:**
- Consumes: `SearchResult` from Task 1
- Produces: `async def youtube_search(keyword: str, limit: int) -> list[SearchResult]` — 用 `run_in_executor` 包裹同步的 `yt_dlp.YoutubeDL(...).extract_info("ytsearch{n}:{kw}", download=False)`。任何异常必须冒泡

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_video_search.py`:

```python
from app.services.video_search.youtube_searcher import youtube_search


YT_SAMPLE = {
    "entries": [
        {
            "id": "abc123",
            "title": "YouTube 视频 A",
            "url": "abc123",
            "thumbnails": [
                {"url": "https://i.ytimg.com/vi/abc123/default.jpg"},
                {"url": "https://i.ytimg.com/vi/abc123/hqdefault.jpg"},
            ],
            "uploader": "Channel A",
            "duration": 300,
            "view_count": 5000,
        },
        {
            "id": "def456",
            "title": "YouTube 视频 B",
            "thumbnails": [],
            "channel": "Channel B",
            "duration": None,
            "view_count": None,
        },
    ]
}


@pytest.mark.asyncio
async def test_youtube_search_parses_flat_result():
    with patch("app.services.video_search.youtube_searcher.yt_dlp.YoutubeDL") as mock_ydl_cls:
        instance = mock_ydl_cls.return_value.__enter__.return_value
        instance.extract_info = lambda query, download=False: YT_SAMPLE
        results = await youtube_search("test", 20)

    assert len(results) == 2
    assert results[0].platform == "youtube"
    assert results[0].video_url == "https://www.youtube.com/watch?v=abc123"
    assert results[0].title == "YouTube 视频 A"
    assert results[0].cover_url == "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
    assert results[0].author == "Channel A"
    assert results[0].duration == 300
    assert results[0].play_count == 5000
    assert results[0].publish_time is None

    # Fallback: no thumbnails -> use hqdefault URL from id
    assert results[1].cover_url == "https://i.ytimg.com/vi/def456/hqdefault.jpg"
    assert results[1].author == "Channel B"
    assert results[1].duration is None
    assert results[1].play_count is None


@pytest.mark.asyncio
async def test_youtube_search_empty_keyword_returns_empty():
    results = await youtube_search("", 20)
    assert results == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: 2 new tests FAIL with import error

- [ ] **Step 3: Implement youtube_searcher.py**

```python
# backend/app/services/video_search/youtube_searcher.py
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_search/youtube_searcher.py backend/tests/test_video_search.py
git commit -m "feat(video-search): add youtube searcher via yt_dlp ytsearch"
```

---

## Task 4: Aggregator with interleave + fault tolerance

**Files:**
- Create: `backend/app/services/video_search/aggregator.py`
- Modify: `backend/app/services/video_search/__init__.py`
- Test: extend `backend/tests/test_video_search.py`

**Interfaces:**
- Consumes: `bilibili_search`, `youtube_search`, `SearchResult`, `PlatformStatus`
- Produces:
  - `async def search_all(keyword: str, per_platform: int = 20) -> tuple[list[SearchResult], dict[str, PlatformStatus]]` — 并行调两个 searcher，返回 (交错去重后的结果, {"bilibili": "ok"|"failed", "youtube": "ok"|"failed"})
  - `def interleave(lists: list[list[SearchResult]]) -> list[SearchResult]` — 内部使用，公开以便测试

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_video_search.py`:

```python
from app.services.video_search.aggregator import search_all, interleave


def _mk(platform: str, i: int) -> SearchResult:
    return SearchResult(
        platform=platform,
        video_url=f"https://ex/{platform}/{i}",
        title=f"{platform}-{i}",
        cover_url=None, author=None, duration=None, publish_time=None, play_count=None,
    )


def test_interleave_two_platforms():
    b = [_mk("bilibili", i) for i in range(3)]
    y = [_mk("youtube", i) for i in range(3)]
    merged = interleave([b, y])
    assert [r.title for r in merged] == [
        "bilibili-0", "youtube-0",
        "bilibili-1", "youtube-1",
        "bilibili-2", "youtube-2",
    ]


def test_interleave_unequal_lengths():
    b = [_mk("bilibili", i) for i in range(1)]
    y = [_mk("youtube", i) for i in range(3)]
    merged = interleave([b, y])
    assert [r.title for r in merged] == ["bilibili-0", "youtube-0", "youtube-1", "youtube-2"]


def test_interleave_dedupes_by_url():
    dup = _mk("bilibili", 0)
    b = [dup, _mk("bilibili", 1)]
    y = [dup]  # same URL appears in both
    merged = interleave([b, y])
    urls = [r.video_url for r in merged]
    assert len(urls) == len(set(urls))


@pytest.mark.asyncio
async def test_search_all_both_ok():
    async def fake_bili(kw, lim):
        return [_mk("bilibili", 0), _mk("bilibili", 1)]

    async def fake_yt(kw, lim):
        return [_mk("youtube", 0), _mk("youtube", 1)]

    with patch("app.services.video_search.aggregator.bilibili_search", side_effect=fake_bili), \
         patch("app.services.video_search.aggregator.youtube_search", side_effect=fake_yt):
        items, status = await search_all("kw", 20)

    assert len(items) == 4
    assert status == {"bilibili": "ok", "youtube": "ok"}


@pytest.mark.asyncio
async def test_search_all_bilibili_fails():
    async def fake_bili(kw, lim):
        raise RuntimeError("boom")

    async def fake_yt(kw, lim):
        return [_mk("youtube", 0)]

    with patch("app.services.video_search.aggregator.bilibili_search", side_effect=fake_bili), \
         patch("app.services.video_search.aggregator.youtube_search", side_effect=fake_yt):
        items, status = await search_all("kw", 20)

    assert [r.platform for r in items] == ["youtube"]
    assert status == {"bilibili": "failed", "youtube": "ok"}


@pytest.mark.asyncio
async def test_search_all_both_fail():
    async def boom(kw, lim):
        raise RuntimeError("x")

    with patch("app.services.video_search.aggregator.bilibili_search", side_effect=boom), \
         patch("app.services.video_search.aggregator.youtube_search", side_effect=boom):
        items, status = await search_all("kw", 20)

    assert items == []
    assert status == {"bilibili": "failed", "youtube": "failed"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: 6 new tests FAIL with import error

- [ ] **Step 3: Implement aggregator.py**

```python
# backend/app/services/video_search/aggregator.py
import asyncio
from typing import Iterable

from app.utils.logger import get_logger
from .base import PlatformStatus, SearchResult
from .bilibili_searcher import bilibili_search
from .youtube_searcher import youtube_search

logger = get_logger(__name__)


def interleave(lists: list[list[SearchResult]]) -> list[SearchResult]:
    """Round-robin merge across lists, deduping by video_url. Preserves per-list order."""
    seen: set[str] = set()
    merged: list[SearchResult] = []
    if not lists:
        return merged
    max_len = max((len(l) for l in lists), default=0)
    for i in range(max_len):
        for l in lists:
            if i >= len(l):
                continue
            item = l[i]
            if item.video_url in seen:
                continue
            seen.add(item.video_url)
            merged.append(item)
    return merged


async def search_all(
    keyword: str, per_platform: int = 20
) -> tuple[list[SearchResult], dict[str, PlatformStatus]]:
    """Fan out to per-platform searchers, tolerate individual failures."""
    platforms = ("bilibili", "youtube")
    coros = (
        bilibili_search(keyword, per_platform),
        youtube_search(keyword, per_platform),
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
```

Update `__init__.py`:

```python
# backend/app/services/video_search/__init__.py
from .aggregator import search_all
from .base import PlatformStatus, SearchResult

__all__ = ["search_all", "SearchResult", "PlatformStatus"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_search/aggregator.py backend/app/services/video_search/__init__.py backend/tests/test_video_search.py
git commit -m "feat(video-search): add aggregator with interleave and fault tolerance"
```

---

## Task 5: HTTP router `/api/video_search`

**Files:**
- Create: `backend/app/routers/video_search.py`
- Modify: `backend/app/__init__.py` (register router)
- Test: extend `backend/tests/test_video_search.py`

**Interfaces:**
- Consumes: `search_all` from Task 4
- Produces: `GET /api/video_search?q=<keyword>&limit=<n>` → JSON per spec 4.1

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_video_search.py`:

```python
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    # Lazy import so DB init doesn't happen unless test runs
    from main import app  # backend/main.py exposes `app`
    return TestClient(app)


def test_router_rejects_empty_q(client):
    resp = client.get("/api/video_search?q=")
    assert resp.status_code == 400


def test_router_rejects_too_long_q(client):
    resp = client.get("/api/video_search?q=" + "a" * 51)
    assert resp.status_code == 400


def test_router_happy_path(client):
    async def fake_search(kw, per):
        return (
            [_mk("bilibili", 0), _mk("youtube", 0)],
            {"bilibili": "ok", "youtube": "ok"},
        )

    with patch("app.routers.video_search.search_all", side_effect=fake_search):
        resp = client.get("/api/video_search?q=rick")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["keyword"] == "rick"
    assert body["data"]["total"] == 2
    assert len(body["data"]["items"]) == 2
    assert body["data"]["platform_status"] == {"bilibili": "ok", "youtube": "ok"}


def test_router_clamps_limit(client):
    calls = {}

    async def fake_search(kw, per):
        calls["per"] = per
        return ([], {"bilibili": "ok", "youtube": "ok"})

    with patch("app.routers.video_search.search_all", side_effect=fake_search):
        client.get("/api/video_search?q=x&limit=999")
    assert calls["per"] == 20

    with patch("app.routers.video_search.search_all", side_effect=fake_search):
        client.get("/api/video_search?q=x&limit=0")
    assert calls["per"] == 1
```

**Note:** If `TestClient(app)` triggers heavy startup (DB init, ffmpeg check), and it's a problem, use `fastapi.testclient.TestClient` against a `FastAPI` app built directly with only `video_search.router` mounted. Try the simple import first; only refactor if startup fails.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: 4 new tests FAIL

- [ ] **Step 3: Implement router**

```python
# backend/app/routers/video_search.py
from dataclasses import asdict
from fastapi import APIRouter, HTTPException, Query

from app.services.video_search import search_all
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


@router.get("/video_search")
async def video_search(
    q: str = Query(..., description="搜索关键词"),
    limit: int = Query(20, description="每平台条数上限"),
):
    keyword = (q or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    if len(keyword) > 50:
        raise HTTPException(status_code=400, detail="搜索关键词过长（最多 50 字符）")

    per_platform = max(1, min(int(limit or 20), 20))

    items, platform_status = await search_all(keyword, per_platform)
    payload = {
        "keyword": keyword,
        "total": len(items),
        "items": [asdict(i) for i in items],
        "platform_status": platform_status,
    }
    return R.success(data=payload)
```

- [ ] **Step 4: Register router in `backend/app/__init__.py`**

Add to the imports (append `video_search` at the end of the multi-import line):
```python
from .routers import note, provider, model, config, chat, auth, note_style, profile, export_note, share, feedback, billing, billing_notify, admin, admin_cookies, admin_notifications, admin_pricing, platform, update_logs, admin_update_logs, note_collection, flashcard, knowledge_base, assistant, cloud_drive, video_search
```

And add before `return app`:
```python
    app.include_router(video_search.router, prefix="/api")
```

- [ ] **Step 5: Run tests to verify PASS**

```bash
cd backend && pytest tests/test_video_search.py -v
```
Expected: all tests PASS

- [ ] **Step 6: Manual smoke test the endpoint**

Start backend in one shell:
```bash
cd backend && python main.py
```

In another shell:
```bash
curl -s "http://127.0.0.1:8483/api/video_search?q=%E7%91%9E%E5%85%8B" | head -c 500
```
Expected: JSON with `code=0`, `data.items` non-empty (assuming both platforms reachable), `platform_status` has both keys.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/video_search.py backend/app/__init__.py backend/tests/test_video_search.py
git commit -m "feat(video-search): expose /api/video_search endpoint"
```

---

## Task 6: Frontend API client

**Files:**
- Create: `NoteFlow_frontend/src/services/videoSearch.ts`

**Interfaces:**
- Consumes: existing axios wrapper at `@/utils/request` (returns unwrapped `data` on success; check `note.ts` for the pattern)
- Produces:
  - Type: `VideoSearchItem { platform, video_url, title, cover_url, author, duration, publish_time, play_count }`
  - Type: `VideoSearchResponse { keyword, total, items, platform_status }`
  - `searchVideos(keyword: string, signal?: AbortSignal): Promise<VideoSearchResponse>` — abortable to cancel outdated requests

- [ ] **Step 1: Peek existing request wrapper contract**

Read `NoteFlow_frontend/src/utils/request.ts` and one existing service (e.g. `services/note.ts` at [NoteFlow_frontend/src/services/note.ts](NoteFlow_frontend/src/services/note.ts)) to confirm:
- Whether `request.get()` returns the raw axios response, or already-unwrapped `data.data`
- Whether error toasts happen at interceptor level (so we don't double-toast in ExplorePanel)

- [ ] **Step 2: Implement client**

```ts
// NoteFlow_frontend/src/services/videoSearch.ts
import request from '@/utils/request'

export interface VideoSearchItem {
  platform: 'bilibili' | 'youtube'
  video_url: string
  title: string
  cover_url: string | null
  author: string | null
  duration: number | null
  publish_time: string | null
  play_count: number | null
}

export interface VideoSearchResponse {
  keyword: string
  total: number
  items: VideoSearchItem[]
  platform_status: {
    bilibili: 'ok' | 'failed'
    youtube: 'ok' | 'failed'
  }
}

export async function searchVideos(
  keyword: string,
  signal?: AbortSignal,
): Promise<VideoSearchResponse> {
  const response = await request.get('/video_search', {
    params: { q: keyword, limit: 20 },
    signal,
  })
  // If the interceptor already unwraps `data.data`, the returned value IS the payload;
  // otherwise adapt this line. Check step 1's findings.
  return (response as any)?.data ?? (response as any)
}
```

**Adapt the return statement** based on what step 1 showed. If `request.get()` returns axios response with body under `.data.data` (nested wrapper), do `return response.data.data`.

- [ ] **Step 3: Type-check**

```bash
cd NoteFlow_frontend && pnpm build
```
Expected: build succeeds (or `tsc --noEmit` if you want a quick check)

- [ ] **Step 4: Commit**

```bash
git add NoteFlow_frontend/src/services/videoSearch.ts
git commit -m "feat(video-search): add frontend videoSearch API client"
```

---

## Task 7: ResultCard component

**Files:**
- Create: `NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/ResultCard.tsx`

**Interfaces:**
- Consumes:
  - `VideoSearchItem` from Task 6
  - `proxiedCover` helper (defined inline in `EmptyState.tsx`; **reproduce inline** in ResultCard — cover proxy is a 2-line helper, extracting it to a shared util is out of scope)
- Produces:
  - Props: `{ item: VideoSearchItem, onSelect: (item) => void, onMoreSettings: (item) => void }`
  - Card layout: cover thumbnail + platform badge + duration overlay + title (2-line clamp) + author line; click card = `onSelect`; top-right icon button = `onMoreSettings` (stops propagation)

- [ ] **Step 1: Implement ResultCard.tsx**

```tsx
// NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/ResultCard.tsx
import { FC } from 'react'
import { Clock, SlidersHorizontal } from 'lucide-react'

import { BiliBiliLogo, YoutubeLogo } from '@/components/Icons/platform.tsx'
import { VideoSearchItem } from '@/services/videoSearch.ts'

const apiBase = String(import.meta.env.VITE_API_BASE_URL || 'api').replace(/\/$/, '')
const proxiedCover = (url?: string | null) =>
  url ? `${apiBase}/image_proxy?url=${encodeURIComponent(url)}` : ''

const formatDuration = (sec?: number | null): string => {
  if (!sec || sec <= 0) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

const platformLabel: Record<VideoSearchItem['platform'], string> = {
  bilibili: 'B站',
  youtube: 'YouTube',
}
const platformLogo: Record<VideoSearchItem['platform'], FC> = {
  bilibili: BiliBiliLogo,
  youtube: YoutubeLogo,
}

interface ResultCardProps {
  item: VideoSearchItem
  onSelect: (item: VideoSearchItem) => void
  onMoreSettings: (item: VideoSearchItem) => void
}

const ResultCard: FC<ResultCardProps> = ({ item, onSelect, onMoreSettings }) => {
  const PlatformLogo = platformLogo[item.platform]
  const duration = formatDuration(item.duration)

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:border-[#167a6e]/40 hover:shadow-md"
    >
      {/* Cover with platform badge + duration */}
      <div className="relative aspect-video w-full bg-neutral-100">
        {item.cover_url && (
          <img
            src={proxiedCover(item.cover_url)}
            alt={item.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          <span className="inline-block h-3 w-3 [&_svg]:h-full [&_svg]:w-full">
            <PlatformLogo />
          </span>
          {platformLabel[item.platform]}
        </span>
        {duration && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}
        {/* More settings button — top-right */}
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onMoreSettings(item)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onMoreSettings(item)
            }
          }}
          className="absolute right-2 top-2 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white/90 text-neutral-700 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
          title="更多设置"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <p
          className="line-clamp-2 text-sm font-medium text-neutral-800"
          title={item.title}
        >
          {item.title || '未命名视频'}
        </p>
        {item.author && (
          <p className="truncate text-xs text-neutral-500">{item.author}</p>
        )}
      </div>
    </button>
  )
}

export default ResultCard
```

**Note:** Placing an interactive element inside a `<button>` is invalid HTML. That's why the "更多设置" trigger uses `<span role="button">` + `stopPropagation`, which mirrors the pattern used elsewhere in this codebase (check `NoteHistory.tsx`).

- [ ] **Step 2: Type-check**

```bash
cd NoteFlow_frontend && pnpm build
```
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/ResultCard.tsx
git commit -m "feat(video-search): add ResultCard component"
```

---

## Task 8: ExplorePanel — search input, results grid, states

**Files:**
- Create: `NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/index.tsx`

**Interfaces:**
- Consumes: `searchVideos`, `VideoSearchItem` from Task 6; `ResultCard` from Task 7; `react-hot-toast`
- Produces:
  - Props: `{ onQuickGenerate: (prefill: { video_url: string; platform: string }) => void, onMoreSettings: (prefill: { video_url: string; platform: string }) => void }`
  - Behavior: search box + "搜索" button + "清除" button; on submit calls `searchVideos`; debounces manual submits via `AbortController`; shows loading skeleton (6 blank cards), empty state, and "XX 搜索暂不可用" toast when a platform_status is `"failed"`

- [ ] **Step 1: Implement index.tsx**

```tsx
// NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/index.tsx
import { FC, useCallback, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { searchVideos, VideoSearchItem, VideoSearchResponse } from '@/services/videoSearch.ts'
import ResultCard from './ResultCard'

interface ExplorePanelProps {
  onQuickGenerate: (prefill: { video_url: string; platform: string }) => void
  onMoreSettings: (prefill: { video_url: string; platform: string }) => void
}

const platformDisplay: Record<string, string> = {
  bilibili: 'B站',
  youtube: 'YouTube',
}

const ExplorePanel: FC<ExplorePanelProps> = ({ onQuickGenerate, onMoreSettings }) => {
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<VideoSearchItem[]>([])
  const [searched, setSearched] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const runSearch = useCallback(async () => {
    const kw = keyword.trim()
    if (!kw) {
      toast.error('请输入搜索关键词')
      return
    }
    if (kw.length > 50) {
      toast.error('关键词过长（最多 50 字符）')
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setSearched(true)
    try {
      const resp: VideoSearchResponse = await searchVideos(kw, ctrl.signal)
      if (ctrl.signal.aborted) return
      setItems(resp.items || [])
      // Warn if any platform failed
      const failed = Object.entries(resp.platform_status || {})
        .filter(([, s]) => s === 'failed')
        .map(([p]) => platformDisplay[p] || p)
      if (failed.length && (resp.items?.length ?? 0) > 0) {
        toast.error(`${failed.join('、')} 搜索暂不可用，已显示其他结果`)
      }
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.name === 'AbortError') return
      // request.ts interceptor typically shows a toast; avoid double-toast here
      setItems([])
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [keyword])

  const handleClear = () => {
    abortRef.current?.abort()
    setKeyword('')
    setItems([])
    setSearched(false)
    setLoading(false)
  }

  return (
    <div className="w-full">
      {/* Search box */}
      <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg shadow-[#167a6e]/10">
        <div className="flex flex-1 items-center gap-2 px-3">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !loading) runSearch()
            }}
            placeholder="输入关键词，一键搜索 B站 + YouTube 视频"
            className="h-10 flex-1 border-none bg-transparent shadow-none focus-visible:ring-0"
            maxLength={50}
          />
        </div>
        <Button
          type="button"
          onClick={runSearch}
          disabled={loading || !keyword.trim()}
          className="min-w-[80px]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          disabled={!keyword && !searched}
        >
          清除
        </Button>
      </div>

      {/* Results area */}
      <div className="mt-6">
        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white"
              >
                <div className="aspect-video w-full animate-pulse bg-neutral-100" />
                <div className="space-y-2 px-3 py-2.5">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && searched && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-neutral-500">
            <p>未找到与「{keyword}」相关的视频</p>
            <p className="mt-1 text-xs text-neutral-400">试试其他关键词，或稍后重试</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <p className="mb-3 text-sm text-neutral-500">
              找到 {items.length} 个与「{keyword}」相关的视频
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map(item => (
                <ResultCard
                  key={item.video_url}
                  item={item}
                  onSelect={i => onQuickGenerate({ video_url: i.video_url, platform: i.platform })}
                  onMoreSettings={i =>
                    onMoreSettings({ video_url: i.video_url, platform: i.platform })
                  }
                />
              ))}
            </div>
          </>
        )}

        {!loading && !searched && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-neutral-400">
            <p>输入关键词，一键聚合 B站 与 YouTube 视频</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ExplorePanel
```

- [ ] **Step 2: Type-check**

```bash
cd NoteFlow_frontend && pnpm build
```
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add NoteFlow_frontend/src/pages/HomePage/components/ExplorePanel/index.tsx
git commit -m "feat(video-search): add ExplorePanel with search + results grid"
```

---

## Task 9: EmptyState — link / explore tab switch

**Files:**
- Modify: `NoteFlow_frontend/src/pages/HomePage/components/EmptyState.tsx`

**Interfaces:**
- Consumes: `ExplorePanel` from Task 8; existing `handleQuickGenerate` and `onMoreSettings` in EmptyState
- Produces:
  - New local state `activeTab: 'link' | 'explore'`
  - Tab strip above the existing input area
  - When `activeTab === 'explore'`, render `<ExplorePanel />`; when `link`, render the existing input area unchanged

- [ ] **Step 1: Wire the tab strip and refactor**

Open [NoteFlow_frontend/src/pages/HomePage/components/EmptyState.tsx](NoteFlow_frontend/src/pages/HomePage/components/EmptyState.tsx). Find the section that starts with `{/* 输入区 */}` around line 231 and:

1. Add import at the top: `import ExplorePanel from './ExplorePanel'`
2. Add local state near other `useState`s (around line 103): `const [activeTab, setActiveTab] = useState<'link' | 'explore'>('link')`
3. Extract the URL-quick-generate action into a helper that accepts a prefill and reuses the existing generate flow. **Refactor plan** (do not rewrite `handleQuickGenerate` — extract a private `submitForPrefill`):

```tsx
// Replace the top of handleQuickGenerate with a wrapper that reads videoUrl+platform,
// then extract the body into submitForPrefill:
const submitForPrefill = async (prefill: { video_url: string; platform: string }) => {
  const url = prefill.video_url.trim()
  if (!url) {
    toast.error('请先选择视频')
    return
  }
  try {
    new URL(url)
  } catch {
    toast.error('视频链接无效')
    return
  }
  if (modelList.length === 0) {
    toast.error('请先添加 AI 模型')
    navigate('/settings/model')
    return
  }
  const model = modelList[0]
  const payload = {
    video_url: url,
    platform: prefill.platform,
    quality: 'medium' as const,
    model_name: model.model_name,
    provider_id: model.provider_id,
    format: ['toc', 'link', 'summary'],
    style: 'minimal',
    video_understanding: false,
    video_interval: 6,
    grid_size: [2, 2] as [number, number],
    task_id: '',
    free_generate: true,
  }
  setSubmitting(true)
  try {
    // ...move the existing addPendingTask / generateNote / navigate body here
    // (copy verbatim from current handleQuickGenerate)
  } finally {
    setSubmitting(false)
  }
}

const handleQuickGenerate = () => submitForPrefill({ video_url: videoUrl, platform })
```

The rest of `handleQuickGenerate` (starting with `setSubmitting(true)` through the finally block) should be moved into `submitForPrefill`. Do this carefully — a diff-based edit is safest.

- [ ] **Step 2: Add the tab strip and conditional render**

Where the input card is currently rendered (search for `{/* 输入区 */}`), wrap:

```tsx
{/* Tab strip */}
<div className="w-full max-w-4xl">
  <div className="mb-4 flex justify-center gap-1 border-b border-neutral-200">
    <button
      type="button"
      onClick={() => setActiveTab('link')}
      className={cn(
        'px-4 pb-2 text-sm font-medium transition-colors',
        activeTab === 'link'
          ? 'border-primary text-primary -mb-px border-b-2'
          : 'text-neutral-500 hover:text-neutral-700'
      )}
    >
      链接
    </button>
    <button
      type="button"
      onClick={() => setActiveTab('explore')}
      className={cn(
        'px-4 pb-2 text-sm font-medium transition-colors',
        activeTab === 'explore'
          ? 'border-primary text-primary -mb-px border-b-2'
          : 'text-neutral-500 hover:text-neutral-700'
      )}
    >
      探索
    </button>
  </div>

  {activeTab === 'link' ? (
    <div className="w-full max-w-2xl mx-auto">
      {/* existing input card + preview + supported platforms — leave unchanged */}
      ...
    </div>
  ) : (
    <ExplorePanel
      onQuickGenerate={submitForPrefill}
      onMoreSettings={prefill => onMoreSettings(prefill)}
    />
  )}
</div>
```

**Import `cn`** if not already: `import { cn } from '@/lib/utils'` (check existing imports; the codebase already uses `cn` in NoteForm).

- [ ] **Step 3: Type-check + dev server smoke test**

```bash
cd NoteFlow_frontend && pnpm build
```
Then:
```bash
pnpm dev
```
Open [http://localhost:3015](http://localhost:3015). Verify:
- "链接 | 探索" tab visible, "链接" active by default
- "链接" tab still functions (paste a URL → preview → quick generate)
- "探索" tab shows search box + "输入关键词" prompt

- [ ] **Step 4: Commit**

```bash
git add NoteFlow_frontend/src/pages/HomePage/components/EmptyState.tsx
git commit -m "feat(video-search): add link/explore tab switch on homepage"
```

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start backend + frontend**

```bash
# terminal 1
cd backend && python main.py

# terminal 2
cd NoteFlow_frontend && pnpm dev
```

- [ ] **Step 2: Run through the human verification checklist from spec §7.2**

Walk through each item in [docs/superpowers/specs/2026-08-11-video-explore-search-design.md](docs/superpowers/specs/2026-08-11-video-explore-search-design.md#72-前端人工验证清单):

- [ ] EmptyState 顶部出现 "链接 | 探索" tab, 默认停留在"链接"
- [ ] 切到"探索"tab, 输入"瑞克", 看到 ~40 个卡片
- [ ] 每个卡片显示: 封面、标题、平台角标 (B站/YouTube)、时长、作者
- [ ] 点击卡片主体, 进入笔记生成流程 (跟 EmptyState 粘贴 URL 后点"快速生成"完全一致)
- [ ] 点击卡片右上"更多设置"按钮, NoteForm 弹窗打开, video_url 和 platform 已预填
- [ ] 断网重试, 页面不崩溃
- [ ] 搜索 "aksldfjaklsdjf" 这种无结果关键词, 看到空态提示
- [ ] (可选) 本地临时把 bilibili_searcher.py 里的 API URL 改错模拟风控, 验证只显示 YouTube 结果 + toast 提示

- [ ] **Step 3: If everything passes, tag the milestone**

```bash
git log --oneline -12  # sanity check the feature commits are contiguous
```

No tag needed — just leave a clean commit history. Verification done.

---

## Self-Review

- Spec §2 In-scope items are covered by Tasks 1-9. Out-of-scope items are not attempted.
- Spec §3.1 backend structure → Tasks 1-5. Spec §3.2 frontend structure → Tasks 6-9.
- Spec §4.1 HTTP contract → Task 5 (including `platform_status` field).
- Spec §4.2 SearchResult dataclass → Task 1.
- Spec §5.1 aggregator → Task 4. §5.2 bilibili → Task 2. §5.3 youtube → Task 3. §5.4 frontend flow → Task 8.
- Spec §6 error handling → distributed: Task 2/3 fail-fast, Task 4 catches exceptions and sets platform_status, Task 5 validates query, Task 8 shows toast on partial failure.
- Spec §7.1 backend tests → covered across Tasks 1-5. §7.2 human verification → Task 10.
- Spec §8 no new deps: confirmed (httpx + yt_dlp already in requirements; note in Task 2 flags pytest-asyncio if missing).
- Spec §9 rollback = hide tab: possible by reverting Task 9's commit alone.

Types are consistent:
- `SearchResult` defined once in Task 1, used verbatim in Tasks 2/3/4/5.
- `PlatformStatus = Literal["ok", "failed"]` defined once, used in Task 4/5.
- `search_all(keyword, per_platform)` signature stable Task 4 → Task 5.
- Frontend `VideoSearchItem` / `VideoSearchResponse` defined in Task 6, consumed in Tasks 7/8.
- Prefill callback shape `{ video_url, platform }` consistent across ExplorePanel (Task 8) and EmptyState (Task 9).

No placeholders. All code blocks are complete and runnable.
