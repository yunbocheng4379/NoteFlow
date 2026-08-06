"""
笔记格式计费率的 DAO 层，提供 CRUD + 费率查询能力.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.credit_format_pricing import CreditFormatPricing

DEFAULT_FORMAT_RATES = [
    {"format_key": "toc", "rate_per_minute": 1, "description": "目录 (成本低, 仅解析标题生成锚点)"},
    {"format_key": "link", "rate_per_minute": 1, "description": "原片跳转 (成本低, 仅插入时间戳文本)"},
    {"format_key": "screenshot", "rate_per_minute": 3, "description": "原片截图 (成本高, 需抽帧+视觉模型分析)"},
    {"format_key": "summary", "rate_per_minute": 1, "description": "AI总结 (成本低, 仅多生成一段总结文字)"},
]


class CreditFormatPricingDAO:
    def __init__(self, db: Session):
        self.db = db

    # ---- 查询 ----

    def get_all(self) -> list[CreditFormatPricing]:
        stmt = select(CreditFormatPricing).order_by(CreditFormatPricing.id.asc())
        return list(self.db.execute(stmt).scalars().all())

    def get_by_format_key(self, format_key: str) -> Optional[CreditFormatPricing]:
        stmt = select(CreditFormatPricing).where(CreditFormatPricing.format_key == format_key)
        return self.db.execute(stmt).scalars().first()

    def get_rate_map(self, format_keys: Optional[list[str]] = None) -> dict[str, int]:
        """返回 {format_key: rate_per_minute}，仅含 is_active=1 的行。传 format_keys 时只查这些 key。"""
        stmt = select(CreditFormatPricing.format_key, CreditFormatPricing.rate_per_minute).where(
            CreditFormatPricing.is_active == 1
        )
        if format_keys:
            stmt = stmt.where(CreditFormatPricing.format_key.in_(format_keys))
        rows = self.db.execute(stmt).all()
        return {row[0]: int(row[1]) for row in rows}

    # ---- 增 ----

    def create(
        self,
        format_key: str,
        rate_per_minute: int = 0,
        is_active: int = 1,
        description: Optional[str] = None,
    ) -> CreditFormatPricing:
        row = CreditFormatPricing(
            format_key=format_key,
            rate_per_minute=rate_per_minute,
            is_active=is_active,
            description=description,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    # ---- 改 ----

    def update(
        self,
        format_key: str,
        *,
        rate_per_minute: Optional[int] = None,
        is_active: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[CreditFormatPricing]:
        row = self.get_by_format_key(format_key)
        if not row:
            return None
        if rate_per_minute is not None:
            row.rate_per_minute = rate_per_minute
        if is_active is not None:
            row.is_active = is_active
        if description is not None:
            row.description = description
        self.db.commit()
        self.db.refresh(row)
        return row

    # ---- 删 ----

    def delete(self, format_key: str) -> bool:
        row = self.get_by_format_key(format_key)
        if not row:
            return False
        self.db.delete(row)
        self.db.commit()
        return True

    # ---- 批量初始化（仅当表为空时） ----

    def seed_default_if_empty(self) -> list[CreditFormatPricing]:
        if self.get_all():
            return self.get_all()
        for d in DEFAULT_FORMAT_RATES:
            self.create(**d)
        return self.get_all()
