"""
迁移：创建 kb_conversations / kb_messages 表（知识库跨笔记 AI 问答）。

说明
----
- kb_conversations: 用户的知识库会话（多会话，带历史列表）。
- kb_messages: 会话内的消息，conversation_id 外键级联删除。
- 完整字段说明见 ``app/db/models/kb_conversations.py``。

用法:
    python -m app.db.migrate_add_kb_conversations

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db()（Base.metadata.create_all 已包含这两张表）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_CONVERSATIONS = """
CREATE TABLE IF NOT EXISTS kb_conversations (
  id            INT          NOT NULL AUTO_INCREMENT                COMMENT '会话 ID，主键，自增',
  user_id       INT          NOT NULL                                COMMENT '所属用户 ID',
  title         VARCHAR(200) NULL                                    COMMENT '会话标题，首次提问后取问题前 30 字自动生成',
  provider_id   VARCHAR(64)  NULL                                    COMMENT '该会话最近使用的供应商 ID',
  model_name    VARCHAR(128) NULL                                    COMMENT '该会话最近使用的模型名',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近一次问答时间，用于会话列表排序',
  PRIMARY KEY (id),
  KEY ix_kb_conversations_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

SQL_CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS kb_messages (
  id                  INT          NOT NULL AUTO_INCREMENT                COMMENT '消息 ID，主键，自增',
  conversation_id     INT          NOT NULL                                COMMENT '所属会话 ID，对应 kb_conversations.id',
  role                VARCHAR(16)  NOT NULL                                COMMENT '角色：user / assistant',
  content             TEXT         NOT NULL                                COMMENT '最终答案正文，或用户提问内容',
  reasoning_content   TEXT         NULL                                    COMMENT '深度思考过程内容',
  sources             TEXT         NULL                                    COMMENT 'JSON 字符串，引用的跨笔记片段列表',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间，决定消息顺序',
  PRIMARY KEY (id),
  KEY ix_kb_messages_conversation_id (conversation_id),
  CONSTRAINT kb_messages_ibfk_1 FOREIGN KEY (conversation_id) REFERENCES kb_conversations (id) ON DELETE CASCADE
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
        if not _table_exists(conn, "kb_conversations"):
            conn.execute(text(SQL_CREATE_CONVERSATIONS))
            print("  created table: kb_conversations")
        else:
            print("  skipped (exists): kb_conversations table")

        if not _table_exists(conn, "kb_messages"):
            conn.execute(text(SQL_CREATE_MESSAGES))
            print("  created table: kb_messages")
        else:
            print("  skipped (exists): kb_messages table")

    print("Migration done.")


if __name__ == "__main__":
    run()
