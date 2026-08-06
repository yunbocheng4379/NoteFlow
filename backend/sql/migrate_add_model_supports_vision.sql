-- =============================================================================
-- NoteFlow 模型视觉/多模态支持标记迁移 (2026-08-06)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_model_supports_vision.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_model_supports_vision.sql
-- 幂等: 通过 information_schema 判断列是否存在，可重复执行.
-- =============================================================================
USE noteflow;

SET @has_supports_vision := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'models'
    AND column_name = 'supports_vision'
);
SET @sql := IF(
  @has_supports_vision = 0,
  "ALTER TABLE models ADD COLUMN supports_vision TINYINT NOT NULL DEFAULT 0 COMMENT '是否支持视觉/多模态输入(vision)：1=支持，0=不支持' AFTER supports_reasoning",
  "SELECT 'skipped: models.supports_vision exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
