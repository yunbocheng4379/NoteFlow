import enum

from abc import ABC, abstractmethod
from typing import Optional, Union

from app.enmus.note_enums import DownloadQuality
from app.models.notes_model import AudioDownloadResult
from app.models.transcriber_model import TranscriptResult
from os import getenv
QUALITY_MAP = {
    "fast": "32",
    "medium": "64",
    "slow": "128"
}


class Downloader(ABC):
    def __init__(self):
        #TODO 需要修改为可配置
        self.quality = QUALITY_MAP.get('fast')
        self.cache_data=getenv('DATA_DIR')
        # 当前下载器最近一次 ``get_with_meta`` 拿到的 cookie 元信息.
        # 失败上报时, 上层 (NoteGenerator) 用 ``_active_cookie_id`` 精确定位到
        # ``platform_cookies`` 表里那条, 让 ``CookiePoolManager.report_failure``
        # 真的累计连续失败次数, 而不是占位的 "None".
        # 初始为 None; downloader 子类在 ``__init__`` 里赋.
        self._active_cookie_id: Optional[int] = None
        self._active_cookie_source: Optional[str] = None

    def set_cookie_meta(self, meta) -> None:
        """允许上层 (NoteGenerator) 在 retry 时切换 cookie, 避免重建 downloader.

        默认实现只更新 active id/source 字段, 不动内部 cookie 字符串.
        真正会写 cookiefile / headers 的子类 (bilibili / douyin) 必须 override.
        """
        self._active_cookie_id = getattr(meta, "cookie_id", None)
        self._active_cookie_source = getattr(meta, "source", None)

    @abstractmethod
    def download(self, video_url: str, output_dir: str = None,
                 quality: DownloadQuality = "fast", need_video: Optional[bool] = False,
                 skip_download: bool = False) -> AudioDownloadResult:
        '''

        :param need_video:
        :param video_url: 资源链接
        :param output_dir: 输出路径 默认根目录data
        :param quality: 音频质量 fast | medium | slow
        :return:返回一个 AudioDownloadResult 类
        '''
        pass

    @staticmethod
    def download_video(self, video_url: str,
                       output_dir: Union[str, None] = None) -> str:
        pass

    def download_subtitles(self, video_url: str, output_dir: str = None,
                           langs: list = None) -> Optional[TranscriptResult]:
        '''
        尝试获取平台字幕（人工字幕或自动生成字幕）

        :param video_url: 视频链接
        :param output_dir: 输出路径
        :param langs: 优先语言列表，如 ['zh-Hans', 'zh', 'en']
        :return: TranscriptResult 或 None（无字幕时）
        '''
        return None
