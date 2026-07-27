"""
迁移：创建 kb_index_status 表（笔记向量索引状态，持久化）。

说明
----
- 替代 routers/chat.py 中原先的进程内 dict `_index_status`（重启即丢失）。
- /chat/* 与 /kb/* 共用同一份索引状态。
- 完整字段说明见 ``app/db/models/kb_index_status.py``。

用法:
    python -m app.db.migrate_add_kb_index_status

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db()（Base.metadata.create_all 已包含该表）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE = """
CREATE TABLE IF NOT EXISTS kb_index_status (
  task_id     VARCHAR(64) NOT NULL                                COMMENT '对应 video_tasks.task_id',
  status      VARCHAR(16) NOT NULL                                COMMENT '索引状态：indexing / indexed / failed',
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近状态变更时间',
  PRIMARY KEY (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :t"
        ),
        {"t": table_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _table_exists(conn, "kb_index_status"):
            conn.execute(text(SQL_CREATE))
            print("  created table: kb_index_status")
        else:
            print("  skipped (exists): kb_index_status table")

    print("Migration done.")


if __name__ == "__main__":
    run()
