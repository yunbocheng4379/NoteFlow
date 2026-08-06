-- =============================================================================
-- NoteFlow 笔记格式计费率表迁移 (2026-08-05)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_credit_format_pricing.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_credit_format_pricing.sql
-- 幂等: CREATE TABLE IF NOT EXISTS + INSERT IGNORE, 可重复执行.
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS `credit_format_pricing` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `format_key` varchar(64) NOT NULL COMMENT '格式标识: toc/link/screenshot/summary, 与前端 note_formats.value 一致',
  `rate_per_minute` int NOT NULL DEFAULT '0' COMMENT '每分钟消耗电力数 (整数)',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用: 1=启用, 0=停用',
  `description` varchar(255) DEFAULT NULL COMMENT '描述, 展示用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `format_key` (`format_key`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='笔记格式计费率配置表 (按分钟单价, 与模型费率叠加)';

INSERT IGNORE INTO credit_format_pricing (format_key, rate_per_minute, is_active, description) VALUES
  ('toc',        1, 1, '目录 (成本低, 仅解析标题生成锚点)'),
  ('link',       1, 1, '原片跳转 (成本低, 仅插入时间戳文本)'),
  ('screenshot', 3, 1, '原片截图 (成本高, 需抽帧+视觉模型分析)'),
  ('summary',    1, 1, 'AI总结 (成本低, 仅多生成一段总结文字)');
