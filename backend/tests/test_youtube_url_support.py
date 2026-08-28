from app.utils import url_parser
from app.utils.url_parser import extract_video_id, get_task_video_id
from app.validators.video_url_validator import is_supported_video_url


SHORTS_URL = "https://www.youtube.com/shorts/GTvrwYp0IGc"


def test_youtube_shorts_url_is_supported():
    assert is_supported_video_url(SHORTS_URL)


def test_extract_video_id_supports_youtube_shorts():
    assert extract_video_id(SHORTS_URL, "youtube") == "GTvrwYp0IGc"


def test_extract_video_id_supports_kuaishou_video_url():
    url = "https://www.kuaishou.com/short-video/3x6u642nk5hja6q"

    assert extract_video_id(url, "kuaishou") == "3x6u642nk5hja6q"


def test_get_task_video_id_is_stable_when_platform_url_has_no_embedded_id():
    url = "https://v.kuaishou.com/share-token"

    first = get_task_video_id(url, "kuaishou")
    second = get_task_video_id(url, "kuaishou")

    assert first == second
    assert first.startswith("kuaishou_")


def test_original_video_url_can_be_rebuilt_for_legacy_platform_records():
    resolver = getattr(url_parser, "get_original_video_url", None)

    assert resolver is not None
    assert resolver("", "douyin", "7666716416389047507") == (
        "https://www.douyin.com/video/7666716416389047507"
    )
    assert resolver("", "kuaishou", "3xsuu8kd954r9ki") == (
        "https://www.kuaishou.com/short-video/3xsuu8kd954r9ki"
    )
    assert resolver("", "kuaishou", "kuaishou_7f4c2a") == ""
