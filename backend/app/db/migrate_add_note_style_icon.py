"""
One-time migration: add icon column to note_styles table.

- 给 note_styles 表加 icon (VARCHAR(32), nullable), 已存在则跳过.
- icon 存储前端预置图标集的 key（如 'academic'），不存完整路径；为空时前端使用首字母头像兜底.
- 系统内置风格的 icon 由 seed_system_styles() 自动回填，此脚本仅负责加列.

用法:
  python -m app.db.migrate_add_note_style_icon
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(text("SHOW COLUMNS FROM note_styles"))
        existing = {row[0] for row in result}

        if "icon" not in existing:
            conn.execute(text(
                "ALTER TABLE note_styles ADD COLUMN icon VARCHAR(32) NULL COMMENT '图标 key，对应前端预置图标集的键名；为空时前端使用首字母头像兜底展示'"
            ))
            conn.commit()
            print("  added column: icon")
        else:
            print("  skipped (exists): icon")

    print("Migration done.")


if __name__ == "__main__":
    run()
