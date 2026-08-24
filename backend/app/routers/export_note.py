import os
import json

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.db.engine import get_db
from app.db.models.video_tasks import VideoTask
from app.services.note import NOTE_OUTPUT_DIR
from app.db.models.users import User
from app.utils.export import ExportUtils
from app.utils.export_helpers import (
    SUPPORTED_EXPORT_FORMATS,
    MEDIA_TYPE_MAP,
    safe_title,
    build_content_disposition,
)

router = APIRouter(prefix="/export", tags=["export"])


class ExportRequest(BaseModel):
    content: str
    format: str          # md / pdf / html / docx / png
    title: str = "note"


@router.post("")
def export_note(
    body: ExportRequest,
    current_user: User = Depends(get_current_user),
):
    fmt = body.format.lower()
    if fmt not in SUPPORTED_EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail=f"不支持的格式: {fmt}，支持：{', '.join(SUPPORTED_EXPORT_FORMATS)}")

    title = safe_title(body.title)

    try:
        exporter = ExportUtils()
        file_path = exporter.export(output_format=fmt, title=title, content=body.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=500, detail="导出文件未生成")

    ext = os.path.splitext(file_path)[1].lstrip(".")
    media_type = MEDIA_TYPE_MAP.get(ext, "application/octet-stream")

    filename = os.path.basename(file_path)
    content_disposition = build_content_disposition(filename)

    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers={"Content-Disposition": content_disposition},
    )


@router.get("/transcript/{task_id}")
def export_transcript(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出当前用户任务的原始转写文本，不包含时间戳。"""
    task = (
        db.query(VideoTask)
        .filter(VideoTask.task_id == task_id, VideoTask.user_id == current_user.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或无权访问")

    transcript_data = None
    result_data = None
    transcript_path = NOTE_OUTPUT_DIR / f"{task_id}_transcript.json"
    result_path = NOTE_OUTPUT_DIR / f"{task_id}.json"

    for path in (transcript_path, result_path):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail="转写结果读取失败") from exc

        if path == transcript_path:
            transcript_data = payload
        else:
            result_data = payload
            transcript_data = payload.get("transcript")
        if transcript_data:
            break

    if not transcript_data:
        raise HTTPException(status_code=404, detail="暂无可导出的转写内容")

    from app.utils.transcript_export import build_transcript_text

    content = build_transcript_text(transcript_data)
    if not content:
        raise HTTPException(status_code=404, detail="暂无可导出的转写内容")

    audio_meta = (result_data or {}).get("audio_meta") or {}
    title = task.custom_title or audio_meta.get("title") or task_id
    filename = f"{safe_title(title)}.txt"

    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": build_content_disposition(filename)},
    )
