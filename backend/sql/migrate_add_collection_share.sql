-- =============================================================================
-- NoteFlow 合集分享表迁移 (2026-07-21)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_collection_share.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_collection_share.sql
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS collection_shares (
  id             INT         NOT NULL AUTO_INCREMENT,
  collection_id  INT         NOT NULL                                COMMENT '关联的合集 ID，对应 note_collections.id',
  user_id        INT         NOT NULL                                COMMENT '合集所有者用户 ID',
  share_token    VARCHAR(64) NOT NULL                                COMMENT '分享凭证，UUID 去掉连字符',
  is_active      TINYINT(1)  NOT NULL                                COMMENT 'True=分享开启，False=已关闭',
  view_count     INT         NOT NULL                                COMMENT '无需登录访问次数',
  created_at     DATETIME    DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ix_collection_shares_share_token (share_token),
  UNIQUE KEY ix_collection_shares_collection_id (collection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
