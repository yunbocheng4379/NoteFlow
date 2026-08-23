"""充值套餐的幂等初始化。"""

from sqlalchemy import select

from app.db.engine import SessionLocal
from app.db.models.recharge_packages import RechargePackage


DEFAULT_RECHARGE_PACKAGES = (
    {
        "code": "PKG_WELFARE",
        "name": "福利包",
        "price_cents": 99,
        "credits": 50,
        "unit_price_text": "¥0.0198/电力",
        "sort_order": 1,
        "badge": "新人专享",
        "is_active": 1,
        "is_one_time": 1,
        "description": "新人首次充值专享，送 50 电力",
    },
    {
        "code": "PKG_BASIC",
        "sort_order": 2,
    },
    {
        "code": "PKG_STANDARD",
        "sort_order": 3,
    },
    {
        "code": "PKG_PRO",
        "sort_order": 4,
    },
)


def seed_default_recharge_packages() -> None:
    """补齐福利包并调整内置套餐顺序，不覆盖管理员可能调整的价格。"""
    db = SessionLocal()
    try:
        for data in DEFAULT_RECHARGE_PACKAGES:
            package = db.execute(
                select(RechargePackage).where(RechargePackage.code == data["code"])
            ).scalar_one_or_none()
            if package is None:
                if data["code"] != "PKG_WELFARE":
                    continue
                db.add(RechargePackage(**data))
                continue

            package.sort_order = data["sort_order"]
            if data["code"] == "PKG_WELFARE":
                package.is_one_time = 1
                package.is_active = 1

        db.commit()
    finally:
        db.close()
