"""
计费定价服务 - 根据 model + format + duration 计算所需电力

费率模型:
  total_rate_per_minute = model_rate + Σ(active_format_rate for format in selected_formats)
  required_credits      = max(1, ceil(duration_min) * total_rate_per_minute)

format 部分对应前端 note_formats (toc/link/screenshot/summary), 未在 credit_format_pricing
表中或 is_active=0 的格式按 0 处理, 不产生额外消耗.
"""
import math
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.credit_format_pricing_dao import CreditFormatPricingDAO
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


def get_format_rate_map(db: Session, formats: Optional[Iterable[str]] = None) -> dict[str, int]:
    """
    查 credit_format_pricing, 返回 {format_key: rate_per_minute}.
    只包含 is_active=1 且 format_key 在 formats 里的行. formats 为 None 或空视为「未勾选任何格式」,
    返回空 dict (即不叠加任何格式费). 若上层要拿到全表启用项, 请直接调 DAO.get_rate_map(None).
    """
    keys = [f for f in (formats or []) if f]
    if not keys:
        return {}
    return CreditFormatPricingDAO(db).get_rate_map(keys)


def calculate_required_credits(
    db: Session,
    model_name: Optional[str],
    duration_sec: Optional[float],
    formats: Optional[Iterable[str]] = None,
) -> int:
    """
    计算生成一份笔记所需电力: ceil(duration_min) * (model_rate + Σ format_rate).
    duration_sec <= 0 或 None 时按 1 分钟计费 (但不少于 MIN_CREDITS_PER_TASK).
    formats 传 note_formats.value 列表 (如 ["toc","link","screenshot"]); None 或空视为纯模型费率.
    """
    model_rate = get_model_rate(db, model_name or "")
    fmt_rate_map = get_format_rate_map(db, formats)
    fmt_rate_sum = sum(fmt_rate_map.values())
    total_rate = model_rate + fmt_rate_sum

    if not duration_sec or duration_sec <= 0:
        minutes = 1
    else:
        minutes = math.ceil(duration_sec / 60.0)

    credits = minutes * total_rate
    return max(MIN_CREDITS_PER_TASK, credits)
