import json
import logging
import os
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Tuple, Union, Any

from fastapi import HTTPException
from pydantic import HttpUrl
from dotenv import load_dotenv

from app.downloaders.base import Downloader
from app.downloaders.bilibili_downloader import BilibiliDownloader
from app.downloaders.douyin_downloader import DouyinDownloader
from app.downloaders.local_downloader import LocalDownloader
from app.downloaders.youtube_downloader import YoutubeDownloader
from app.db.video_task_dao import delete_task_by_video, insert_video_task
from app.enmus.exception import NoteErrorEnum, ProviderErrorEnum
from app.enmus.task_status_enums import TaskStatus
from app.enmus.note_enums import DownloadQuality
from app.exceptions.note import NoteError
from app.exceptions.provider import ProviderError
from app.gpt.base import GPT
from app.gpt.gpt_factory import GPTFactory
from app.models.audio_model import AudioDownloadResult
from app.models.gpt_model import GPTSource
from app.models.model_config import ModelConfig
from app.models.notes_model import AudioDownloadResult, NoteResult
from app.models.transcriber_model import TranscriptResult, TranscriptSegment
from app.services.constant import SUPPORT_PLATFORM_MAP
from app.services.provider import ProviderService
from app.transcriber.base import Transcriber
from app.transcriber.transcriber_provider import get_transcriber, _transcribers
from app.utils.note_helper import replace_content_markers, prepend_source_link, rebuild_toc
from app.utils.screenshot_marker import extract_screenshot_timestamps
from app.utils.status_code import StatusCode
from app.utils.video_helper import generate_screenshot
from app.utils.video_reader import VideoReader
from app.utils.error_messages import (
    translate_download_error,
    translate_transcribe_error,
    translate_llm_error,
)

# ------------------ 环境变量与全局配置 ------------------

# 从 .env 文件中加载环境变量
load_dotenv()

# 后端 API 地址与端口（若有需要可以在代码其他部分使用 BACKEND_BASE_URL）
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost")
BACKEND_PORT = os.getenv("BACKEND_PORT", "8483")
BACKEND_BASE_URL = f"{API_BASE_URL}:{BACKEND_PORT}"

# 输出目录（用于缓存音频、转写、Markdown 文件，以及存储截图）
NOTE_OUTPUT_DIR = Path(os.getenv("NOTE_OUTPUT_DIR", "note_results"))
NOTE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_OUTPUT_DIR = os.getenv("OUT_DIR", "./static/screenshots")
# 图片基础 URL（用于生成 Markdown 中的图片链接，需前端静态目录对应）
IMAGE_BASE_URL = os.getenv("IMAGE_BASE_URL", "/static/screenshots")

# 日志配置
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class NoteGenerator:
    """
    NoteGenerator 用于执行视频/音频下载、转写、GPT 生成笔记、插入截图/链接、
    以及将任务信息写入状态文件与数据库等功能。
    """

    def __init__(self, user_id: Optional[int] = None):
        from app.db import transcriber_config_dao
        cfg = transcriber_config_dao.get_transcriber_config(user_id or 1)
        self.user_id: Optional[int] = user_id
        self.model_size: str = cfg["whisper_model_size"]
        self.device: Optional[str] = None
        self.transcriber_type: str = cfg["transcriber_type"]
        self.transcriber: Transcriber = self._init_transcriber()
        self.video_path: Optional[Path] = None
        self.video_img_urls = []
        logger.info("NoteGenerator 初始化完成")


    # ---------------- 公有方法 ----------------

    def generate(
        self,
        video_url: Union[str, HttpUrl],
        platform: str,
        quality: DownloadQuality = DownloadQuality.medium,
        task_id: Optional[str] = None,
        model_name: Optional[str] = None,
        provider_id: Optional[str] = None,
        link: bool = False,
        screenshot: bool = False,
        _format: Optional[List[str]] = None,
        style: Optional[str] = None,
        extras: Optional[str] = None,
        output_path: Optional[str] = None,
        video_understanding: bool = False,
        video_interval: int = 0,
        grid_size: Optional[List[int]] = None,
        user_id: Optional[int] = None,
    ) -> NoteResult | None:
        """
        主流程：按步骤依次下载、转写、GPT 总结、截图/链接处理、存库、返回 NoteResult。

        :param video_url: 视频或音频链接
        :param platform: 平台名称，对应 SUPPORT_PLATFORM_MAP 中的键
        :param quality: 下载音频的质量枚举
        :param task_id: 用于标识本次任务的唯一 ID，亦用于状态文件和缓存文件命名
        :param model_name: GPT 模型名称
        :param provider_id: 模型供应商 ID
        :param link: 是否在笔记中插入视频片段链接
        :param screenshot: 是否在笔记中替换 Screenshot 标记为图片
        :param _format: 包含 'link' 或 'screenshot' 等字符串的列表，决定后续处理
        :param style: GPT 生成笔记的风格
        :param extras: 额外参数，传递给 GPT
        :param output_path: 下载输出目录（可选）
        :param video_understanding: 是否需要视频拼图理解（生成缩略图）
        :param video_interval: 视频帧截取间隔（秒），仅在 video_understanding 为 True 时生效
        :param grid_size: 生成缩略图时的网格大小，如 [3, 3]
        :return: NoteResult 对象，包含 markdown 文本、转写结果和音频元信息
        """
        if grid_size is None:
            grid_size = []

        try:
            logger.info(f"开始生成笔记 (task_id={task_id})")
            self._update_status(task_id, TaskStatus.PARSING)

            # 获取下载器与 GPT 实例

            downloader = self._get_downloader(platform)
            gpt = self._get_gpt(model_name, provider_id)

            # 缓存文件路径
            audio_cache_file = NOTE_OUTPUT_DIR / f"{task_id}_audio.json"
            transcript_cache_file = NOTE_OUTPUT_DIR / f"{task_id}_transcript.json"
            markdown_cache_file = NOTE_OUTPUT_DIR / f"{task_id}_markdown.md"
            # 1. 获取字幕/转写：优先缓存 → 平台字幕 → 音频转写
            transcript = None

            # 尝试读取缓存
            if transcript_cache_file.exists():
                logger.info(f"检测到转写缓存 ({transcript_cache_file})，尝试读取")
                try:
                    data = json.loads(transcript_cache_file.read_text(encoding="utf-8"))
                    segments = [TranscriptSegment(**seg) for seg in data.get("segments", [])]
                    transcript = TranscriptResult(
                        language=data.get("language"),
                        full_text=data["full_text"],
                        segments=segments,
                    )
                    logger.info(f"已从缓存加载转写结果，共 {len(segments)} 段")
                except Exception as e:
                    logger.warning(f"加载转写缓存失败: {e}")

            # 缓存没有，尝试获取平台字幕
            if transcript is None:
                logger.info("尝试获取平台字幕（优先于音频下载）...")
                try:
                    transcript = downloader.download_subtitles(video_url)
                    if transcript and transcript.segments:
                        logger.info(f"成功获取平台字幕，共 {len(transcript.segments)} 段")
                        transcript_cache_file.write_text(
                            json.dumps(asdict(transcript), ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                    else:
                        transcript = None
                        logger.info("平台无可用字幕，将下载音频后转写")
                except Exception as e:
                    logger.warning(f"获取平台字幕失败: {e}，将下载音频后转写")
                    transcript = None

            # 2. 下载音频/视频
            # 有字幕时只提取元信息，不下载音视频文件（除非需要截图/视频理解）
            has_transcript = transcript is not None
            need_full_download = not has_transcript or screenshot or video_understanding
            audio_meta = self._download_media(
                downloader=downloader,
                video_url=video_url,
                quality=quality,
                audio_cache_file=audio_cache_file,
                status_phase=TaskStatus.DOWNLOADING,
                platform=platform,
                output_path=output_path,
                screenshot=screenshot,
                video_understanding=video_understanding,
                video_interval=video_interval,
                grid_size=grid_size,
                skip_download=not need_full_download,
            )

            # 下载完成即可拿到封面/标题等元信息，提前落盘供前端在生成过程中展示
            self._write_partial_meta(task_id, audio_meta)

            # 3. 如果前面没拿到字幕，走转写流程
            if transcript is None:
                transcript = self._get_transcript(
                    downloader=downloader,
                    video_url=video_url,
                    audio_file=audio_meta.file_path,
                    transcript_cache_file=transcript_cache_file,
                    status_phase=TaskStatus.TRANSCRIBING,
                    task_id=task_id,
                )

            # 3. GPT 总结（带 Provider fallback）
            markdown = self._summarize_with_fallback(
                audio_meta=audio_meta,
                transcript=transcript,
                primary_provider_id=provider_id,
                primary_model_name=model_name,
                markdown_cache_file=markdown_cache_file,
                link=link,
                screenshot=screenshot,
                formats=_format or [],
                style=style,
                extras=extras,
                video_img_urls=self.video_img_urls,
            )

            # 4. 截图 & 链接替换
            if _format:
                markdown = self._post_process_markdown(
                    markdown=markdown,
                    video_path=self.video_path,
                    formats=_format,
                    audio_meta=audio_meta,
                    platform=platform,
                )

            markdown = prepend_source_link(markdown, str(video_url))

            # 5. 保存记录到数据库
            self._update_status(task_id, TaskStatus.SAVING)
            self._save_metadata(video_id=audio_meta.video_id, platform=platform, task_id=task_id, user_id=user_id)

            # 6. 完成
            self._update_status(task_id, TaskStatus.SUCCESS)
            logger.info(f"笔记生成成功 (task_id={task_id})")
            self._notify_task_completed(task_id=task_id, user_id=user_id, title=audio_meta.title)
            return NoteResult(markdown=markdown, transcript=transcript, audio_meta=audio_meta)

        except Exception as exc:
            logger.error(f"生成笔记流程异常 (task_id={task_id})：{exc}", exc_info=True)
            friendly = self._translate_note_error(exc, platform=platform)
            self._update_status(task_id, TaskStatus.FAILED, message=friendly)
            return None

    @staticmethod
    def delete_note(video_id: str, platform: str) -> int:
        """
        删除数据库中对应 video_id 与 platform 的任务记录

        :param video_id: 视频 ID
        :param platform: 平台标识
        :return: 删除的记录数
        """
        logger.info(f"删除笔记记录 (video_id={video_id}, platform={platform})")
        return delete_task_by_video(video_id, platform)

    # ---------------- 私有方法 ----------------

    def _init_transcriber(self) -> Transcriber:
        """
        根据环境变量 TRANSCRIBER_TYPE 动态获取并实例化转写器
        """
        if self.transcriber_type not in _transcribers:
            logger.error(f"未找到支持的转写器：{self.transcriber_type}")
            raise Exception(f"不支持的转写器：{self.transcriber_type}")

        logger.info(f"使用转写器：{self.transcriber_type}")
        return get_transcriber(transcriber_type=self.transcriber_type)

    def _get_gpt(self, model_name: Optional[str], provider_id: Optional[str]) -> GPT:
        """
        根据 provider_id 获取对应的 GPT 实例
        :param model_name: GPT 模型名称
        :param provider_id: 供应商 ID
        :return: GPT 实例
        """
        provider = ProviderService.get_provider_by_id(provider_id)
        logger.info(f"[_get_gpt] provider_id={provider_id} user_id={self.user_id} provider={provider}")
        if not provider:
            logger.error(f"[get_gpt] 未找到模型供应商: provider_id={provider_id}")
            raise ProviderError(code=ProviderErrorEnum.NOT_FOUND,message=ProviderErrorEnum.NOT_FOUND.message)
        logger.info(f"创建 GPT 实例 {provider_id}")
        config = ModelConfig(
            api_key=provider["api_key"],
            base_url=provider["base_url"],
            model_name=model_name,
            provider=provider["type"],
            name=provider["name"],
        )
        return GPTFactory().from_config(config)

    def _get_downloader(self, platform: str) -> Downloader:
        downloader_cls = SUPPORT_PLATFORM_MAP.get(platform)
        logger.debug(f"实例化下载器 - {platform}")
        if not downloader_cls:
            logger.error(f"不支持的平台：{platform}")
            raise NoteError(code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                            message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message)
        try:
            instance = downloader_cls(user_id=self.user_id)
        except TypeError:
            instance = downloader_cls()
        logger.info(f"使用下载器：{downloader_cls.__name__}")
        return instance

    def _write_partial_meta(self, task_id: Optional[str], audio_meta) -> None:
        """
        在任务执行过程中（下载完成后、转写/总结之前）提前落盘视频元信息，
        供前端在笔记仍在生成时即可展示封面与标题，提升体验。

        :param task_id: 任务唯一 ID
        :param audio_meta: AudioDownloadResult，含 title / cover_url / duration 等
        """
        if not task_id or not audio_meta:
            return
        try:
            NOTE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            meta_file = NOTE_OUTPUT_DIR / f"{task_id}.meta.json"
            data = {
                "title": getattr(audio_meta, "title", "") or "",
                "cover_url": getattr(audio_meta, "cover_url", "") or "",
                "duration": getattr(audio_meta, "duration", 0) or 0,
                "platform": getattr(audio_meta, "platform", "") or "",
                "video_id": getattr(audio_meta, "video_id", "") or "",
                "raw_info": getattr(audio_meta, "raw_info", None),
            }
            temp_file = meta_file.with_suffix(".tmp")
            with temp_file.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_file.replace(meta_file)
        except Exception as e:
            # 提前元信息为锦上添花，失败不影响主流程
            logger.warning(f"写入临时元信息失败 (task_id={task_id}): {e}")

    def _update_status(self, task_id: Optional[str], status: Union[str, TaskStatus], message: Optional[str] = None):
        """
        创建或更新 {task_id}.status.json，记录当前任务状态

        :param task_id: 任务唯一 ID
        :param status: TaskStatus 枚举或自定义状态字符串
        :param message: 可选消息，用于记录失败原因等
        """
        if not task_id:
            return

        NOTE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        status_file = NOTE_OUTPUT_DIR / f"{task_id}.status.json"
        print(f"写入状态文件: {status_file} 当前状态: {status}")
        status_str = status.value if isinstance(status, TaskStatus) else status
        data = {"status": status_str}
        if message:
            data["message"] = message

        try:
            # First create a temporary file
            temp_file = status_file.with_suffix('.tmp')

            # Write to temporary file
            with temp_file.open('w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            # Atomic rename operation
            temp_file.replace(status_file)

            print(f"状态文件写入成功: {status_file}")
        except Exception as e:
            logger.error(f"写入状态文件失败 (task_id={task_id})：{e}")
            # Try to write error to file directly as fallback
            try:
                with status_file.open('w', encoding='utf-8') as f:
                    f.write(f"Error writing status: {str(e)}")
            except:
                logger.error(f"写入错误  {e}")

        # sync status to DB (best-effort, non-blocking)
        try:
            from app.db.video_task_dao import update_task_status
            completed = status_str in ("SUCCESS", "FAILED")
            update_task_status(task_id, status_str, completed=completed)
        except Exception as e:
            logger.warning(f"同步任务状态到 DB 失败 (task_id={task_id}): {e}")

        # 任务失败 → 触发退电 (幂等, 单事务, 内部 refunded_at 防重放)
        if status_str == "FAILED":
            try:
                from app.services.billing import credit_ledger
                from app.db.engine import SessionLocal
                s = SessionLocal()
                try:
                    with s.begin():
                        credit_ledger.refund(s, task_id=task_id)
                finally:
                    s.close()
            except Exception as e:
                # 退电失败不能阻塞主流程, 但要记 warning 触发人工巡检
                logger.warning(f"[refund] 任务失败退电异常 (task_id={task_id}): {e}", exc_info=True)

    def _translate_note_error(self, exc: Exception, platform: str = "") -> str:
        from app.exceptions.provider import ProviderError
        from app.exceptions.note import NoteError
        raw = str(exc)

        # 已经是友好消息（RuntimeError from _download_media 412 path）
        if isinstance(exc, RuntimeError) and ("Cookie" in raw or "登录验证" in raw or "版权" in raw):
            return raw

        if isinstance(exc, ProviderError):
            return translate_llm_error(exc)

        if isinstance(exc, NoteError):
            return exc.message

        # Distinguish phase by keywords in the raw message
        download_keywords = ("yt_dlp", "yt-dlp", "bilibili", "youtube", "download", "412",
                             "precondition", "403 forbidden", "unable to extract")
        transcribe_keywords = ("whisper", "transcrib", "faster_whisper", "model.bin",
                               "audio", "ffmpeg", "groq", "wav", "mp3")
        llm_keywords = ("openai", "chatgpt", "api key", "401", "402", "429",
                        "rate limit", "context length", "model_not_found",
                        "供应商", "insufficient balance", "insufficient_balance")

        raw_lower = raw.lower()
        if any(kw in raw_lower for kw in download_keywords):
            return translate_download_error(exc, platform=platform)
        if any(kw in raw_lower for kw in transcribe_keywords):
            return translate_transcribe_error(exc)
        if any(kw in raw_lower for kw in llm_keywords):
            return translate_llm_error(exc)

        # Generic fallback — 也再过一次 LLM 翻译，避免把 openai 的 JSON 错误体直接展示给用户
        llm_fallback = translate_llm_error(exc)
        if llm_fallback and not llm_fallback.startswith("AI 笔记生成失败"):
            return llm_fallback
        return f"笔记生成失败，请稍后重试（{raw[:80]}）"

    def _handle_exception(self, task_id, exc):
        logger.error(f"任务异常 (task_id={task_id})", exc_info=True)
        error_message = getattr(exc, 'detail', str(exc))
        if isinstance(error_message, dict):
            try:
                error_message = json.dumps(error_message, ensure_ascii=False)
            except:
                error_message = str(error_message)
        self._update_status(task_id, TaskStatus.FAILED, message=error_message)

    def _download_media(
        self,
        downloader: Downloader,
        video_url: Union[str, HttpUrl],
        quality: DownloadQuality,
        audio_cache_file: Path,
        status_phase: TaskStatus,
        platform: str,
        output_path: Optional[str],
        screenshot: bool,
        video_understanding: bool,
        video_interval: int,
        grid_size: List[int],
        skip_download: bool = False,
    ) -> AudioDownloadResult | None:
        """
        1. 检查音频缓存；若不存在，则根据需要下载音频或视频（若需截图/可视化）。
        2. 如果需要视频，则先下载视频并生成缩略图集，再下载音频。
        3. 返回 AudioDownloadResult

        :param downloader: Downloader 实例
        :param video_url: 视频/音频链接
        :param quality: 音频下载质量
        :param audio_cache_file: 本地缓存 JSON 文件路径
        :param status_phase: 对应的状态枚举，如 TaskStatus.DOWNLOADING
        :param platform: 平台标识
        :param output_path: 下载输出目录（可为 None）
        :param screenshot: 是否需要在笔记中插入截图
        :param video_understanding: 是否需要生成缩略图
        :param video_interval: 视频截帧间隔
        :param grid_size: 缩略图网格尺寸
        :return: AudioDownloadResult 对象
        """
        task_id = audio_cache_file.stem.split("_")[0]
        self._update_status(task_id, status_phase)

        # 已有缓存，尝试加载
        if audio_cache_file.exists():
            logger.info(f"检测到音频缓存 ({audio_cache_file})，直接读取")
            try:
                data = json.loads(audio_cache_file.read_text(encoding="utf-8"))
                return AudioDownloadResult(**data)
            except Exception as e:
                logger.warning(f"读取音频缓存失败，将重新下载：{e}")

        # 有字幕且不需要截图/视频理解时，只提取元信息不下载文件
        if skip_download:
            logger.info("已有字幕，仅提取视频元信息（不下载音视频）")
            try:
                audio = downloader.download(
                    video_url=video_url,
                    quality=quality,
                    output_dir=output_path,
                    need_video=False,
                    skip_download=True,
                )
                audio_cache_file.write_text(
                    json.dumps(asdict(audio), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                logger.info(f"元信息提取完成 ({audio_cache_file})")
                return audio
            except Exception as exc:
                logger.warning(f"元信息提取失败，将尝试完整下载: {exc}")

        # 判断是否需要下载视频
        need_video = screenshot or video_understanding
        if screenshot and not grid_size:
            grid_size = [2, 2]

        frame_interval = video_interval if video_interval and video_interval > 0 else 6
        if need_video:
            try:
                logger.info("开始下载视频")
                video_path_str = downloader.download_video(video_url)
                self.video_path = Path(video_path_str)
                logger.info(f"视频下载完成：{self.video_path}")

                if grid_size:
                    self.video_img_urls = VideoReader(
                        video_path=str(self.video_path),
                        grid_size=tuple(grid_size),
                        frame_interval=frame_interval,
                        unit_width=960,
                        unit_height=540,
                        save_quality=80,
                    ).run()
                else:
                    logger.info("未指定 grid_size，跳过缩略图生成")
            except Exception as exc:
                logger.error(f"视频下载失败：{exc}", exc_info=True)
                friendly = translate_download_error(exc, platform=platform)
                self._update_status(task_id, TaskStatus.FAILED, message=friendly)
                raise RuntimeError(friendly) from exc

        # 下载音频 — 用 CookiePoolManager.use_cookie 上下文管理 cookie 生命周期
        from app.services.cookie_failure_detector import CookieFailureDetector
        from app.services.cookie_pool_manager import CookiePoolManager
        from app.services.user_tier import get_user_tier

        last_err: Optional[Exception] = None
        max_retries = int(os.getenv("COOKIE_POOL_MAX_RETRIES", "3"))
        attempt = 0
        pool = CookiePoolManager.instance()
        # effective tier: admin 拿全池, 普通用户按 reserved_for_tier 过滤
        user_tier = get_user_tier(self.user_id)

        while attempt <= max_retries:
            attempt += 1
            # pick + 用 ctx 把 cookie 与 downloader 绑起来.
            # ctx 会在 __exit__ 时根据"是否显式 report"以及"是否异常"自动兜底上报.
            # tier 由 user_id 推导, 让 admin 拿全池, 普通用户按 reserved_for_tier 过滤.
            with pool.use_cookie(platform, tier=user_tier) as ctx:
                # 池空时直接结束 retry 循环, 走 pool_exhausted 路径
                if ctx.is_empty:
                    logger.warning(
                        f"[cookie] platform={platform} 池空 (attempt={attempt})"
                    )
                    last_err = RuntimeError(
                        f"{platform} 平台 cookie 池为空, 请联系管理员维护"
                    )
                    break

                # 把 ctx 里的 cookie 同步到 downloader — 避免每次都重建实例.
                # downloader 自己也有 set_cookie_meta 实现, 内部 cookiefile/headers 都会重写.
                try:
                    downloader.set_cookie_meta(ctx)
                except Exception as se:
                    logger.warning(f"set_cookie_meta 失败: {se}; 退化为重建 downloader")
                    try:
                        downloader = self._get_downloader(platform)
                    except Exception as rexc:
                        logger.warning(f"重建 downloader 失败: {rexc}")

                logger.info(
                    f"开始下载音频 (attempt {attempt}/{max_retries + 1}, "
                    f"cookie_id={ctx.cookie_id}, name={ctx.name})"
                )

                try:
                    audio = downloader.download(
                        video_url=video_url,
                        quality=quality,
                        output_dir=output_path,
                        need_video=need_video,
                    )
                    # 成功: 通知 ctx → 上调 dao.increment_success
                    ctx.report_success()
                    audio_cache_file.write_text(
                        json.dumps(asdict(audio), ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    logger.info(f"音频下载并缓存成功 ({audio_cache_file})")
                    return audio
                except Exception as exc:
                    last_err = exc
                    err_str = str(exc)

                    # 判断是否 cookie 相关失败
                    is_cookie_err = CookieFailureDetector.is_cookie_failure(err_str)
                    # 兼容老逻辑: 412 + bilibili
                    if platform == "bilibili" and (
                        "412" in err_str or "Precondition Failed" in err_str
                    ):
                        is_cookie_err = True

                    if is_cookie_err and platform in (
                        "bilibili", "youtube", "douyin", "kuaishou"
                    ):
                        # 显式报告 (会让 __exit__ 跳过兜底, 避免重复)
                        ctx.report_failure(error_msg=err_str)
                        if attempt <= max_retries:
                            # raise 让 __exit__ 走完, 然后 while 继续下一轮 pick
                            raise
                        break

                    # 非 cookie 错误: 抑制 ctx 兜底上报, 直接透传友好错误
                    ctx.suppress_auto_report()
                    friendly = translate_download_error(exc, platform=platform)
                    self._update_status(task_id, TaskStatus.FAILED, message=friendly)
                    raise RuntimeError(friendly) from exc

        # 重试耗尽
        err_str = str(last_err) if last_err else "未知错误"
        from app.services.cookie_pool_manager import CookiePoolManager
        from app.services.notification_service import NotificationService
        if CookiePoolManager.instance().is_platform_exhausted(platform):
            try:
                NotificationService.publish_pool_exhausted(platform=platform)
            except Exception as pe:
                logger.warning(f"publish pool_exhausted failed: {pe}")
        if platform == 'bilibili' and ('412' in err_str or 'Precondition Failed' in err_str):
            friendly = "下载失败：B 站要求登录验证且 Cookie 池已耗尽，请联系管理员补充 Cookie"
        else:
            friendly = f"下载失败（Cookie 池耗尽）: {translate_download_error(last_err, platform=platform) if last_err else ''}"
        logger.error(friendly)
        self._update_status(task_id, TaskStatus.FAILED, message=friendly)
        raise RuntimeError(friendly) from last_err


    def _get_transcript(
        self,
        downloader: Downloader,
        video_url: str,
        audio_file: str,
        transcript_cache_file: Path,
        status_phase: TaskStatus,
        task_id: Optional[str] = None,
    ) -> TranscriptResult | None:
        """
        优先获取平台字幕，没有则 fallback 到音频转写

        :param downloader: 下载器实例
        :param video_url: 视频链接
        :param audio_file: 音频文件路径（用于 fallback 转写）
        :param transcript_cache_file: 缓存文件路径
        :param status_phase: 状态枚举
        :param task_id: 任务 ID
        :return: TranscriptResult 对象
        """
        self._update_status(task_id, status_phase)

        # 已有缓存，直接返回
        if transcript_cache_file.exists():
            logger.info(f"检测到转写缓存 ({transcript_cache_file})，尝试读取")
            try:
                data = json.loads(transcript_cache_file.read_text(encoding="utf-8"))
                segments = [TranscriptSegment(**seg) for seg in data.get("segments", [])]
                return TranscriptResult(language=data.get("language"), full_text=data["full_text"], segments=segments)
            except Exception as e:
                logger.warning(f"加载转写缓存失败，将重新获取：{e}")

        # 1. 先尝试获取平台字幕
        logger.info("尝试获取平台字幕...")
        try:
            transcript = downloader.download_subtitles(video_url)
            if transcript and transcript.segments:
                logger.info(f"成功获取平台字幕，共 {len(transcript.segments)} 段")
                # 缓存结果
                transcript_cache_file.write_text(
                    json.dumps(asdict(transcript), ensure_ascii=False, indent=2),
                    encoding="utf-8"
                )
                return transcript
            else:
                logger.info("平台无可用字幕，将使用音频转写")
        except Exception as e:
            logger.warning(f"获取平台字幕失败: {e}，将使用音频转写")

        # 2. Fallback 到音频转写
        return self._transcribe_audio(
            audio_file=audio_file,
            transcript_cache_file=transcript_cache_file,
            status_phase=status_phase,
        )

    def _transcribe_audio(
        self,
        audio_file: str,
        transcript_cache_file: Path,
        status_phase: TaskStatus,
    ) -> TranscriptResult | None:
        """
        1. 检查转写缓存；若存在则尝试加载，否则调用转写器生成并缓存。
        2. 返回 TranscriptResult 对象

        :param audio_file: 音频文件本地路径
        :param transcript_cache_file: 转写结果缓存路径
        :param status_phase: 对应的状态枚举，如 TaskStatus.TRANSCRIBING
        :return: TranscriptResult 对象
        """
        task_id = transcript_cache_file.stem.split("_")[0]
        self._update_status(task_id, status_phase)

        # 已有缓存，尝试加载
        if transcript_cache_file.exists():
            logger.info(f"检测到转写缓存 ({transcript_cache_file})，尝试读取")
            try:
                data = json.loads(transcript_cache_file.read_text(encoding="utf-8"))
                segments = [TranscriptSegment(**seg) for seg in data.get("segments", [])]
                return TranscriptResult(language=data["language"], full_text=data["full_text"], segments=segments)
            except Exception as e:
                logger.warning(f"加载转写缓存失败，将重新转写：{e}")

        # 调用转写器
        try:
            logger.info("开始转写音频")
            transcript = self.transcriber.transcript(file_path=audio_file)
            transcript_cache_file.write_text(json.dumps(asdict(transcript), ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info(f"转写并缓存成功 ({transcript_cache_file})")
            return transcript
        except Exception as exc:
            logger.error(f"音频转写失败：{exc}")
            self._handle_exception(task_id, exc)
            raise

    def _build_fallback_candidates(
        self,
        primary_provider_id: Optional[str],
        primary_model_name: Optional[str],
    ) -> list[tuple[str, str]]:
        """
        构造 fallback 候选列表：(provider_id, model_name)。

        顺序：
        1. 用户在表单中选中的 (provider_id, model_name)，排第一（仅当该 provider 仍 enabled 时）
        2. 其余 enabled 的 Provider，按数据库顺序；每个 Provider 取它第一个 model
        3. 跳过没有任何 model 的 Provider，以及没有启用 / 不存在的 provider
        """
        from app.db.provider_dao import get_enabled_providers
        from app.db.model_dao import get_models_by_provider

        candidates: list[tuple[str, str]] = []
        seen_providers: set[str] = set()

        enabled_ids = {p.id for p in (get_enabled_providers() or [])}

        # 1. 主 Provider（必须 enabled 才考虑）
        if primary_provider_id and primary_provider_id in enabled_ids:
            models = get_models_by_provider(primary_provider_id) or []
            chosen_model = primary_model_name
            if not chosen_model and models:
                chosen_model = models[0]["model_name"]
            if chosen_model:
                candidates.append((primary_provider_id, chosen_model))
                seen_providers.add(primary_provider_id)

        # 2. 其他 enabled Provider
        for p in get_enabled_providers() or []:
            pid = getattr(p, "id", None)
            if not pid or pid in seen_providers:
                continue
            models = get_models_by_provider(pid) or []
            if not models:
                continue
            candidates.append((pid, models[0]["model_name"]))
            seen_providers.add(pid)

        return candidates

    def _summarize_with_fallback(
        self,
        audio_meta: AudioDownloadResult,
        transcript: TranscriptResult,
        primary_provider_id: Optional[str],
        primary_model_name: Optional[str],
        markdown_cache_file: Path,
        link: bool,
        screenshot: bool,
        formats: List[str],
        style: Optional[str],
        extras: Optional[str],
        video_img_urls: List[str],
    ) -> str | None:
        """
        依次尝试主 Provider / 其他启用 Provider 中的任意一个生成笔记。
        当某个 Provider 因 402/401/网络错误等"可恢复"原因失败时，自动切换到下一个，
        避免主 Provider 余额耗尽时任务直接失败。

        所有 Provider 都失败时抛出最后一次的原始异常，由上层 `_translate_note_error`
        翻译成对用户友好的中文提示。
        """
        from app.services.llm_fallback import LLMFallbackableError

        candidates = self._build_fallback_candidates(
            primary_provider_id=primary_provider_id,
            primary_model_name=primary_model_name,
        )
        if not candidates:
            raise RuntimeError("没有可用的 AI 供应商，请先在「设置 → 模型管理」中启用至少一个供应商及其模型")

        tried: set[str] = set()
        last_exc: Exception | None = None

        for pid, mname in candidates:
            if pid in tried:
                continue
            tried.add(pid)
            try:
                gpt = self._get_gpt(mname, pid)
                logger.info(
                    f"使用供应商生成笔记 provider_id={pid} model={mname} "
                    f"(task_id={markdown_cache_file.stem})"
                )
                return self._summarize_text(
                    audio_meta=audio_meta,
                    transcript=transcript,
                    gpt=gpt,
                    markdown_cache_file=markdown_cache_file,
                    link=link,
                    screenshot=screenshot,
                    formats=formats,
                    style=style,
                    extras=extras,
                    video_img_urls=video_img_urls,
                    _fallback_marker=tried,
                    _primary_provider_id=pid,
                )
            except LLMFallbackableError as fb_exc:
                last_exc = fb_exc
                logger.warning(
                    f"供应商 {pid}/{mname} 失败（{fb_exc.message}），"
                    f"切换下一个候选（task_id={markdown_cache_file.stem}）"
                )
                continue
            except ProviderError as perr:
                # Provider 配置错误（如 key 缺失、供应商被禁用）也算 fallbackable
                last_exc = perr
                logger.warning(
                    f"供应商 {pid}/{mname} 配置不可用（{perr.message}），"
                    f"切换下一个候选（task_id={markdown_cache_file.stem}）"
                )
                continue

        # 所有候选都失败，把最后一次异常抛给上层
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("AI 供应商均不可用，请稍后重试或联系管理员")

    def _summarize_text(
        self,
        audio_meta: AudioDownloadResult,
        transcript: TranscriptResult,
        gpt: GPT,
        markdown_cache_file: Path,
        link: bool,
        screenshot: bool,
        formats: List[str],
        style: Optional[str],
        extras: Optional[str],
        video_img_urls: List[str],
        _fallback_marker: Optional[set] = None,
        _primary_provider_id: Optional[str] = None,
    ) -> str | None:
        """
        调用 GPT 对转写结果进行总结，生成 Markdown 文本并缓存。

        :param audio_meta: AudioDownloadResult 元信息
        :param transcript: TranscriptResult 转写结果
        :param gpt: GPT 实例
        :param markdown_cache_file: Markdown 缓存路径
        :param link: 是否在笔记中插入链接
        :param screenshot: 是否在笔记中生成截图占位
        :param formats: 包含 'link' 或 'screenshot' 的列表
        :param style: GPT 输出风格
        :param extras: GPT 额外参数
        :param video_img_urls: 截图 URL 列表
        :param _fallback_marker: 内部使用，回调层传入的"已尝试过的 provider_id"集合；
                                 命中后我们会在失败时跳过 fallback（避免死循环）
        :param _primary_provider_id: 内部使用，回调层传入的主 provider_id，失败时用于日志
        :return: 生成的 Markdown 字符串
        :raises LLMFallbackableError: 当 Provider 因 402/401/网络错误等可恢复原因失败，
                 让上层 `_summarize_with_fallback` 切换到下一个 Provider
        """
        from app.services.llm_fallback import LLMFallbackableError

        task_id = markdown_cache_file.stem
        self._update_status(task_id, TaskStatus.SUMMARIZING)

        source = GPTSource(
            title=audio_meta.title,
            segment=transcript.segments,
            tags=audio_meta.raw_info.get("tags", []),
            screenshot=screenshot,
            video_img_urls=video_img_urls,
            link=link,
            _format=formats,
            style=style,
            extras=extras,
            checkpoint_key=task_id,
        )

        try:
            markdown = gpt.summarize(source)
            markdown_cache_file.write_text(markdown, encoding="utf-8")
            logger.info(f"GPT 总结并缓存成功 ({markdown_cache_file})")
            return markdown
        except Exception as exc:
            logger.error(f"GPT 总结失败：{exc}")
            # 是否属于可 fallback 的 Provider 错误（402/401/网络/超时等）？
            if LLMFallbackableError.is_fallbackable(exc):
                # 同一个 Provider 已经失败过就别再 fallback 回去（避免死循环）
                if _fallback_marker is not None and _primary_provider_id:
                    _fallback_marker.add(_primary_provider_id)
                raise LLMFallbackableError(str(exc)) from exc
            self._handle_exception(task_id, exc)
            raise

    def _post_process_markdown(
        self,
        markdown: str,
        video_path: Optional[Path],
        formats: List[str],
        audio_meta: AudioDownloadResult,
        platform: str,
    ) -> str:
        """
        对生成的 Markdown 做后期处理：插入截图和/或插入链接。

        :param markdown: 原始 Markdown 字符串
        :param video_path: 本地视频路径（可为 None）
        :param formats: 包含 'link' 或 'screenshot' 的列表
        :param audio_meta: AudioDownloadResult 元信息，用于链接替换
        :param platform: 平台标识，用于链接替换
        :return: 处理后的 Markdown 字符串
        """
        if "screenshot" in formats and video_path:
            try:
                markdown = self._insert_screenshots(markdown, video_path)
            except Exception as exc:
                logger.warning("截图插入失败，跳过该步骤")

        if "link" in formats:
            try:
                markdown = replace_content_markers(markdown, video_id=audio_meta.video_id, platform=platform)
            except Exception as e:
                logger.warning(f"链接插入失败，跳过该步骤：{e}")

        # 目录放最后重建：基于真实标题确定性生成可点击目录，避免 LLM 输出格式不一致
        if "toc" in formats:
            try:
                markdown = rebuild_toc(markdown)
            except Exception as e:
                logger.warning(f"目录重建失败，跳过该步骤：{e}")

        return markdown

    def _insert_screenshots(self, markdown: str, video_path: Path) -> str | None | Any:
        """
        扫描 Markdown 文本中所有 Screenshot 标记，并替换为实际生成的截图链接。

        :param markdown: 含有 *Screenshot-mm:ss 或 Screenshot-[mm:ss] 标记的 Markdown 文本
        :param video_path: 本地视频文件路径
        :return: 替换后的 Markdown 字符串
        """
        matches: List[Tuple[str, int]] = extract_screenshot_timestamps(markdown)
        for idx, (marker, ts) in enumerate(matches):
            try:
                img_path = generate_screenshot(str(video_path), str(IMAGE_OUTPUT_DIR), ts, idx)
                filename = Path(img_path).name
                # 构建前端可访问的 URL，例如 /static/screenshots/{filename}
                img_url = f"{IMAGE_BASE_URL.rstrip('/')}/{filename}"
                markdown = markdown.replace(marker, f"![]({img_url})", 1)
            except Exception as exc:
                logger.error(f"生成截图失败 (timestamp={ts})：{exc}")
                # self._handle_exception(task_id, exc)
                return None
        return markdown

    @staticmethod
    def _extract_screenshot_timestamps(markdown: str) -> List[Tuple[str, int]]:
        """
        从 Markdown 文本中提取所有 '*Screenshot-mm:ss' 或 'Screenshot-[mm:ss]' 标记，
        返回 [(原始标记文本, 时间戳秒数), ...] 列表。

        :param markdown: 原始 Markdown 文本
        :return: 标记与对应时间戳秒数的列表
        """
        return extract_screenshot_timestamps(markdown)

    def _save_metadata(self, video_id: str, platform: str, task_id: str, user_id: Optional[int] = None) -> None:
        try:
            insert_video_task(video_id=video_id, platform=platform, task_id=task_id, user_id=user_id)
            logger.info(f"已保存任务记录到数据库 (video_id={video_id}, platform={platform}, task_id={task_id})")
        except Exception as e:
            logger.error(f"保存任务记录失败：{e}")

    def _notify_task_completed(self, task_id: Optional[str], user_id: Optional[int], title: str) -> None:
        """笔记生成成功后, 若用户开启了邮件通知则发一封提醒邮件. 失败不影响主流程."""
        if not task_id or not user_id:
            return
        try:
            from app.db.engine import SessionLocal
            from app.db.models.users import User
            from app.utils.mailer import send_task_completed_email

            db = SessionLocal()
            try:
                user = db.query(User).filter(User.id == user_id).first()
                if user and user.email_notify_enabled and user.email:
                    send_task_completed_email(to=user.email, title=title, task_id=task_id)
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"发送任务完成邮件异常 (task_id={task_id}): {e}")
