"""
迁移：为 kb_conversations 表添加 is_pinned / is_unread 列。

说明
----
- is_pinned: 会话是否置顶，置顶会话在列表最上方（BOOL, 默认 0）。
- is_unread: 会话是否被手动标记为未读，仅供前端展示红点提示（BOOL, 默认 0）。
- 完整字段说明见 ``app/db/models/kb_conversations.py``。

用法:
    python -m app.db.migrate_add_kb_conversation_flags

幂等: 重复执行不会报错，列已存在时会跳过。
新库部署可直接走 init_db()（Base.metadata.create_all 已包含这两列）。
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
        if not _column_exists(conn, "kb_conversations", "is_pinned"):
            conn.execute(
                text(
                    "ALTER TABLE kb_conversations "
                    "ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 "
                    "COMMENT '是否置顶，置顶会话在列表最上方' "
                    "AFTER model_name"
                )
            )
            print("  added column: kb_conversations.is_pinned")
        else:
            print("  skipped (exists): kb_conversations.is_pinned")

        if not _column_exists(conn, "kb_conversations", "is_unread"):
            conn.execute(
                text(
                    "ALTER TABLE kb_conversations "
                    "ADD COLUMN is_unread TINYINT(1) NOT NULL DEFAULT 0 "
                    "COMMENT '是否手动标记为未读，仅前端红点提示' "
                    "AFTER is_pinned"
                )
            )
            print("  added column: kb_conversations.is_unread")
        else:
            print("  skipped (exists): kb_conversations.is_unread")

    print("Migration done.")


if __name__ == "__main__":
    run()
