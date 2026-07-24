"""
迁移：创建 collection_shares 表 (合集分享).

说明
----
- collection_shares: 与 note_shares 结构类似，但关联 note_collections.id 而非
  video_tasks.task_id，用于支持"分享整个合集"功能。
- 完整字段说明见 ``app/db/models/collection_share.py``。

用法:
    python -m app.db.migrate_add_collection_share

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db() (Base.metadata.create_all 已包含此表)，
本脚本仅用于已有数据库的手动升级。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_COLLECTION_SHARES = """
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
        if not _table_exists(conn, "collection_shares"):
            conn.execute(text(SQL_CREATE_COLLECTION_SHARES))
            print("  created table: collection_shares")
        else:
            print("  skipped (exists): collection_shares table")

    print("Migration done.")


if __name__ == "__main__":
    run()
