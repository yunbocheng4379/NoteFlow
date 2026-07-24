-- =============================================================================
-- NoteFlow 闪记卡表迁移 (2026-07-21)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_flashcards.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_flashcards.sql
-- =============================================================================
USE noteflow;

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
