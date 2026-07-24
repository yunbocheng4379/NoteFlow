"""
迁移：创建 note_collections / note_collection_items 表 (笔记合集).

说明
----
- note_collections: 用户手动创建的笔记合集容器。
- note_collection_items: 合集与 video_tasks.task_id 的多对多关联表，
  一篇笔记可加入多个合集。
- 完整字段说明见 ``app/db/models/note_collections.py``。

用法:
    python -m app.db.migrate_add_note_collections

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db() (Base.metadata.create_all 已包含这两张表)，
本脚本仅用于已有数据库的手动升级。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_COLLECTIONS = """
CREATE TABLE IF NOT EXISTS note_collections (
  id            INT          NOT NULL AUTO_INCREMENT                COMMENT '合集 ID，主键，自增',
  user_id       INT          NOT NULL                                COMMENT '创建者用户 ID',
  name          VARCHAR(100) NOT NULL                                COMMENT '合集名称',
  description   VARCHAR(500) NULL                                    COMMENT '合集描述，可为空',
  cover_url     VARCHAR(512) NULL                                    COMMENT '合集封面图片 URL，可为空，前端为空时展示默认文件夹图标',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近更新时间（含笔记增删）',
  PRIMARY KEY (id),
  KEY ix_note_collections_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

SQL_CREATE_ITEMS = """
CREATE TABLE IF NOT EXISTS note_collection_items (
  id             INT         NOT NULL AUTO_INCREMENT                COMMENT '关联记录 ID，主键，自增',
  collection_id  INT         NOT NULL                                COMMENT '关联的合集 ID，对应 note_collections.id',
  task_id        VARCHAR(64) NOT NULL                                COMMENT '关联的笔记任务 ID，对应 video_tasks.task_id',
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '加入合集时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_collection_task (collection_id, task_id),
  KEY ix_note_collection_items_collection_id (collection_id),
  KEY ix_note_collection_items_task_id (task_id)
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
        if not _table_exists(conn, "note_collections"):
            conn.execute(text(SQL_CREATE_COLLECTIONS))
            print("  created table: note_collections")
        else:
            print("  skipped (exists): note_collections table")

        if not _table_exists(conn, "note_collection_items"):
            conn.execute(text(SQL_CREATE_ITEMS))
            print("  created table: note_collection_items")
        else:
            print("  skipped (exists): note_collection_items table")

    print("Migration done.")


if __name__ == "__main__":
    run()
