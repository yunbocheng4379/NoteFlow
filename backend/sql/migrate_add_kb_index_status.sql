-- =============================================================================
-- NoteFlow 知识库索引状态表迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_kb_index_status.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_kb_index_status.sql
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS kb_index_status (
  task_id     VARCHAR(64) NOT NULL                                COMMENT '对应 video_tasks.task_id',
  status      VARCHAR(16) NOT NULL                                COMMENT '索引状态：indexing / indexed / failed',
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近状态变更时间',
  PRIMARY KEY (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
