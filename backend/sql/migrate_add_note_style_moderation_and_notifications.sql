-- =============================================================================
-- NoteFlow 笔记风格审核、版本快照和站内通知迁移
--
-- 目标：为已有数据库补齐本轮新增的笔记风格审核/版本、系统配置和用户通知表。
-- 可重复执行：新增列通过 information_schema 判断，新增表使用 IF NOT EXISTS。
-- 数据回填由后端启动时的 init_db() 完成：为既有用户风格创建首个版本快照。
-- =============================================================================
USE noteflow;

SET @note_style_moderation_status_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_styles'
    AND column_name = 'moderation_status'
);
SET @add_note_style_moderation_status_sql := IF(
  @note_style_moderation_status_exists = 0,
  'ALTER TABLE note_styles ADD COLUMN moderation_status VARCHAR(24) NOT NULL DEFAULT ''DRAFT'' COMMENT ''公开审核状态'' AFTER is_public',
  'SELECT 1'
);
PREPARE add_note_style_moderation_status_stmt FROM @add_note_style_moderation_status_sql;
EXECUTE add_note_style_moderation_status_stmt;
DEALLOCATE PREPARE add_note_style_moderation_status_stmt;

UPDATE note_styles
SET moderation_status = 'PUBLISHED'
WHERE source = 'user'
  AND is_public = 1
  AND moderation_status = 'DRAFT';

SET @published_version_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_styles'
    AND column_name = 'published_version_id'
);
SET @add_published_version_id_sql := IF(
  @published_version_id_exists = 0,
  'ALTER TABLE note_styles ADD COLUMN published_version_id INT NULL COMMENT ''当前公开版本 ID'' AFTER moderation_status',
  'SELECT 1'
);
PREPARE add_published_version_id_stmt FROM @add_published_version_id_sql;
EXECUTE add_published_version_id_stmt;
DEALLOCATE PREPARE add_published_version_id_stmt;

SET @pending_version_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_styles'
    AND column_name = 'pending_version_id'
);
SET @add_pending_version_id_sql := IF(
  @pending_version_id_exists = 0,
  'ALTER TABLE note_styles ADD COLUMN pending_version_id INT NULL COMMENT ''当前待审核版本 ID'' AFTER published_version_id',
  'SELECT 1'
);
PREPARE add_pending_version_id_stmt FROM @add_pending_version_id_sql;
EXECUTE add_pending_version_id_stmt;
DEALLOCATE PREPARE add_pending_version_id_stmt;

SET @review_reason_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_styles'
    AND column_name = 'review_reason'
);
SET @add_review_reason_sql := IF(
  @review_reason_exists = 0,
  'ALTER TABLE note_styles ADD COLUMN review_reason TEXT NULL COMMENT ''最近一次驳回或下架原因'' AFTER pending_version_id',
  'SELECT 1'
);
PREPARE add_review_reason_stmt FROM @add_review_reason_sql;
EXECUTE add_review_reason_stmt;
DEALLOCATE PREPARE add_review_reason_stmt;

SET @reviewed_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_styles'
    AND column_name = 'reviewed_at'
);
SET @add_reviewed_at_sql := IF(
  @reviewed_at_exists = 0,
  'ALTER TABLE note_styles ADD COLUMN reviewed_at DATETIME NULL COMMENT ''最近一次审核处理时间'' AFTER review_reason',
  'SELECT 1'
);
PREPARE add_reviewed_at_stmt FROM @add_reviewed_at_sql;
EXECUTE add_reviewed_at_stmt;
DEALLOCATE PREPARE add_reviewed_at_stmt;

CREATE TABLE IF NOT EXISTS system_settings (
  `key` VARCHAR(128) NOT NULL,
  `value` TEXT NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统级管理员配置';

CREATE TABLE IF NOT EXISTS note_style_versions (
  id INT NOT NULL AUTO_INCREMENT,
  style_id INT NOT NULL,
  version_no INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  value VARCHAR(128) NOT NULL,
  description VARCHAR(200) NULL,
  prompt TEXT NOT NULL,
  icon VARCHAR(32) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  ai_status VARCHAR(24) NULL,
  ai_risk_level VARCHAR(16) NULL,
  ai_categories VARCHAR(500) NULL,
  ai_summary VARCHAR(1000) NULL,
  ai_recommendations VARCHAR(2000) NULL,
  ai_provider VARCHAR(64) NULL,
  ai_checked_at DATETIME NULL,
  submitted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_note_style_version_no (style_id, version_no),
  KEY ix_note_style_versions_style_id (style_id),
  KEY ix_note_style_versions_value (value),
  KEY ix_note_style_versions_status_created (status, created_at),
  CONSTRAINT fk_note_style_versions_style FOREIGN KEY (style_id) REFERENCES note_styles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='笔记风格提交版本快照';

CREATE TABLE IF NOT EXISTS note_style_reviews (
  id INT NOT NULL AUTO_INCREMENT,
  style_id INT NOT NULL,
  version_id INT NOT NULL,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NOT NULL,
  reviewer_id INT NULL,
  reason TEXT NULL,
  ai_status VARCHAR(24) NULL,
  ai_risk_level VARCHAR(16) NULL,
  ai_categories VARCHAR(500) NULL,
  ai_summary VARCHAR(1000) NULL,
  ai_recommendations VARCHAR(2000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_note_style_reviews_style_created (style_id, created_at),
  KEY ix_note_style_reviews_version_id (version_id),
  CONSTRAINT fk_note_style_reviews_style FOREIGN KEY (style_id) REFERENCES note_styles (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_style_reviews_version FOREIGN KEY (version_id) REFERENCES note_style_versions (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_style_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='笔记风格审核流水';

CREATE TABLE IF NOT EXISTS user_notifications (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  category VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  source_type VARCHAR(64) NULL,
  source_id VARCHAR(128) NULL,
  link VARCHAR(255) NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'info',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_notification_source (user_id, category, source_type, source_id),
  KEY ix_user_notifications_user_read_created (user_id, is_read, created_at),
  CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户站内通知';

SET @version_ai_recommendations_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_style_versions'
    AND column_name = 'ai_recommendations'
);
SET @add_version_ai_recommendations_sql := IF(
  @version_ai_recommendations_exists = 0,
  'ALTER TABLE note_style_versions ADD COLUMN ai_recommendations VARCHAR(2000) NULL COMMENT ''JSON AI 修改建议列表'' AFTER ai_summary',
  'SELECT 1'
);
PREPARE add_version_ai_recommendations_stmt FROM @add_version_ai_recommendations_sql;
EXECUTE add_version_ai_recommendations_stmt;
DEALLOCATE PREPARE add_version_ai_recommendations_stmt;

SET @review_ai_recommendations_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'note_style_reviews'
    AND column_name = 'ai_recommendations'
);
SET @add_review_ai_recommendations_sql := IF(
  @review_ai_recommendations_exists = 0,
  'ALTER TABLE note_style_reviews ADD COLUMN ai_recommendations VARCHAR(2000) NULL AFTER ai_summary',
  'SELECT 1'
);
PREPARE add_review_ai_recommendations_stmt FROM @add_review_ai_recommendations_sql;
EXECUTE add_review_ai_recommendations_stmt;
DEALLOCATE PREPARE add_review_ai_recommendations_stmt;
