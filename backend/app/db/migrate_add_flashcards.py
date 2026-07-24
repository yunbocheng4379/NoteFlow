"""
迁移：创建 flashcard_sets / flashcards 表 (闪记卡).

说明
----
- flashcard_sets: 围绕某篇笔记生成的一组问答卡片的元信息（自定义出题要求、
  卡片数量、生成模型等）。
- flashcards: 卡组下的单张问答卡片。
- 完整字段说明见 ``app/db/models/flashcards.py``。

用法:
    python -m app.db.migrate_add_flashcards

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db() (Base.metadata.create_all 已包含这两张表)，
本脚本仅用于已有数据库的手动升级。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_FLASHCARD_SETS = """
CREATE TABLE IF NOT EXISTS flashcard_sets (
  id             INT          NOT NULL AUTO_INCREMENT                COMMENT '卡组 ID，主键，自增',
  user_id        INT          NOT NULL                                COMMENT '创建者用户 ID',
  task_id        VARCHAR(64)  NOT NULL                                COMMENT '源笔记 task_id，对应 video_tasks.task_id',
  title          VARCHAR(200) NULL                                    COMMENT '卡组标题，默认取自源笔记标题',
  custom_prompt  TEXT         NULL                                    COMMENT '用户自定义出题要求，可为空',
  card_count     INT          NOT NULL                                COMMENT '生成的卡片数量',
  provider_id    VARCHAR(64)  NULL                                    COMMENT '生成时使用的模型提供者 ID',
  model_name     VARCHAR(100) NULL                                    COMMENT '生成时使用的模型名称',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY ix_flashcard_sets_user_id (user_id),
  KEY ix_flashcard_sets_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

SQL_CREATE_FLASHCARDS = """
CREATE TABLE IF NOT EXISTS flashcards (
  id           INT  NOT NULL AUTO_INCREMENT                          COMMENT '卡片 ID，主键，自增',
  set_id       INT  NOT NULL                                          COMMENT '所属卡组 ID，对应 flashcard_sets.id',
  question     TEXT NOT NULL                                          COMMENT '卡片问题',
  answer       TEXT NOT NULL                                          COMMENT '卡片答案',
  order_index  INT  NOT NULL                                          COMMENT '卡片顺序，从 0 开始',
  PRIMARY KEY (id),
  KEY ix_flashcards_set_id (set_id),
  CONSTRAINT flashcards_ibfk_1 FOREIGN KEY (set_id) REFERENCES flashcard_sets (id) ON DELETE CASCADE
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
        if not _table_exists(conn, "flashcard_sets"):
            conn.execute(text(SQL_CREATE_FLASHCARD_SETS))
            print("  created table: flashcard_sets")
        else:
            print("  skipped (exists): flashcard_sets table")

        if not _table_exists(conn, "flashcards"):
            conn.execute(text(SQL_CREATE_FLASHCARDS))
            print("  created table: flashcards")
        else:
            print("  skipped (exists): flashcards table")

    print("Migration done.")


if __name__ == "__main__":
    run()
