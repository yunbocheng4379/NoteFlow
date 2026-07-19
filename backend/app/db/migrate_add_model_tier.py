"""
One-time migration: add tier column to models table.

- 给 models 表加 tier (VARCHAR(16), default 'normal'), 已存在则跳过.
- tier 取值: 'normal' (普通用户可用) / 'pro' (仅 Pro 会员可用).

安全: 可重复运行.

用法:
  python -m app.db.migrate_add_model_tier
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(text("SHOW COLUMNS FROM models"))
        existing = {row[0] for row in result}

        if "tier" not in existing:
            conn.execute(text(
                "ALTER TABLE models ADD COLUMN tier VARCHAR(16) NOT NULL DEFAULT 'normal'"
            ))
            conn.commit()
            print("  added column: tier")
        else:
            print("  skipped (exists): tier")

    print("Migration done.")


if __name__ == "__main__":
    run()
