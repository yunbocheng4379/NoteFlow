"""
笔记格式计费率表迁移
=====================================
新库部署可直接走 init_db() (Base.metadata.create_all 会自动建表), 本脚本仅用于
已有数据库的手动升级: 建表 (幂等) + 播种默认费率 (仅当表为空时).

执行方式:
  cd backend && python -m app.db.migrate_add_credit_format_pricing
"""
from app.db.engine import SessionLocal, get_engine, Base
from app.db.models.credit_format_pricing import CreditFormatPricing  # noqa: F401 — 触发模型导入以创建表
from app.db.credit_format_pricing_dao import CreditFormatPricingDAO


def run():
    Base.metadata.create_all(get_engine())  # 确保表已创建（幂等）
    db = SessionLocal()
    try:
        dao = CreditFormatPricingDAO(db)
        rows = dao.seed_default_if_empty()
        print(f"[migrate_add_credit_format_pricing] 当前格式计费配置数: {len(rows)}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
