import os
import logging
import tempfile
from abc import ABC
from typing import Union, Optional, List, Tuple

import requests
import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

from app.downloaders.base import Downloader, DownloadQuality
from app.downloaders.youtube_subtitle import YouTubeSubtitleFetcher
from app.models.notes_model import AudioDownloadResult
from app.models.transcriber_model import TranscriptResult
from app.services.cookie_manager import CookieConfigManager
from app.services.proxy_config_manager import ProxyConfigManager
from app.utils.path_helper import get_data_dir
from app.utils.url_parser import extract_video_id

logger = logging.getLogger(__name__)

# Fallback matrix for YouTube extraction. When the primary attempt fails with
# "Requested format is not available" (usually caused by SSAP experiment or
# nsig extraction issues), retry with alternate player clients and a looser
# format selector before giving up.
_YT_AUDIO_ATTEMPTS: Tuple[Tuple[str, List[str]], ...] = (
    ('bestaudio[ext=m4a]/bestaudio/best', ['ios', 'tv', 'mweb']),
    ('bestaudio[ext=m4a]/bestaudio/best', ['android_vr', 'web']),
    ('bestaudio/best', ['web_safari', 'android', 'ios']),
    ('best', ['mweb', 'tv_embedded']),
)

_YT_VIDEO_ATTEMPTS: Tuple[Tuple[str, List[str]], ...] = (
    ('bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]', ['ios', 'tv', 'mweb']),
    ('bestvideo+bestaudio/best', ['web_safari', 'android', 'ios']),
    ('best', ['mweb', 'tv_embedded']),
)


def _apply_proxy(ydl_opts: dict, platform: str = "youtube") -> dict:
    """根据平台获取对应代理（平台专属 > 全局 > 环境变量），注入 yt-dlp opts。"""
    proxy = ProxyConfigManager().get_proxy_url(platform)
    if proxy:
        ydl_opts['proxy'] = proxy
        logger.info(f"yt-dlp [{platform}] 走代理: {proxy}")
    return ydl_opts


def _extract_with_fallback(
    video_url: str,
    base_opts: dict,
    attempts: Tuple[Tuple[str, List[str]], ...],
    download: bool,
) -> dict:
    """按 attempts 顺序尝试 (format, player_client) 组合，直到成功或全部失败。"""
    last_exc: Optional[Exception] = None
    for idx, (fmt, clients) in enumerate(attempts, start=1):
        opts = dict(base_opts)
        opts['format'] = fmt
        opts['extractor_args'] = {'youtube': {'player_client': clients}}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                logger.info(
                    "yt-dlp attempt %d/%d format=%r clients=%s",
                    idx, len(attempts), fmt, clients,
                )
                return ydl.extract_info(video_url, download=download)
        except (DownloadError, ExtractorError) as exc:
            last_exc = exc
            logger.warning(
                "yt-dlp attempt %d/%d failed (format=%r clients=%s): %s",
                idx, len(attempts), fmt, clients, exc,
            )
    assert last_exc is not None
    raise last_exc


def _fetch_oembed_metadata(video_url: str, video_id: str) -> AudioDownloadResult:
    """获取不依赖媒体流的 YouTube 基础元信息。"""
    response = requests.get(
        "https://www.youtube.com/oembed",
        params={"url": video_url, "format": "json"},
        timeout=10,
    )
    response.raise_for_status()
    info = response.json()
    return AudioDownloadResult(
        file_path=None,
        title=info.get("title") or video_id,
        duration=0,
        cover_url=info.get("thumbnail_url"),
        platform="youtube",
        video_id=video_id,
        raw_info={"author_name": info.get("author_name")},
        video_path=None,
    )


def _resolve_downloaded_path(info: dict, output_dir: str) -> str:
    """Resolve the actual media path yt-dlp wrote to disk."""
    candidate_paths = []
    for item in info.get("requested_downloads") or []:
        if item.get("filepath"):
            candidate_paths.append(item["filepath"])
        if item.get("_filename"):
            candidate_paths.append(item["_filename"])

    if info.get("filepath"):
        candidate_paths.append(info["filepath"])
    if info.get("_filename"):
        candidate_paths.append(info["_filename"])

    video_id = info.get("id")
    ext = info.get("ext", "m4a")
    if video_id:
        candidate_paths.append(os.path.join(output_dir, f"{video_id}.{ext}"))

    for path in candidate_paths:
        if path and os.path.exists(path):
            return path

    return candidate_paths[0] if candidate_paths else ""


class YoutubeDownloader(Downloader, ABC):
    def __init__(self):

        super().__init__()
        self._cookie_mgr = CookieConfigManager()
        self._cookie: Optional[str] = None
        self._cookiefile: Optional[str] = None
        self._load_cookie()

    def _load_cookie(self) -> None:
        meta = self._cookie_mgr.get_with_meta('youtube')
        self._active_cookie_id = meta.cookie_id
        self._active_cookie_source = meta.source
        self._cookie = meta.cookie
        self._cookiefile = self._write_netscape_cookie_file()

    def set_cookie_meta(self, meta) -> None:
        super().set_cookie_meta(meta)
        self._cookie = getattr(meta, "cookie", None)
        self._cookiefile = self._write_netscape_cookie_file()

    def _write_netscape_cookie_file(self) -> Optional[str]:
        if not self._cookie:
            return None
        lines = ["# Netscape HTTP Cookie File\n"]
        for pair in self._cookie.split("; "):
            if "=" in pair:
                key, value = pair.split("=", 1)
                lines.append(f".youtube.com\tTRUE\t/\tFALSE\t0\t{key}\t{value}\n")
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8')
        tmp.writelines(lines)
        tmp.close()
        logger.info("已生成 YouTube Netscape Cookie 文件: %s (条目: %d)", tmp.name, len(lines) - 1)
        return tmp.name

    def download(
        self,
        video_url: str,
        output_dir: Union[str, None] = None,
        quality: DownloadQuality = "fast",
        need_video: Optional[bool] = False,
        skip_download: bool = False,
    ) -> AudioDownloadResult:
        if output_dir is None:
            output_dir = get_data_dir()
        if not output_dir:
            output_dir = self.cache_data
        os.makedirs(output_dir, exist_ok=True)

        output_path = os.path.join(output_dir, "%(id)s.%(ext)s")

        ydl_opts = {
            'outtmpl': output_path,
            'noplaylist': True,
            'quiet': False,
        }

        if skip_download:
            ydl_opts['skip_download'] = True

        if self._cookiefile:
            ydl_opts['cookiefile'] = self._cookiefile

        _apply_proxy(ydl_opts, "youtube")
        try:
            info = _extract_with_fallback(
                video_url, ydl_opts, _YT_AUDIO_ATTEMPTS, download=not skip_download,
            )
        except (DownloadError, ExtractorError) as exc:
            if skip_download:
                video_id = extract_video_id(video_url, "youtube")
                if video_id:
                    try:
                        logger.warning(
                            "YouTube yt-dlp 元信息解析失败，尝试 oEmbed（video_id=%s）: %s",
                            video_id,
                            exc,
                        )
                        return _fetch_oembed_metadata(video_url, video_id)
                    except Exception as metadata_exc:
                        logger.warning("YouTube oEmbed 元信息获取失败: %s", metadata_exc)
            raise
        video_id = info.get("id")
        title = info.get("title")
        duration = info.get("duration", 0)
        cover_url = info.get("thumbnail")
        ext = info.get("ext", "m4a")
        audio_path = None if skip_download else _resolve_downloaded_path(info, output_dir)

        if not skip_download and (not audio_path or not os.path.exists(audio_path)):
            raise FileNotFoundError(f"音频文件未找到: {audio_path or os.path.join(output_dir, f'{video_id}.{ext}')}")

        return AudioDownloadResult(
            file_path=audio_path,
            title=title,
            duration=duration,
            cover_url=cover_url,
            platform="youtube",
            video_id=video_id,
            raw_info={'tags': info.get('tags')},
            video_path=None,
        )

    def download_video(
        self,
        video_url: str,
        output_dir: Union[str, None] = None,
    ) -> str:
        """
        下载视频，返回视频文件路径
        """
        if output_dir is None:
            output_dir = get_data_dir()
        video_id = extract_video_id(video_url, "youtube")
        video_path = os.path.join(output_dir, f"{video_id}.mp4")
        if os.path.exists(video_path):
            return video_path
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "%(id)s.%(ext)s")

        ydl_opts = {
            'outtmpl': output_path,
            'noplaylist': True,
            'quiet': False,
            'merge_output_format': 'mp4',
        }

        if self._cookiefile:
            ydl_opts['cookiefile'] = self._cookiefile

        _apply_proxy(ydl_opts, "youtube")
        info = _extract_with_fallback(video_url, ydl_opts, _YT_VIDEO_ATTEMPTS, download=True)
        video_id = info.get("id")
        video_path = os.path.join(output_dir, f"{video_id}.mp4")

        if not os.path.exists(video_path):
            raise FileNotFoundError(f"视频文件未找到: {video_path}")

        return video_path

    def list_channel_videos(self, channel_url: str, limit: int = 30) -> List[dict]:
        """
        解析 YouTube 频道/播放列表链接，列出其中的视频（不下载）。
        使用 extract_flat 仅拉取列表元信息。
        返回 [{video_url, title, cover_url, duration}, ...]，最多 limit 条。
        """
        ydl_opts = {
            'extract_flat': True,
            'quiet': True,
            'playlistend': limit,
        }
        _apply_proxy(ydl_opts, "youtube")

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(channel_url, download=False)

        entries = info.get('entries') or ([info] if info.get('id') else [])
        videos = []
        for entry in entries[:limit]:
            if not entry:
                continue
            video_id = entry.get('id')
            if not video_id:
                continue
            videos.append({
                'video_url': entry.get('url') or entry.get('webpage_url') or f"https://www.youtube.com/watch?v={video_id}",
                'title': entry.get('title') or '',
                'cover_url': entry.get('thumbnail') or (entry.get('thumbnails') or [{}])[-1].get('url', ''),
                'duration': entry.get('duration') or 0,
            })
        return videos

    def download_subtitles(self, video_url: str, output_dir: str = None,
                           langs: List[str] = None) -> Optional[TranscriptResult]:
        """
        通过 YouTube InnerTube API 直接获取字幕（优先人工字幕，其次自动生成）。
        比 yt_dlp 方式更轻量，无需写临时文件到磁盘。

        :param video_url: 视频链接
        :param output_dir: 未使用（保留接口兼容）
        :param langs: 优先语言列表
        :return: TranscriptResult 或 None
        """
        if langs is None:
            langs = ['zh-Hans', 'zh', 'zh-CN', 'zh-TW', 'en', 'en-US', 'ja']

        video_id = extract_video_id(video_url, "youtube")
        fetcher = YouTubeSubtitleFetcher()
        print(
            f"尝试获取字幕，video_id={video_id}, langs={langs}"
        )
        return fetcher.fetch_subtitles(video_id, langs)
