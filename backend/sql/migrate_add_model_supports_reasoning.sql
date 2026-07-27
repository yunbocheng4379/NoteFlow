-- =============================================================================
-- NoteFlow 模型深度思考支持标记迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_model_supports_reasoning.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_model_supports_reasoning.sql
-- =============================================================================
USE noteflow;

ALTER TABLE models ADD COLUMN supports_reasoning TINYINT NOT NULL DEFAULT 0
  COMMENT '是否原生支持深度思考(reasoning)：1=支持，0=不支持';
