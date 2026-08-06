import re

SUPPORTED_EXPORT_FORMATS = {"md", "pdf", "html", "docx", "png"}

MEDIA_TYPE_MAP = {
    "md":   "text/markdown",
    "pdf":  "application/pdf",
    "html": "text/html",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "png":  "image/png",
}


def safe_title(title: str) -> str:
    """去掉文件名非法字符"""
    return re.sub(r'[\\/:*?"<>|]', "_", title).strip() or "note"


def build_content_disposition(filename: str) -> str:
    from urllib.parse import quote

    ascii_name = re.sub(r'[^\x00-\x7f]', '_', filename)
    encoded_name = quote(filename, safe='')
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"
