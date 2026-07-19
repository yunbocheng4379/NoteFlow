import os
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.utils.export import ExportUtils

router = APIRouter(prefix="/export", tags=["export"])

SUPPORTED = {"md", "pdf", "html", "docx", "png"}


class ExportRequest(BaseModel):
    content: str
    format: str          # md / pdf / html / docx / png
    title: str = "note"


def _safe_title(title: str) -> str:
    """去掉文件名非法字符"""
    return re.sub(r'[\\/:*?"<>|]', "_", title).strip() or "note"


@router.post("")
def export_note(
    body: ExportRequest,
    current_user: User = Depends(get_current_user),
):
    fmt = body.format.lower()
    if fmt not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"不支持的格式: {fmt}，支持：{', '.join(SUPPORTED)}")

    title = _safe_title(body.title)

    try:
        exporter = ExportUtils()
        file_path = exporter.export(output_format=fmt, title=title, content=body.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=500, detail="导出文件未生成")

    media_map = {
        "md":   "text/markdown",
        "pdf":  "application/pdf",
        "html": "text/html",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "png":  "image/png",
    }

    ext = os.path.splitext(file_path)[1].lstrip(".")
    media_type = media_map.get(ext, "application/octet-stream")

    filename = os.path.basename(file_path)
    ascii_name = re.sub(r'[^\x00-\x7f]', '_', filename)
    encoded_name = quote(filename, safe='')
    content_disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers={"Content-Disposition": content_disposition},
    )
