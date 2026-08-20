-- =============================================================================
-- NoteFlow 待支付订单 15 分钟过期迁移
--
-- 用法:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow \
--     < backend/sql/migrate_add_order_expiry.sql
--
-- 可重复执行: MySQL 8 的 ADD COLUMN IF NOT EXISTS 会跳过已存在的字段。
-- =============================================================================
USE noteflow;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL COMMENT '待支付订单过期时间' AFTER cancelled_at;

UPDATE orders
SET expires_at = DATE_ADD(created_at, INTERVAL 15 MINUTE)
WHERE status = 'PENDING'
  AND expires_at IS NULL;

UPDATE orders
SET status = 'CANCELLED',
    cancelled_at = COALESCE(cancelled_at, NOW()),
    mock_qrcode_token = NULL
WHERE status = 'PENDING'
  AND expires_at IS NOT NULL
  AND expires_at <= NOW();
