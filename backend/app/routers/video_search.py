from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.services.video_search import search_all
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


@router.get("/video_search")
async def video_search(
    q: str = Query(..., description="搜索关键词"),
    limit: int = Query(20, description="每平台条数上限"),
):
    keyword = (q or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    if len(keyword) > 50:
        raise HTTPException(status_code=400, detail="搜索关键词过长（最多 50 字符）")

    per_platform = max(1, min(int(limit), 20))

    items, platform_status = await search_all(keyword, per_platform)
    payload = {
        "keyword": keyword,
        "total": len(items),
        "items": [asdict(i) for i in items],
        "platform_status": platform_status,
    }
    return R.success(data=payload)
