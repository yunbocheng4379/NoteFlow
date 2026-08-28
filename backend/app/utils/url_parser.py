import re
import hashlib
from typing import Optional
import requests


def extract_video_id(url: str, platform: str) -> Optional[str]:
    """
    从视频链接中提取视频 ID

    :param url: 视频链接
    :param platform: 平台名（bilibili / youtube / douyin）
    :return: 提取到的视频 ID 或 None
    """
    if platform == "bilibili":
        # 如果是短链接，则解析真实链接
        if "b23.tv" in url:
            resolved_url = resolve_bilibili_short_url(url)
            if resolved_url:
                url = resolved_url

        # 匹配 BV号（如 BV1vc411b7Wa）
        match = re.search(r"BV([0-9A-Za-z]+)", url)
        return f"BV{match.group(1)}" if match else None

    elif platform == "youtube":
        # 匹配 watch?v=xxxxx、youtu.be/xxxxx 或 shorts/xxxxx，ID 长度通常为 11
        match = re.search(
            r"(?:[?&]v=|youtu\.be/|youtube\.com/shorts/)([0-9A-Za-z_-]{11})",
            url,
        )
        return match.group(1) if match else None

    elif platform == "douyin":
        # 匹配 douyin.com/video/1234567890123456789
        match = re.search(r"/video/(\d+)", url)
        return match.group(1) if match else None

    elif platform == "kuaishou":
        # 匹配标准快手视频链接及带 photoId 的详情链接
        match = re.search(r"/short-video/([0-9A-Za-z]+)|[?&]photoId=([0-9A-Za-z]+)", url)
        if match:
            return match.group(1) or match.group(2)
        return None

    elif platform == "baidu_pan":
        # cloud://baidu_pan/{fs_id}?name=xxx
        match = re.search(r"cloud://baidu_pan/(\d+)", url)
        return f"baidu_{match.group(1)}" if match else None

    return None


def get_task_video_id(url: str, platform: str) -> str:
    """Return a stable non-empty identifier for persisting a video task.

    Some platform share links (notably Kuaishou short links) do not embed the
    resolved video ID in the URL. The task still needs to be persisted so its
    original URL can be restored from history, therefore fall back to a stable
    URL fingerprint when extraction is not possible.
    """
    video_id = extract_video_id(url, platform)
    if video_id:
        return video_id

    normalized_url = str(url).strip()
    digest = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()[:32]
    return f"{platform}_{digest}"


def get_original_video_url(
    video_url: Optional[str], platform: str, video_id: Optional[str] = None
) -> str:
    """Return the best web URL for a video, including legacy task fallbacks.

    Older ``video_tasks`` rows may not have ``video_url`` because the platform
    adapter could not extract an ID when the task was created.  For Douyin and
    Kuaishou, a persisted platform video ID is still enough to reconstruct the
    stable detail page URL.
    """
    candidate = str(video_url or "").strip()
    if re.match(r"^https?://", candidate, flags=re.IGNORECASE):
        return candidate

    normalized_platform = str(platform or "").strip().lower()
    normalized_id = str(video_id or "").strip()
    if normalized_platform == "douyin" and re.fullmatch(r"\d+", normalized_id):
        return f"https://www.douyin.com/video/{normalized_id}"
    if normalized_platform == "kuaishou" and re.fullmatch(r"[0-9A-Za-z]+", normalized_id):
        return f"https://www.kuaishou.com/short-video/{normalized_id}"
    return ""


def resolve_bilibili_short_url(short_url: str) -> Optional[str]:
    """
    解析哔哩哔哩短链接以获取真实视频链接

    :param short_url: Bilibili短链接（如"https://b23.tv/xxxxxx"）
    :return: 真实的视频链接或None
    """
    try:
        response = requests.head(short_url, allow_redirects=True)
        return response.url
    except requests.RequestException as e:
        print(f"Error resolving short URL: {e}")
        return None
