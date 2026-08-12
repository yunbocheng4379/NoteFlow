"""
百度网盘 downloader.

video_url 约定格式: cloud://baidu_pan/{fs_id}?name={url_encoded_filename}

- fs_id: 百度文件唯一 ID (list_files 返回)
- name: 文件名, 用于给下载后的本地文件命名

流程:
1. 解析 fs_id
2. 从 DB 拿当前用户的 access_token (自动续期)
3. 调百度 get_download_url → 拿临时直链
4. 流式下载到 DATA_DIR
5. FFmpeg 转 mp3 (视频转音频, 复用 LocalDownloader 里已经跑通的逻辑)
6. 返回 AudioDownloadResult
"""
import logging
import os
import subprocess
from typing import Optional
from urllib.parse import urlparse, parse_qs, unquote

from app.db.engine import get_db
from app.downloaders.base import Downloader
from app.enmus.note_enums import DownloadQuality
from app.models.audio_model import AudioDownloadResult
from app.services.cloud_drive import baidu_client
from app.services.cloud_drive.token_manager import (
    NoCredentialError,
    TokenRefreshFailed,
    ensure_valid_token,
)
from app.utils.path_helper import get_data_dir

logger = logging.getLogger(__name__)


class BaiduPanDownloader(Downloader):
    def __init__(self, user_id: Optional[int] = None):
        super().__init__()
        if user_id is None:
            raise ValueError("BaiduPanDownloader 必须传 user_id")
        self._user_id = user_id

    def _parse_url(self, video_url: str) -> tuple[int, str]:
        """
        cloud://baidu_pan/{fs_id}?name={filename}  →  (fs_id, filename)
        """
        p = urlparse(video_url)
        if p.scheme != "cloud" or p.netloc != "baidu_pan":
            raise ValueError(f"非法的 baidu_pan URL: {video_url}")
        fs_id_str = p.path.lstrip("/")
        try:
            fs_id = int(fs_id_str)
        except ValueError:
            raise ValueError(f"fs_id 不是整数: {fs_id_str}")
        qs = parse_qs(p.query)
        name = unquote(qs.get("name", [f"baidu_{fs_id}"])[0])
        return fs_id, name

    def download(
        self,
        video_url: str,
        output_dir: str = None,
        quality: DownloadQuality = "fast",
        need_video: Optional[bool] = False,
        skip_download: bool = False,
    ) -> AudioDownloadResult:
        fs_id, filename = self._parse_url(video_url)
        title = os.path.splitext(filename)[0]

        if skip_download:
            # 只做元数据预扣费查询, 不真下载. 百度目前没有便捷的 duration API,
            # 只能返回 0 让上层按最低标准扣费; 实际下载后转写时可以拿真实时长.
            return AudioDownloadResult(
                file_path="",
                title=title,
                duration=0,
                cover_url=None,
                platform="baidu_pan",
                video_id=f"baidu_{fs_id}",
                raw_info={"fs_id": fs_id, "filename": filename},
                video_path=None,
            )

        # 拿 access_token (自动续期)
        db_gen = get_db()
        db = next(db_gen)
        try:
            try:
                access_token = ensure_valid_token(
                    db, user_id=self._user_id, platform="baidu_pan"
                )
            except NoCredentialError:
                raise RuntimeError("未登录百度网盘, 请先在网盘 Tab 里授权")
            except TokenRefreshFailed as e:
                raise RuntimeError(f"百度授权已失效, 请重新登录: {e}")
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass

        # 拿下载地址
        download_url, real_filename = baidu_client.get_download_url(
            access_token, fs_id
        )
        # 用户传进来的 name 优先, 兜底用百度返回的
        safe_filename = filename or real_filename

        data_dir = output_dir or get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
        video_path = os.path.join(data_dir, safe_filename)

        logger.info(f"[baidu_pan] 下载 fs_id={fs_id} → {video_path}")
        baidu_client.download_file(download_url, video_path)

        audio_path = self._convert_to_audio(video_path, data_dir)

        return AudioDownloadResult(
            file_path=audio_path,
            title=title,
            duration=0,
            cover_url=None,
            platform="baidu_pan",
            video_id=f"baidu_{fs_id}",
            raw_info={
                "fs_id": fs_id,
                "filename": safe_filename,
                "source_url": video_url,
            },
            video_path=video_path if need_video else None,
        )

    def _convert_to_audio(self, video_path: str, output_dir: str) -> str:
        """FFmpeg 抽音轨. 与 LocalDownloader.convert_to_mp3 逻辑一致."""
        base = os.path.splitext(os.path.basename(video_path))[0]
        audio_path = os.path.join(output_dir, f"{base}.mp3")
        command = [
            "ffmpeg", "-i", video_path,
            "-vn", "-acodec", "libmp3lame", "-y",
            audio_path,
        ]
        subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        if not os.path.exists(audio_path):
            raise RuntimeError(f"mp3 转换失败: {audio_path}")
        return audio_path
