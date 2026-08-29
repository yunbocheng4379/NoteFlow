-- =============================================================================
-- NoteFlow AI 用量审计、模型计价与模型 Token 价格迁移
-- 幂等: 可重复执行。已存在的表/列会被跳过。
-- 用法:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow \
--     < sql/migrate_add_ai_usage_and_model_token_pricing.sql
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id                       BIGINT NOT NULL AUTO_INCREMENT,
    request_id               VARCHAR(64) NOT NULL,
    trace_id                 VARCHAR(64) NOT NULL,
    parent_log_id            BIGINT NULL,
    user_id                  INT NULL,
    user_snapshot            VARCHAR(160) NULL,
    scene                    VARCHAR(48) NOT NULL,
    operation                VARCHAR(80) NOT NULL,
    resource_type            VARCHAR(48) NULL,
    resource_id              VARCHAR(128) NULL,
    provider_id              VARCHAR(64) NULL,
    provider_name            VARCHAR(120) NOT NULL DEFAULT '',
    model_id                 INT NULL,
    model_name               VARCHAR(160) NOT NULL DEFAULT '',
    key_alias                VARCHAR(120) NULL,
    key_fingerprint          CHAR(64) NULL,
    key_masked               VARCHAR(32) NULL,
    request_mode             VARCHAR(16) NOT NULL DEFAULT 'sync',
    attempt_no               INT NOT NULL DEFAULT 1,
    status                   VARCHAR(20) NOT NULL DEFAULT 'started',
    error_type               VARCHAR(80) NULL,
    error_message            TEXT NULL,
    started_at               DATETIME NOT NULL,
    completed_at             DATETIME NULL,
    latency_ms               INT NULL,
    input_tokens             BIGINT NULL,
    output_tokens            BIGINT NULL,
    cached_input_tokens      BIGINT NULL,
    reasoning_tokens         BIGINT NULL,
    total_tokens             BIGINT NULL,
    token_source             VARCHAR(20) NOT NULL DEFAULT 'unavailable',
    input_price_per_million  DECIMAL(18, 8) NULL,
    output_price_per_million DECIMAL(18, 8) NULL,
    currency                 CHAR(3) NOT NULL DEFAULT 'CNY',
    estimated_cost           DECIMAL(18, 8) NULL,
    prompt_content           TEXT NULL,
    response_content         TEXT NULL,
    prompt_sha256            CHAR(64) NULL,
    response_sha256          CHAR(64) NULL,
    metadata_json            TEXT NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_usage_logs_request_id (request_id),
    KEY ix_ai_usage_logs_trace_id (trace_id),
    KEY ix_ai_usage_logs_parent_log_id (parent_log_id),
    KEY ix_ai_usage_logs_user_id (user_id),
    KEY ix_ai_usage_logs_scene (scene),
    KEY ix_ai_usage_logs_provider_id (provider_id),
    KEY ix_ai_usage_logs_model_name (model_name),
    KEY ix_ai_usage_logs_key_fingerprint (key_fingerprint),
    KEY ix_ai_usage_logs_status (status),
    KEY ix_ai_usage_logs_started_at (started_at),
    KEY ix_ai_usage_logs_time_status (started_at, status),
    KEY ix_ai_usage_logs_user_time (user_id, started_at),
    KEY ix_ai_usage_logs_scene_time (scene, started_at),
    KEY ix_ai_usage_logs_model_time (model_name, started_at),
    KEY ix_ai_usage_logs_key_time (key_fingerprint, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 请求用量审计日志';

CREATE TABLE IF NOT EXISTS ai_model_pricing (
    id                       BIGINT NOT NULL AUTO_INCREMENT,
    provider_id              VARCHAR(64) NULL,
    provider_name            VARCHAR(120) NOT NULL DEFAULT '',
    model_name               VARCHAR(160) NOT NULL,
    input_price_per_million  DECIMAL(18, 8) NOT NULL,
    output_price_per_million DECIMAL(18, 8) NOT NULL,
    currency                 CHAR(3) NOT NULL DEFAULT 'CNY',
    effective_from           DATETIME NOT NULL,
    effective_to             DATETIME NULL,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    note                     VARCHAR(500) NULL,
    created_by               INT NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_ai_model_pricing_provider_id (provider_id),
    KEY ix_ai_model_pricing_model_name (model_name),
    KEY ix_ai_model_pricing_effective_from (effective_from),
    KEY ix_ai_model_pricing_match (provider_id, model_name, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 模型生效期价格';

SET @has_input_price := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'models'
    AND column_name = 'input_price_per_million'
);
SET @sql := IF(
  @has_input_price = 0,
  "ALTER TABLE models ADD COLUMN input_price_per_million DECIMAL(18, 8) NULL COMMENT '输入 Token 价格，单位：每百万 Token 的 CNY'",
  "SELECT 'skipped: models.input_price_per_million exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_output_price := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'models'
    AND column_name = 'output_price_per_million'
);
SET @sql := IF(
  @has_output_price = 0,
  "ALTER TABLE models ADD COLUMN output_price_per_million DECIMAL(18, 8) NULL COMMENT '输出 Token 价格，单位：每百万 Token 的 CNY'",
  "SELECT 'skipped: models.output_price_per_million exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
