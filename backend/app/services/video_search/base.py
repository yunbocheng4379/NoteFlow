from dataclasses import dataclass
from typing import Literal, Optional

PlatformStatus = Literal["ok", "failed"]
Platform = Literal["bilibili", "youtube"]


@dataclass
class SearchResult:
    platform: Platform
    video_url: str
    title: str
    cover_url: Optional[str]
    author: Optional[str]
    duration: Optional[int]
    publish_time: Optional[str]
    play_count: Optional[int]


def bilibili_duration_to_seconds(s: str) -> int:
    """B站搜索 API 返回的 duration 字符串（如 "10:45" / "1:02:03"）转秒。无效返回 0。"""
    if not s or not isinstance(s, str):
        return 0
    parts = s.split(":")
    try:
        parts_int = [int(p) for p in parts]
    except ValueError:
        return 0
    if len(parts_int) == 1:
        return parts_int[0]
    if len(parts_int) == 2:
        return parts_int[0] * 60 + parts_int[1]
    if len(parts_int) == 3:
        return parts_int[0] * 3600 + parts_int[1] * 60 + parts_int[2]
    return 0
