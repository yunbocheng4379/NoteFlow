-- =============================================================================
-- NoteFlow 知识库会话/消息表迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_kb_conversations.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_kb_conversations.sql
-- =============================================================================
USE noteflow;

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
