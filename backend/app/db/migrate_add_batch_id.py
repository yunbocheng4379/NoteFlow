"""
迁移：为 video_tasks 表添加 batch_id 列 (批量笔记生成分组).

说明
----
- batch_id: 批量生成任务的分组标识，由 /generate_notes_batch 为整批任务统一生成一个 UUID。
  单个（非批量）生成的任务该列为 NULL。
- 前端任务列表页据此对批量提交的任务做分组展示。

用法:
    python -m app.db.migrate_add_batch_id

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
        if not _column_exists(conn, "video_tasks", "batch_id"):
            conn.execute(
                text(
                    "ALTER TABLE video_tasks "
                    "ADD COLUMN batch_id VARCHAR(64) NULL COMMENT '批量任务分组 ID，单个任务为 NULL' "
                    "AFTER created_at"
                )
            )
            conn.execute(
                text("CREATE INDEX ix_video_tasks_batch_id ON video_tasks (batch_id)")
            )
            print("  added column: video_tasks.batch_id")
        else:
            print("  skipped (exists): video_tasks.batch_id")

    print("Migration done.")


if __name__ == "__main__":
    run()
