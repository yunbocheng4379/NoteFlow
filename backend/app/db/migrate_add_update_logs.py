"""
迁移：创建 update_logs 表 (更新日志).

设计要点
--------
- status: ``pending`` (未通知) / ``active`` (通知中) / ``ended`` (已结束).
- 任意时刻全局只允许一条 ``active`` 行. 通过 ``active_marker`` 生成列 +
  UNIQUE 索引实现「只有 active 行对应 marker=1, marker=1 全表唯一」, 等价于部分唯一索引.
- 完整字段说明见 ``app/db/models/update_logs.py``.

用法:
    python -m app.db.migrate_add_update_logs

幂等: 重复执行不会报错, 已存在的字段/索引会跳过.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_TABLE = """
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
    -- 生成列: 仅 active 行 marker=1, 其他状态 marker=NULL, 配合下方 UNIQUE 即「partial unique index」语义
    active_marker   TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_update_logs_active (active_marker),
    KEY ix_update_logs_status_published (status, published_at),
    KEY ix_update_logs_created_at       (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='更新日志: pending=未通知 (仅管理员可见), active=通知中 (顶部横幅 + 用户页), ended=已结束 (仅用户页)';
"""


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :t"
        ),
        {"t": table_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _table_exists(conn, "update_logs"):
            conn.execute(text(SQL_CREATE_TABLE))
            print("  created table: update_logs")
        else:
            print("  skipped (exists): update_logs table")

    print("Migration done.")


if __name__ == "__main__":
    run()
