"""
One-time migration: add supports_vision column to models table.

- 给 models 表加 supports_vision (TINYINT, default 0), 已存在则跳过.
- 取值: 1=该模型支持视觉/多模态输入（如 gpt-4o、qwen-vl 系列），可用于视频理解截图分析，
        0=不支持（文本模型）。仅管理员在模型管理页勾选。

安全: 可重复运行.

用法:
  python -m app.db.migrate_add_model_supports_vision
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

        if "supports_vision" not in existing:
            conn.execute(text(
                "ALTER TABLE models ADD COLUMN supports_vision TINYINT NOT NULL DEFAULT 0"
            ))
            conn.commit()
            print("  added column: supports_vision")
        else:
            print("  skipped (exists): supports_vision")

    print("Migration done.")


if __name__ == "__main__":
    run()
