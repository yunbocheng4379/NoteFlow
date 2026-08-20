-- =============================================================================
-- NoteFlow 订单记录软删除迁移
--
-- 用法:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow \
--     < backend/sql/migrate_add_order_hidden_at.sql
--
-- 可重复执行: 通过 information_schema 判断字段是否已经存在。
-- =============================================================================
USE noteflow;

SET @order_hidden_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'orders'
    AND column_name = 'hidden_at'
);

SET @add_order_hidden_sql := IF(
  @order_hidden_column_exists = 0,
  'ALTER TABLE orders ADD COLUMN hidden_at DATETIME NULL AFTER expires_at',
  'SELECT 1'
);

PREPARE add_order_hidden_stmt FROM @add_order_hidden_sql;
EXECUTE add_order_hidden_stmt;
DEALLOCATE PREPARE add_order_hidden_stmt;
