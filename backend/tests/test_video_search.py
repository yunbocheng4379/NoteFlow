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
