"""
迁移：为 video_tasks 表添加 custom_title 列 (用户手动重命名笔记标题).

说明
----
- custom_title: 用户手动设置的笔记标题；非空时覆盖自动提取的视频标题。
- 由 PUT /note/{task_id}/title 写入，GET /tasks 与 /task_status/{task_id} 读取时优先展示。

用法:
    python -m app.db.migrate_add_custom_title

幂等: 重复执行不会报错，列已存在时会跳过。
新库部署可直接走 init_db() (Base.metadata.create_all 已包含该列)，
本脚本仅用于已有数据库的手动升级。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
        ),
        {"t": table_name, "c": column_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _column_exists(conn, "video_tasks", "custom_title"):
            conn.execute(
                text(
                    "ALTER TABLE video_tasks "
                    "ADD COLUMN custom_title VARCHAR(200) NULL COMMENT '用户手动设置的笔记标题' "
                    "AFTER batch_id"
                )
            )
            print("  added column: video_tasks.custom_title")
        else:
            print("  skipped (exists): video_tasks.custom_title")

    print("Migration done.")


if __name__ == "__main__":
    run()
