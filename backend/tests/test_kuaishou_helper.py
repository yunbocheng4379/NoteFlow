import pytest

from app.downloaders.kuaishou_downloader import KuaiShouDownloader
from app.downloaders.kuaishou_helper.kuaishou import KuaiShou, kuaishou_duration_to_seconds


def test_kuaishou_duration_is_converted_from_milliseconds():
    assert kuaishou_duration_to_seconds(14683) == 15


def test_kuaishou_skip_download_returns_duration_in_seconds(monkeypatch, tmp_path):
    monkeypatch.setattr(
        KuaiShou,
        "run",
        lambda _self, _url: {
            "visionVideoDetail": {
                "photo": {
                    "id": "3x6u642nk5hja6q",
                    "caption": "短视频",
                    "duration": 14683,
                    "coverUrl": "https://example.com/cover.jpg",
                }
            }
        },
    )

    result = KuaiShouDownloader().download(
        "https://www.kuaishou.com/short-video/3x6u642nk5hja6q",
        output_dir=str(tmp_path),
        skip_download=True,
    )

    assert result.duration == 15


def test_extract_photo_id_supports_standard_and_share_urls():
    assert KuaiShou._extract_photo_id_from_url(
        "https://www.kuaishou.com/short-video/3xvzf4jsvsv46ty"
    ) == "3xvzf4jsvsv46ty"
    assert KuaiShou._extract_photo_id_from_url(
        "https://www.kuaishou.com/short-video/ignored?photoId=3xvzf4jsvsv46ty"
    ) == "3xvzf4jsvsv46ty"


def test_get_photo_id_raises_readable_error_when_redirect_has_no_photo_id(monkeypatch):
    class Response:
        url = "https://www.kuaishou.com/f/share-token"
        text = "<html>risk control</html>"

    monkeypatch.setattr(
        "app.downloaders.kuaishou_helper.kuaishou.requests.get",
        lambda *args, **kwargs: Response(),
    )

    with pytest.raises(ValueError, match="无法从快手链接解析视频 ID"):
        KuaiShou().get_photo_id("https://v.kuaishou.com/share-token")


def test_run_rejects_input_without_a_kuaishou_url():
    with pytest.raises(ValueError, match="无法从输入中识别快手视频链接"):
        KuaiShou().run("这不是一个视频地址")
