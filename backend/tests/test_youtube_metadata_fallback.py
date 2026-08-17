from unittest.mock import Mock

import pytest


def test_youtube_skip_download_uses_oembed_metadata_when_drm_blocks_ytdlp(monkeypatch, tmp_path):
    from app.downloaders import youtube_downloader as module

    class FailingYoutubeDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            raise module.DownloadError("This video is DRM protected")

    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "title": "DRM video title",
        "thumbnail_url": "https://i.ytimg.com/vi/VmZRacAUuvE/hqdefault.jpg",
    }

    monkeypatch.setattr(module.yt_dlp, "YoutubeDL", FailingYoutubeDL)
    monkeypatch.setattr(module.requests, "get", lambda *args, **kwargs: response)

    result = module.YoutubeDownloader().download(
        "https://www.youtube.com/watch?v=VmZRacAUuvE",
        output_dir=str(tmp_path),
        skip_download=True,
    )

    assert result.video_id == "VmZRacAUuvE"
    assert result.title == "DRM video title"
    assert result.cover_url.endswith("hqdefault.jpg")
    assert result.file_path is None


def test_youtube_oembed_fallback_preserves_download_error_when_metadata_is_unavailable(
    monkeypatch, tmp_path
):
    from app.downloaders import youtube_downloader as module

    class FailingYoutubeDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            raise module.DownloadError("This video is DRM protected")

    monkeypatch.setattr(module.yt_dlp, "YoutubeDL", FailingYoutubeDL)
    monkeypatch.setattr(module.requests, "get", lambda *args, **kwargs: (_ for _ in ()).throw(
        module.requests.RequestException("network down")
    ))

    with pytest.raises(module.DownloadError, match="DRM protected"):
        module.YoutubeDownloader().download(
            "https://www.youtube.com/watch?v=VmZRacAUuvE",
            output_dir=str(tmp_path),
            skip_download=True,
        )


def test_youtube_download_retries_android_vr_when_standard_clients_have_no_formats(
    monkeypatch, tmp_path
):
    from app.downloaders import youtube_downloader as module

    attempts = []

    class FallbackYoutubeDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            clients = self.opts["extractor_args"]["youtube"]["player_client"]
            attempts.append((self.opts["format"], clients))
            if clients != ["android_vr", "web"]:
                raise module.DownloadError(
                    "Requested format is not available. Use --list-formats for a list of available formats"
                )

            audio_path = tmp_path / "L_2-UXBYoDE.m4a"
            audio_path.write_bytes(b"fake audio")
            return {
                "id": "L_2-UXBYoDE",
                "title": "BBC News 中文",
                "duration": 120,
                "thumbnail": "https://i.ytimg.com/vi/L_2-UXBYoDE/hqdefault.jpg",
                "ext": "m4a",
                "requested_downloads": [{"filepath": str(audio_path)}],
            }

    monkeypatch.setattr(module.yt_dlp, "YoutubeDL", FallbackYoutubeDL)

    result = module.YoutubeDownloader().download(
        "https://www.youtube.com/watch?v=L_2-UXBYoDE",
        output_dir=str(tmp_path),
    )

    assert result.file_path == str(tmp_path / "L_2-UXBYoDE.m4a")
    assert result.title == "BBC News 中文"
    assert ("bestaudio[ext=m4a]/bestaudio/best", ["android_vr", "web"]) in attempts


def test_youtube_download_rejects_success_metadata_without_downloaded_audio(
    monkeypatch, tmp_path
):
    from app.downloaders import youtube_downloader as module

    class MetadataOnlyYoutubeDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            return {
                "id": "L_2-UXBYoDE",
                "title": "BBC News 中文",
                "duration": 120,
                "thumbnail": "https://i.ytimg.com/vi/L_2-UXBYoDE/hqdefault.jpg",
                "ext": "m4a",
                "requested_downloads": [{"filepath": str(tmp_path / "missing.m4a")}],
            }

    monkeypatch.setattr(module.yt_dlp, "YoutubeDL", MetadataOnlyYoutubeDL)

    with pytest.raises(FileNotFoundError, match="音频文件未找到"):
        module.YoutubeDownloader().download(
            "https://www.youtube.com/watch?v=L_2-UXBYoDE",
            output_dir=str(tmp_path),
        )
