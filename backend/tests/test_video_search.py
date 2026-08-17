import pytest
from unittest.mock import AsyncMock, patch

from app.services.video_search.base import SearchResult, bilibili_duration_to_seconds
from app.services.video_search.bilibili_searcher import bilibili_search


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


def _seed_mixin_key_cache():
    """Pre-populate mixin_key cache so tests skip the nav fetch."""
    from app.services.video_search import bilibili_searcher as bs
    import time as _t
    bs._MIXIN_KEY_CACHE["key"] = "test_mixin_key_32chars_padding__"
    bs._MIXIN_KEY_CACHE["ts"] = _t.time()


@pytest.mark.asyncio
async def test_bilibili_search_parses_response():
    _seed_mixin_key_cache()
    mock_response = AsyncMock()
    mock_response.headers = {"content-type": "application/json"}
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
    assert results[0].cover_url == "https://i2.hdslb.com/xxx.jpg"  # // upgraded to https:// by _normalize_pic
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
    _seed_mixin_key_cache()
    empty_sample = {"code": 0, "data": {"result": []}}
    mock_response = AsyncMock()
    mock_response.headers = {"content-type": "application/json"}
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
    _seed_mixin_key_cache()
    bad_sample = {"code": -412, "message": "请求被拦截", "data": None}
    mock_response = AsyncMock()
    mock_response.headers = {"content-type": "application/json"}
    mock_response.json = lambda: bad_sample
    mock_response.raise_for_status = lambda: None

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client:
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)
        results = await bilibili_search("kw", 20)
    assert results == []


@pytest.mark.asyncio
async def test_bilibili_search_html_body_raises_risk_control():
    """B站 aba 风控页返回 HTTP 200 + text/html body，不能崩溃 (JSONDecodeError)。
    应抛 BilibiliRiskControlError，让 aggregator 把该平台标为 failed，前端能显示"暂不可用"。"""
    from app.services.video_search.bilibili_searcher import BilibiliRiskControlError
    _seed_mixin_key_cache()

    mock_response = AsyncMock()
    mock_response.headers = {"content-type": "text/html; charset=utf-8"}
    mock_response.raise_for_status = lambda: None

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client:
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)
        with pytest.raises(BilibiliRiskControlError):
            await bilibili_search("kw", 20)


@pytest.mark.asyncio
async def test_bilibili_search_wbi_flow_and_cookies():
    """当 cookie 池里有 bilibili cookie 时：
    - AsyncClient 用 Cookie + buvid3 header 初始化
    - 先调 /x/web-interface/nav 拿 img_key/sub_key
    - 再调 /x/web-interface/wbi/search/type 带 wts + w_rid
    """
    from app.services.video_search import bilibili_searcher as bs

    nav_response = AsyncMock()
    nav_response.headers = {"content-type": "application/json"}
    nav_response.json = lambda: {"data": {"wbi_img": {
        "img_url": "https://i0.hdslb.com/bfs/wbi/abc1234567890abcdef.png",
        "sub_url": "https://i0.hdslb.com/bfs/wbi/def4560987654321fedc.png",
    }}}
    nav_response.raise_for_status = lambda: None

    search_response = AsyncMock()
    search_response.headers = {"content-type": "application/json"}
    search_response.json = lambda: {"code": 0, "data": {"result": []}}
    search_response.raise_for_status = lambda: None

    captured = {"client_kwargs": None, "calls": []}

    async def _fake_get(url, params=None):
        captured["calls"].append({"url": url, "params": params})
        if "nav" in url:
            return nav_response
        return search_response

    # Clear the mixin_key cache so this test forces a nav fetch
    bs._MIXIN_KEY_CACHE.clear()

    with patch("app.services.video_search.bilibili_searcher.httpx.AsyncClient") as mock_client, \
         patch.object(bs, "_get_bilibili_cookie", return_value="buvid3=FAKE123; b_nut=1700000000; SESSDATA=xx"):
        def _capture_client(*args, **kwargs):
            captured["client_kwargs"] = kwargs
            return mock_client.return_value
        mock_client.side_effect = _capture_client
        instance = mock_client.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=_fake_get)
        await bilibili_search("kw", 20)

    # Client-level headers should include Cookie + buvid3
    client_headers = captured["client_kwargs"]["headers"]
    assert "buvid3=FAKE123" in client_headers["Cookie"]
    assert client_headers.get("buvid3") == "FAKE123"

    # First call should hit nav (to fetch mixin_key), then search
    urls = [c["url"] for c in captured["calls"]]
    assert any("nav" in u for u in urls)
    search_call = next(c for c in captured["calls"] if "search/type" in c["url"])
    assert "wbi" in search_call["url"]
    assert "wts" in search_call["params"]
    assert "w_rid" in search_call["params"]


def test_wbi_get_mixin_key_deterministic():
    """WBI mixin_key 是 img_key+sub_key 按固定 64 位表打乱后取前 32 位。"""
    from app.services.video_search.bilibili_searcher import _get_mixin_key
    # Known-good vector: paste img_key + sub_key of length 64
    orig = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!!"
    result = _get_mixin_key(orig)
    assert len(result) == 32
    assert isinstance(result, str)


def test_wbi_sign_produces_wts_and_w_rid():
    """给定固定 params + mixin_key，签名应该稳定可复现。"""
    from app.services.video_search.bilibili_searcher import _sign_wbi
    params = {"keyword": "test", "page": 1}
    signed = _sign_wbi(params, mixin_key="dummy_mixin_key_32_chars_padding!", now=1700000000)
    assert signed["wts"] == 1700000000
    assert "w_rid" in signed
    assert len(signed["w_rid"]) == 32  # md5 hex
    # Determinism: same inputs → same output
    signed2 = _sign_wbi(params, mixin_key="dummy_mixin_key_32_chars_padding!", now=1700000000)
    assert signed["w_rid"] == signed2["w_rid"]
    # Different mixin_key → different signature
    signed3 = _sign_wbi(params, mixin_key="other_mixin_key_32_chars_padding_", now=1700000000)
    assert signed["w_rid"] != signed3["w_rid"]


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


from app.services.video_search.aggregator import search_all, interleave


def _mk(platform: str, i: int) -> SearchResult:
    return SearchResult(
        platform=platform,
        video_url=f"https://ex/{platform}/{i}",
        title=f"{platform}-{i}",
        cover_url=None, author=None, duration=None,
        publish_time=None, play_count=None,
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
    assert [r.title for r in merged] == [
        "bilibili-0", "youtube-0", "youtube-1", "youtube-2",
    ]


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

    with patch("app.services.video_search.aggregator.bilibili_search",
               side_effect=fake_bili), \
         patch("app.services.video_search.aggregator.youtube_search",
               side_effect=fake_yt):
        items, status = await search_all("kw", 20)

    assert len(items) == 4
    assert status == {"bilibili": "ok", "youtube": "ok"}


@pytest.mark.asyncio
async def test_search_all_bilibili_fails():
    async def fake_bili(kw, lim):
        raise RuntimeError("boom")

    async def fake_yt(kw, lim):
        return [_mk("youtube", 0)]

    with patch("app.services.video_search.aggregator.bilibili_search",
               side_effect=fake_bili), \
         patch("app.services.video_search.aggregator.youtube_search",
               side_effect=fake_yt):
        items, status = await search_all("kw", 20)

    assert [r.platform for r in items] == ["youtube"]
    assert status == {"bilibili": "failed", "youtube": "ok"}


@pytest.mark.asyncio
async def test_search_all_both_fail():
    async def boom(kw, lim):
        raise RuntimeError("x")

    with patch("app.services.video_search.aggregator.bilibili_search",
               side_effect=boom), \
         patch("app.services.video_search.aggregator.youtube_search",
               side_effect=boom):
        items, status = await search_all("kw", 20)

    assert items == []
    assert status == {"bilibili": "failed", "youtube": "failed"}


# ---------------------------------------------------------------------------
# HTTP router tests (Task 5)
# ---------------------------------------------------------------------------
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
