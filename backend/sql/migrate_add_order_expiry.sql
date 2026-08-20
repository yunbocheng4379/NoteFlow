-- =============================================================================
-- NoteFlow 待支付订单 15 分钟过期迁移
--
-- 用法:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow \
--     < backend/sql/migrate_add_order_expiry.sql
--
-- 可重复执行: 通过 information_schema 判断字段是否已经存在，兼容旧版 MySQL。
-- =============================================================================
USE noteflow;

SET @order_expiry_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'orders'
    AND column_name = 'expires_at'
);

SET @add_order_expiry_sql := IF(
  @order_expiry_column_exists = 0,
  'ALTER TABLE orders ADD COLUMN expires_at DATETIME NULL AFTER cancelled_at',
  'SELECT 1'
);

PREPARE add_order_expiry_stmt FROM @add_order_expiry_sql;
EXECUTE add_order_expiry_stmt;
DEALLOCATE PREPARE add_order_expiry_stmt;

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
