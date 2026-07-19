-- =============================================================================
-- NoteFlow 更新日志表迁移 (2026-07-13)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_update_logs.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_update_logs.sql
-- =============================================================================
USE noteflow;

-- 主表 (含生成列 + UNIQUE 索引实现「任意时刻只允许一条 active」语义)
CREATE TABLE IF NOT EXISTS update_logs (
    id              INT          NOT NULL AUTO_INCREMENT                COMMENT '主键 ID, 自增',
    title           VARCHAR(255) NOT NULL                              COMMENT '更新日志标题',
    version         VARCHAR(32)  NULL                                  COMMENT '可选版本号, 例如 v1.2.0',
    summary         VARCHAR(500) NOT NULL                              COMMENT '一句话简介, 用于顶部通知条',
    content         TEXT         NOT NULL                              COMMENT '完整内容, Markdown',
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending'            COMMENT 'pending / active / ended',
    published_at    DATETIME     NULL                                  COMMENT '进入 active 状态的时间',
    ended_at        DATETIME     NULL                                  COMMENT '进入 ended 状态的时间',
    created_by      INT          NULL                                  COMMENT '创建该日志的管理员 user_id',
    published_by    INT          NULL                                  COMMENT '发布该日志的管理员 user_id',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP                       COMMENT '创建时间',
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    -- 生成列: 仅 active 行 marker=1, 其他状态 marker=NULL, 配合下方 UNIQUE 等价于「partial unique index」
    active_marker   TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_update_logs_active (active_marker),
    KEY ix_update_logs_status_published (status, published_at),
    KEY ix_update_logs_created_at       (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='更新日志: pending=未通知 (仅管理员可见), active=通知中 (顶部横幅 + 用户页), ended=已结束 (仅用户页)';
