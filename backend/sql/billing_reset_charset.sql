-- ============================================================================
-- 计费系统字符集修复脚本
-- ============================================================================
-- 用途: 之前用非 utf8mb4 客户端跑 billing_init.sql 导致表 COMMENT + seed 数据
--       双重编码乱码, 本脚本清理后可配合 billing_init.sql 重跑以恢复正确编码.
--
-- 操作:
--   1. 断开 users 表上关联新表的外键 (指向 subscriptions)
--   2. 按 FK 反向依赖顺序 DROP 7 张新表 (数据全部丢失, 均为测试数据)
--   3. 从 users 表 DROP 4 个新增列 (以便 billing_init.sql 重新 ADD 时带正确 COMMENT)
--   4. 保留 users 表原有字段 (total_points/used_points 双写期字段不动)
--
-- 执行方式 (必须传 --default-character-set=utf8mb4):
--   mysql --default-character-set=utf8mb4 -u<user> -p<db> < billing_reset_charset.sql
--   mysql --default-character-set=utf8mb4 -u<user> -p<db> < billing_init.sql
--   python -m app.db.migrate_billing_phase1
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 断开 users -> subscriptions 外键 (fk_users_active_subscription 是 billing_init.sql 建的)
ALTER TABLE users DROP FOREIGN KEY fk_users_active_subscription;
-- 2. 断开 users -> users 自引用外键 (fk_users_referred_by)
ALTER TABLE users DROP FOREIGN KEY fk_users_referred_by;
-- 3. 断开 users.referral_code 唯一索引
ALTER TABLE users DROP INDEX uk_users_referral_code;

-- 4. Drop 7 张新表 (与用户相关的所有交易 / 订阅 / 订单 / 流水 / 推荐记录)
DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS credit_transactions;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS subscription_plans;
DROP TABLE IF EXISTS recharge_packages;
DROP TABLE IF EXISTS credit_pricing;

-- 5. 从 users 表 DROP 4 个新增列, 由 billing_init.sql 重新加带正确 COMMENT 的列
ALTER TABLE users DROP COLUMN active_subscription_id;
ALTER TABLE users DROP COLUMN referred_by_user_id;
ALTER TABLE users DROP COLUMN referral_code;
ALTER TABLE users DROP COLUMN credits;

SET FOREIGN_KEY_CHECKS = 1;

-- 完成. 接下来执行:
--   mysql --default-character-set=utf8mb4 -u<user> -p<db> < billing_init.sql
--   python -m app.db.migrate_billing_phase1
