import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
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
