from app.utils.url_parser import extract_video_id
from app.validators.video_url_validator import is_supported_video_url


SHORTS_URL = "https://www.youtube.com/shorts/GTvrwYp0IGc"


def test_youtube_shorts_url_is_supported():
    assert is_supported_video_url(SHORTS_URL)


def test_extract_video_id_supports_youtube_shorts():
    assert extract_video_id(SHORTS_URL, "youtube") == "GTvrwYp0IGc"
