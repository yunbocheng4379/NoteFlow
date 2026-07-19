"""
计费定价服务 - 根据 model + duration 计算所需电力
"""
import math
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.credit_pricing import CreditPricing
from app.utils.logger import get_logger

logger = get_logger(__name__)

DEFAULT_FALLBACK_RATE = 3  # 数据库不可用时的兜底
DEFAULT_MODEL_KEY = "__default__"
MIN_CREDITS_PER_TASK = 1  # 最低电力消耗 (防 0 秒视频白嫖)


def get_model_rate(db: Session, model_name: str) -> int:
    """
    获取模型的每分钟电力消耗率.
    未匹配 model_name 时使用 is_default=1 的兜底行.
    极端情况 (DB 无 default 行) 使用硬编码 DEFAULT_FALLBACK_RATE.
    """
    if model_name:
        row = db.execute(
            select(CreditPricing.rate_per_minute)
            .where(CreditPricing.model_name == model_name, CreditPricing.is_active == 1)
        ).first()
        if row:
            return int(row[0])

    # 兜底: is_default=1
    row = db.execute(
        select(CreditPricing.rate_per_minute)
        .where(CreditPricing.is_default == 1, CreditPricing.is_active == 1)
    ).first()
    if row:
        return int(row[0])

    logger.warning(f"credit_pricing 无 default 行, 使用硬编码 rate={DEFAULT_FALLBACK_RATE}")
    return DEFAULT_FALLBACK_RATE


def calculate_required_credits(db: Session, model_name: Optional[str], duration_sec: Optional[float]) -> int:
    """
    计算生成一份笔记所需电力: ceil(duration_min) * rate.
    duration_sec <= 0 或 None 时按 1 分钟 * rate 计 (但不少于 MIN_CREDITS_PER_TASK).
    """
    rate = get_model_rate(db, model_name or "")
    if not duration_sec or duration_sec <= 0:
        minutes = 1
    else:
        minutes = math.ceil(duration_sec / 60.0)

    credits = minutes * rate
    return max(MIN_CREDITS_PER_TASK, credits)
