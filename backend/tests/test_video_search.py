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
