-- =============================================================================
-- NoteFlow 笔记合集表迁移 (2026-07-21)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_note_collections.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_note_collections.sql
-- =============================================================================
USE noteflow;

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
