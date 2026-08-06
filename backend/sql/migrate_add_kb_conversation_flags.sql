-- =============================================================================
-- NoteFlow 知识库会话置顶/未读标记迁移 (2026-08-06)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_kb_conversation_flags.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_kb_conversation_flags.sql
-- 幂等: 通过 information_schema 判断列是否存在，可重复执行.
-- =============================================================================
USE noteflow;

SET @has_is_pinned := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'kb_conversations'
    AND column_name = 'is_pinned'
);
SET @sql := IF(
  @has_is_pinned = 0,
  "ALTER TABLE kb_conversations ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否置顶，置顶会话在列表最上方' AFTER model_name",
  "SELECT 'skipped: kb_conversations.is_pinned exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_is_unread := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'kb_conversations'
    AND column_name = 'is_unread'
);
SET @sql := IF(
  @has_is_unread = 0,
  "ALTER TABLE kb_conversations ADD COLUMN is_unread TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否手动标记为未读，仅前端红点提示' AFTER is_pinned",
  "SELECT 'skipped: kb_conversations.is_unread exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
