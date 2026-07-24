# app/routers/note.py
import json
import os
import uuid
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Depends, Request
from pydantic import BaseModel, Field, field_validator
from dataclasses import asdict

from app.auth.dependencies import get_current_user
from app.db.engine import get_db
from app.db.models.users import User
from app.db.video_task_dao import get_task_by_video, insert_video_task, update_task_status
from sqlalchemy.orm import Session
from app.enmus.exception import NoteErrorEnum
from app.enmus.note_enums import DownloadQuality
from app.exceptions.note import NoteError
from app.exceptions.provider import ProviderError
from app.services.note import NoteGenerator, logger
from app.services.task_serial_executor import task_serial_executor
from app.utils.error_messages import translate_download_error
from app.utils.response import ResponseWrapper as R
from app.utils.url_parser import extract_video_id
from app.validators.video_url_validator import is_supported_video_url
from app.enmus.platform_status import PlatformDisabledError
from fastapi.responses import StreamingResponse
import httpx
from app.enmus.task_status_enums import TaskStatus

router = APIRouter()


class RecordRequest(BaseModel):
    video_id: str
    platform: str


class VideoRequest(BaseModel):
    video_url: str
    platform: str
    quality: DownloadQuality
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    model_name: str
    provider_id: str
    task_id: Optional[str] = None
    format: Optional[list] = []
    style: str = None
    extras: Optional[str] = None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    prefetched_transcript: Optional[dict] = None
    free_generate: Optional[bool] = False
    collection_id: Optional[int] = None

    @field_validator("video_url")
    def validate_supported_url(cls, v):
        url = str(v)
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https"):
            if not is_supported_video_url(url):
                raise NoteError(code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                                message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message)
        return v


NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
UPLOAD_DIR = "uploads"


def save_note_to_file(task_id: str, note):
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
        json.dump(asdict(note), f, ensure_ascii=False, indent=2)


def _persist_prefetched_transcript(task_id: str, transcript: dict) -> None:
    segments = transcript.get("segments") or []
    cleaned_segments = []
    for s in segments:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        cleaned_segments.append({
            "start": float(s.get("start", 0)),
            "end": float(s.get("end", 0)),
            "text": text,
        })
    if not cleaned_segments:
        raise ValueError("prefetched_transcript 没有可用的 segments")

    full_text = transcript.get("full_text") or " ".join(s["text"] for s in cleaned_segments)
    payload = {
        "language": transcript.get("language") or "zh",
        "full_text": full_text,
        "segments": cleaned_segments,
    }

    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    target = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}_transcript.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f"已写入客户端预取字幕缓存: {target} ({len(cleaned_segments)} 段)")


def run_note_task(task_id: str, video_url: str, platform: str, quality: DownloadQuality,
                  link: bool = False, screenshot: bool = False, model_name: str = None,
                  provider_id: str = None, _format: list = None, style: str = None,
                  extras: str = None, video_understanding: bool = False,
                  video_interval=0, grid_size=[], user_id: Optional[int] = None,
                  collection_id: Optional[int] = None):

    if not model_name or not provider_id:
        raise HTTPException(status_code=400, detail="请选择模型和提供者")

    def _execute_note_task():
        return NoteGenerator(user_id=user_id).generate(
            video_url=video_url,
            platform=platform,
            quality=quality,
            task_id=task_id,
            model_name=model_name,
            provider_id=provider_id,
            link=link,
            _format=_format,
            style=style,
            extras=extras,
            screenshot=screenshot,
            video_understanding=video_understanding,
            video_interval=video_interval,
            grid_size=grid_size,
            user_id=user_id,
        )

    logger.info(f"任务进入执行队列 (task_id={task_id}, user_id={user_id})")
    note = task_serial_executor.run(_execute_note_task)
    logger.info(f"Note generated: {task_id}")
    if not note or not note.markdown:
        logger.warning(f"任务 {task_id} 执行失败，跳过保存")
        return
    save_note_to_file(task_id, note)

    if collection_id and user_id:
        from app.db import note_collection_dao
        note_collection_dao.add_task_to_collection_on_generate(collection_id, user_id, task_id)

    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().index_task(task_id)
    except Exception as e:
        logger.warning(f"向量索引失败（不影响笔记）: {e}")


@router.delete('/tasks/{task_id}')
def delete_task(task_id: str, current_user: User = Depends(get_current_user)):
    """删除任务及其所有关联数据：DB 记录、note_results 文件、ChromaDB 向量索引。"""
    from app.db.engine import get_db
    from app.db.models.video_tasks import VideoTask

    # 1. 校验归属
    db = next(get_db())
    try:
        row = db.query(VideoTask).filter_by(task_id=task_id, user_id=current_user.id).first()
        if not row:
            return R.error(msg='任务不存在或无权限删除', code=404)
        db.delete(row)
        db.commit()
    except Exception as e:
        logger.error(f"删除 DB 记录失败 (task_id={task_id}): {e}")
        return R.error(msg='删除失败，请稍后重试')
    finally:
        db.close()

    # 1.5 从所有笔记合集中移出该笔记，避免合集笔记数悬空不更新
    try:
        from app.db.note_collection_dao import remove_task_from_all_collections
        remove_task_from_all_collections(task_id)
    except Exception as e:
        logger.warning(f"清理合集关联失败 (task_id={task_id}): {e}")

    # 2. 删除 note_results 下所有相关文件
    deleted_files = []
    for fname in os.listdir(NOTE_OUTPUT_DIR) if os.path.isdir(NOTE_OUTPUT_DIR) else []:
        if fname.startswith(task_id):
            try:
                os.remove(os.path.join(NOTE_OUTPUT_DIR, fname))
                deleted_files.append(fname)
            except Exception as e:
                logger.warning(f"删除文件失败 {fname}: {e}")

    # 3. 删除 ChromaDB 向量索引（非阻塞，失败不影响结果）
    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().delete_index(task_id)
    except Exception as e:
        logger.warning(f"删除向量索引失败 (task_id={task_id}): {e}")

    logger.info(f"任务已删除: task_id={task_id}, files={deleted_files}")
    return R.success(msg='删除成功')


@router.post("/upload")
async def upload(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        file_location = os.path.join(UPLOAD_DIR, file.filename)

        with open(file_location, "wb+") as f:
            f.write(await file.read())

        return R.success({"url": f"/uploads/{file.filename}"})
    except Exception as e:
        logger.error(f"文件上传失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_upload_error
        return R.error(msg=translate_upload_error(e))


@router.post("/generate_note")
def generate_note(data: VideoRequest, background_tasks: BackgroundTasks,
                  current_user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    try:
        if not data.prefetched_transcript:
            from app.db import transcriber_config_dao
            from app.routers.config import _check_whisper_model_exists, _check_mlx_whisper_model_exists, _downloading

            cfg = transcriber_config_dao.get_transcriber_config(current_user.id)
            ttype = cfg["transcriber_type"]
            size = cfg["whisper_model_size"]

            if ttype == "fast-whisper":
                ready = _check_whisper_model_exists(size, "whisper")
                downloading = _downloading.get(size) == "downloading"
            elif ttype == "mlx-whisper":
                ready = _check_mlx_whisper_model_exists(size)
                downloading = _downloading.get(f"mlx-{size}") == "downloading"
            else:
                ready = True
                downloading = False

            if not ready:
                reason = (
                    f"转写模型 {ttype} / {size} 尚未下载就绪"
                    + ("，正在下载中，请稍候" if downloading else "，请先在「设置 → 音频转写配置」页下载")
                )
                logger.warning(f"拒绝 generate_note：{reason}")
                return R.error(
                    msg=reason,
                    code=300102,
                    data={
                        "reason": "transcriber_model_not_ready",
                        "transcriber_type": ttype,
                        "model_size": size,
                        "downloading": downloading,
                    },
                )

        video_id = extract_video_id(data.video_url, data.platform)

        # 平台禁用检查
        from app.enmus.platform_status import check_platform_enabled
        check_platform_enabled(data.platform)

        from app.services.model import ModelService
        try:
            ModelService.assert_model_accessible(data.provider_id, data.model_name, current_user)
        except ProviderError as e:
            return R.error(msg=e.message, code=e.code)

        if data.task_id:
            task_id = data.task_id
            logger.info(f"重试模式，复用已有 task_id={task_id}")
        else:
            task_id = str(uuid.uuid4())

        # ==================== 电力预扣费 ====================
        # free_generate=True 时（首次免费体验）跳过扣费
        required = 0
        if not data.free_generate:
            from app.services.billing import pricing as billing_pricing, credit_ledger
            from app.services.billing.exceptions import InsufficientCreditError

            duration_sec = 0.0
            if not data.prefetched_transcript:
                try:
                    downloader = NoteGenerator(user_id=current_user.id)._get_downloader(data.platform)
                    preview_meta = downloader.download(data.video_url, skip_download=True)
                    duration_sec = float(getattr(preview_meta, "duration", 0) or 0)
                except Exception as e:
                    logger.warning(f"generate_note 元数据解析失败: {e}")
                    return R.error(msg=f"视频信息获取失败: {e}", code=2001)

            required = billing_pricing.calculate_required_credits(db, data.model_name, duration_sec)

            try:
                credit_ledger.consume(
                    db,
                    user_id=current_user.id,
                    amount=required,
                    task_id=task_id,
                    model_name=data.model_name,
                    note=f"生成笔记: {(data.video_url or '')[:80]}",
                )
                db.commit()
            except InsufficientCreditError as ic:
                db.rollback()
                return R.error(msg=ic.message, code=ic.code, data=ic.data)
            except Exception:
                db.rollback()
                raise
        # ==================== 电力预扣费结束 ====================

        NoteGenerator(user_id=current_user.id)._update_status(task_id, TaskStatus.PENDING)

        if data.prefetched_transcript:
            try:
                _persist_prefetched_transcript(task_id, data.prefetched_transcript)
            except Exception as e:
                logger.warning(f"写入预取字幕失败 (task_id={task_id}): {e}")

        # 写入 video_task 记录，绑定 user_id (实际扣费额已在流水中)
        if video_id:
            insert_video_task(
                video_id=video_id,
                platform=data.platform,
                task_id=task_id,
                user_id=current_user.id,
                video_url=data.video_url,
                model_name=data.model_name,
                credits_used=required,
            )

        background_tasks.add_task(
            run_note_task, task_id, data.video_url, data.platform, data.quality,
            data.link, data.screenshot, data.model_name, data.provider_id,
            data.format, data.style, data.extras, data.video_understanding,
            data.video_interval, data.grid_size, current_user.id,
            data.collection_id,
        )
        return R.success({"task_id": task_id})
    except NoteError as e:
        logger.error(f"generate_note 参数错误: {e.message}", exc_info=True)
        return R.error(msg=e.message, code=e.code)
    except Exception as e:
        from app.enmus.platform_status import PlatformDisabledError
        if isinstance(e, PlatformDisabledError):
            logger.warning(f"平台 {e.platform} 已禁用，拒绝生成请求")
            return R.error(msg=e.message, code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)
        logger.error(f"generate_note 异常: {e}", exc_info=True)
        return R.error(msg="提交任务失败，请稍后重试")


@router.get("/task_status/{task_id}")
def get_task_status(task_id: str, current_user: User = Depends(get_current_user)):
    status_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.status.json")
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")

    if os.path.exists(status_path):
        with open(status_path, "r", encoding="utf-8") as f:
            status_content = json.load(f)

        status = status_content.get("status")
        message = status_content.get("message", "")

        if status == TaskStatus.SUCCESS.value:
            if os.path.exists(result_path):
                with open(result_path, "r", encoding="utf-8") as rf:
                    result_content = json.load(rf)
                return R.success({
                    "status": status,
                    "result": result_content,
                    "message": message,
                    "task_id": task_id,
                })
            else:
                return R.success({
                    "status": TaskStatus.PENDING.value,
                    "message": "任务完成，但结果文件未找到",
                    "task_id": task_id,
                })

        if status == TaskStatus.FAILED.value:
            return R.error(message or "任务失败", code=500)

        # 进行中：若已下载到封面/标题等元信息，提前返回供前端展示
        resp = {"status": status, "message": message, "task_id": task_id}
        meta_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    resp["meta"] = json.load(mf)
            except Exception:
                pass
        return R.success(resp)

    if os.path.exists(result_path):
        with open(result_path, "r", encoding="utf-8") as f:
            result_content = json.load(f)
        return R.success({"status": TaskStatus.SUCCESS.value, "result": result_content, "task_id": task_id})

    return R.success({"status": TaskStatus.PENDING.value, "message": "任务排队中", "task_id": task_id})


class UpdateNoteRequest(BaseModel):
    content: str


@router.put("/note/{task_id}")
def update_note_content(task_id: str, data: UpdateNoteRequest, current_user: User = Depends(get_current_user)):
    """编辑并保存笔记的 Markdown 正文，覆盖 note_results/{task_id}.json 中的 markdown 字段。"""
    from app.db.engine import get_db
    from app.db.models.video_tasks import VideoTask

    db = next(get_db())
    try:
        row = db.query(VideoTask).filter_by(task_id=task_id, user_id=current_user.id).first()
        if not row:
            return R.error(msg='任务不存在或无权限编辑', code=404)
    finally:
        db.close()

    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    if not os.path.exists(result_path):
        return R.error(msg='笔记内容不存在', code=404)

    try:
        with open(result_path, "r", encoding="utf-8") as f:
            result_content = json.load(f)
        result_content["markdown"] = data.content
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(result_content, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"保存笔记编辑失败 (task_id={task_id}): {e}")
        return R.error(msg='保存失败，请稍后重试')

    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().index_task(task_id)
    except Exception as e:
        logger.warning(f"重建向量索引失败 (task_id={task_id}): {e}")

    return R.success({"task_id": task_id, "markdown": data.content}, msg='保存成功')


@router.get("/tasks")
def list_tasks(current_user: User = Depends(get_current_user)):
    """返回当前用户所有任务的摘要列表。"""
    from app.db.engine import get_db
    from app.db.models.video_tasks import VideoTask
    db = next(get_db())
    try:
        rows = (
            db.query(VideoTask)
            .filter(VideoTask.user_id == current_user.id)
            .order_by(VideoTask.created_at.desc())
            .all()
        )
    finally:
        db.close()

    results = []
    for row in rows:
        task_id = row.task_id
        result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")

        title = ""
        cover_url = ""
        duration = 0

        if os.path.exists(result_path):
            try:
                with open(result_path, "r", encoding="utf-8") as f:
                    rc = json.load(f)
                meta = rc.get("audio_meta", {})
                title = meta.get("title", "")
                cover_url = meta.get("cover_url", "")
                duration = meta.get("duration", 0)
            except Exception:
                pass
        else:
            # 进行中的任务：结果文件还没有，尝试读取下载阶段提前落盘的元信息
            meta_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.meta.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as mf:
                        pm = json.load(mf)
                    title = pm.get("title", "")
                    cover_url = pm.get("cover_url", "")
                    duration = pm.get("duration", 0)
                except Exception:
                    pass

        # derive status: if result file exists, it's SUCCESS (handles legacy rows with no status column)
        status = row.status or ("SUCCESS" if os.path.exists(result_path) else "PENDING")

        results.append({
            "task_id": task_id,
            "video_id": row.video_id,
            "platform": row.platform,
            "video_url": row.video_url or "",
            "model_name": row.model_name or "",
            "credits_used": row.credits_used if row.credits_used is not None else 20,
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "completed_at": row.completed_at.isoformat() if row.completed_at else "",
            "status": status,
            "title": title,
            "cover_url": cover_url,
            "duration": duration,
            "batch_id": row.batch_id,
        })

    return R.success(results)


@router.get("/image_proxy")
async def image_proxy(request: Request, url: str):
    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": request.headers.get("User-Agent", ""),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="图片获取失败")

            content_type = resp.headers.get("Content-Type", "image/jpeg")
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Content-Type": content_type,
                },
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class VideoInfoRequest(BaseModel):
    video_url: str
    platform: str


CHANNEL_RESOLVABLE_PLATFORMS = {"bilibili", "youtube"}
BATCH_MAX_ITEMS = 30


class ChannelVideosRequest(BaseModel):
    channel_url: str
    platform: str


@router.post("/channel_videos")
def channel_videos(data: ChannelVideosRequest, current_user: User = Depends(get_current_user)):
    """
    解析 UP主空间/合集/收藏夹 (B站) 或频道/播放列表 (YouTube) 链接，
    列出其中的视频供批量生成前预览选择。仅支持 B站 + YouTube。
    """
    if data.platform not in CHANNEL_RESOLVABLE_PLATFORMS:
        return R.error(msg="该平台暂不支持频道/合集自动解析，请改用手动粘贴视频链接", code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)

    url = str(data.channel_url).strip()
    if not url:
        return R.error(msg="频道/合集链接不能为空")

    from app.enmus.platform_status import check_platform_enabled, PlatformDisabledError
    try:
        check_platform_enabled(data.platform)
    except PlatformDisabledError as e:
        return R.error(msg=e.message, code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)

    try:
        downloader = NoteGenerator(user_id=current_user.id)._get_downloader(data.platform)
        videos = downloader.list_channel_videos(url, limit=BATCH_MAX_ITEMS)
        return R.success({"platform": data.platform, "videos": videos})
    except Exception as e:
        logger.warning(f"channel_videos 解析异常 ({data.platform}): {e}")
        return R.error(msg="无法解析该频道/合集链接，请检查链接或稍后重试")


class BatchVideoItem(BaseModel):
    video_url: str
    platform: str


class GenerateNotesBatchRequest(BaseModel):
    items: List[BatchVideoItem] = Field(..., min_length=1, max_length=BATCH_MAX_ITEMS)
    quality: DownloadQuality
    model_name: str
    provider_id: str
    format: Optional[list] = []
    style: str = None
    extras: Optional[str] = None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    collection_id: Optional[int] = None

    @field_validator("items")
    def validate_items(cls, items):
        for item in items:
            url = str(item.video_url)
            parsed = urlparse(url)
            if parsed.scheme in ("http", "https") and not is_supported_video_url(url):
                raise NoteError(code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                                message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message)
        return items


@router.post("/generate_notes_batch")
def generate_notes_batch(data: GenerateNotesBatchRequest, background_tasks: BackgroundTasks,
                         current_user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    """
    批量提交笔记生成任务：逐条探测时长 -> 计费 -> 扣费 -> 建任务 -> 丢进现有执行队列。
    共享同一 batch_id 分组；遇到余额不足时停止后续处理，剩余项标记为失败。
    """
    try:
        from app.db import transcriber_config_dao
        from app.routers.config import _check_whisper_model_exists, _check_mlx_whisper_model_exists, _downloading

        cfg = transcriber_config_dao.get_transcriber_config(current_user.id)
        ttype = cfg["transcriber_type"]
        size = cfg["whisper_model_size"]
        if ttype == "fast-whisper":
            ready = _check_whisper_model_exists(size, "whisper")
            downloading = _downloading.get(size) == "downloading"
        elif ttype == "mlx-whisper":
            ready = _check_mlx_whisper_model_exists(size)
            downloading = _downloading.get(f"mlx-{size}") == "downloading"
        else:
            ready = True
            downloading = False

        if not ready:
            reason = (
                f"转写模型 {ttype} / {size} 尚未下载就绪"
                + ("，正在下载中，请稍候" if downloading else "，请先在「设置 → 音频转写配置」页下载")
            )
            logger.warning(f"拒绝 generate_notes_batch：{reason}")
            return R.error(
                msg=reason, code=300102,
                data={"reason": "transcriber_model_not_ready", "transcriber_type": ttype,
                      "model_size": size, "downloading": downloading},
            )

        from app.enmus.platform_status import check_platform_enabled
        from app.services.model import ModelService
        try:
            ModelService.assert_model_accessible(data.provider_id, data.model_name, current_user)
        except ProviderError as e:
            return R.error(msg=e.message, code=e.code)

        from app.services.billing import pricing as billing_pricing, credit_ledger
        from app.services.billing.exceptions import InsufficientCreditError

        batch_id = str(uuid.uuid4())
        results = []
        stopped = False

        for item in data.items:
            if stopped:
                results.append({"video_url": item.video_url, "task_id": None,
                                "success": False, "message": "余额不足，已停止后续任务"})
                continue

            try:
                check_platform_enabled(item.platform)
                video_id = extract_video_id(item.video_url, item.platform)
                task_id = str(uuid.uuid4())

                downloader = NoteGenerator(user_id=current_user.id)._get_downloader(item.platform)
                preview_meta = downloader.download(item.video_url, skip_download=True)
                duration_sec = float(getattr(preview_meta, "duration", 0) or 0)

                required = billing_pricing.calculate_required_credits(db, data.model_name, duration_sec)
                try:
                    credit_ledger.consume(
                        db, user_id=current_user.id, amount=required, task_id=task_id,
                        model_name=data.model_name, note=f"批量生成笔记: {(item.video_url or '')[:80]}",
                    )
                    db.commit()
                except InsufficientCreditError as ic:
                    db.rollback()
                    results.append({"video_url": item.video_url, "task_id": None,
                                    "success": False, "message": ic.message})
                    stopped = True
                    continue

                NoteGenerator(user_id=current_user.id)._update_status(task_id, TaskStatus.PENDING)

                if video_id:
                    insert_video_task(
                        video_id=video_id, platform=item.platform, task_id=task_id,
                        user_id=current_user.id, video_url=item.video_url,
                        model_name=data.model_name, credits_used=required, batch_id=batch_id,
                    )

                background_tasks.add_task(
                    run_note_task, task_id, item.video_url, item.platform, data.quality,
                    False, False, data.model_name, data.provider_id,
                    data.format, data.style, data.extras, data.video_understanding,
                    data.video_interval, data.grid_size, current_user.id,
                    data.collection_id,
                )
                results.append({"video_url": item.video_url, "task_id": task_id,
                                "success": True, "message": ""})
            except Exception as e:
                db.rollback()
                logger.warning(f"generate_notes_batch 单条处理失败 ({item.video_url}): {e}")
                results.append({"video_url": item.video_url, "task_id": None,
                                "success": False, "message": f"处理失败: {e}"})

        return R.success({"batch_id": batch_id, "results": results})
    except NoteError as e:
        logger.error(f"generate_notes_batch 参数错误: {e.message}", exc_info=True)
        return R.error(msg=e.message, code=e.code)
    except Exception as e:
        from app.enmus.platform_status import PlatformDisabledError
        if isinstance(e, PlatformDisabledError):
            logger.warning(f"平台 {e.platform} 已禁用，拒绝批量生成请求")
            return R.error(msg=e.message, code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)
        logger.error(f"generate_notes_batch 异常: {e}", exc_info=True)
        return R.error(msg="批量提交任务失败，请稍后重试")


@router.post("/video_info")
def video_info(data: VideoInfoRequest, current_user: User = Depends(get_current_user)):
    """
    轻量解析视频元信息（标题/封面/时长），不下载音视频、不进入生成流程。
    供「新建笔记」弹窗在用户粘贴链接后即时预览。
    """
    url = str(data.video_url).strip()
    if not url:
        return R.error(msg="视频链接不能为空")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not is_supported_video_url(url):
        return R.error(msg="暂不支持的视频链接", code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)

    # 平台禁用检查
    from app.enmus.platform_status import check_platform_enabled, PlatformDisabledError
    try:
        check_platform_enabled(data.platform)
    except PlatformDisabledError as e:
        return R.error(msg=e.message, code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code)

    try:
        downloader = NoteGenerator(user_id=current_user.id)._get_downloader(data.platform)
        result = downloader.download(url, skip_download=True)
        return R.success({
            "title": result.title,
            "cover_url": result.cover_url,
            "duration": result.duration,
            "platform": result.platform,
            "video_id": result.video_id,
        })
    except NoteError as e:
        logger.warning(f"video_info 解析失败: {e.message}")
        return R.error(msg=e.message, code=e.code)
    except Exception as e:
        logger.warning(f"video_info 解析异常 ({data.platform}): {e}", exc_info=True)
        friendly = translate_download_error(e, platform=data.platform)
        code = NoteErrorEnum.COOKIE_REQUIRED.code if "[NEED_COOKIE" in friendly else 500
        return R.error(msg=friendly, code=code)
