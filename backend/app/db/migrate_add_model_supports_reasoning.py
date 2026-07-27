"""
One-time migration: add supports_reasoning column to models table.

- 给 models 表加 supports_reasoning (TINYINT, default 0), 已存在则跳过.
- 取值: 1=该模型原生支持 reasoning/深度思考（如 deepseek-reasoner、Qwen thinking 系列），
        0=不支持。仅管理员在模型管理页勾选。

安全: 可重复运行.

用法:
  python -m app.db.migrate_add_model_supports_reasoning
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

        if "supports_reasoning" not in existing:
            conn.execute(text(
                "ALTER TABLE models ADD COLUMN supports_reasoning TINYINT NOT NULL DEFAULT 0"
            ))
            conn.commit()
            print("  added column: supports_reasoning")
        else:
            print("  skipped (exists): supports_reasoning")

    print("Migration done.")


if __name__ == "__main__":
    run()
