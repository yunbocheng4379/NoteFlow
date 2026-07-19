"""
为 platform_cookies 表新增 cohort / reserved_for_tier / max_concurrent_uses / in_use_count
字段, 同时建 2 个新索引:
  - ix_platform_cookies_cohort (单字段)
  - ix_platform_cookies_platform_status_cohort (复合, cover 大多数过滤场景)

幂等: 字段/索引已存在则跳过.

跑法:
  cd backend
  python -m app.db.migrate_add_cookie_cohort_and_quota
"""
import logging
import sys
from pathlib import Path

_THIS = Path(__file__).resolve()
_BACKEND = _THIS.parents[2]  # backend/
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate.cookie.cohort")


def _try_exec(conn, sql: str, expected_failure: tuple = ()) -> None:
    """执行 SQL; 命中 expected_failure 的异常信息时视为已存在, 跳过."""
    try:
        conn.execute(sql)
        logger.info("已执行: %s", sql)
    except Exception as e:
        msg = str(e).lower()
        for token in expected_failure:
            if token in msg:
                logger.info("已存在, 跳过: %s  (原因: %s)", sql, token)
                return
        raise


def migrate_sqlite(conn) -> None:
    """SQLite 上 ALTER ADD COLUMN 不允许设 NOT NULL DEFAULT, 必须分两步:
    1) ADD COLUMN 允许 NULL
    2) UPDATE 把历史行填默认值
    3) (SQLite 没有 MODIFY COLUMN 概念) 保留 nullable, 但 ORM 层和 DAO 始终写默认.

    SQLite 没有 CREATE INDEX IF NOT EXISTS (其实有), 用 try/except 兜底.
    """
    from sqlalchemy import text

    # ---- cohort ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN cohort VARCHAR(64) DEFAULT 'default'"),
        ("duplicate column",),
    )
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET cohort='default' WHERE cohort IS NULL"
        ))
    except Exception:
        pass

    # ---- reserved_for_tier ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN reserved_for_tier TEXT"),
        ("duplicate column",),
    )

    # ---- max_concurrent_uses ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN max_concurrent_uses INTEGER DEFAULT 0"),
        ("duplicate column",),
    )
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET max_concurrent_uses=0 WHERE max_concurrent_uses IS NULL"
        ))
    except Exception:
        pass

    # ---- in_use_count ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN in_use_count INTEGER DEFAULT 0"),
        ("duplicate column",),
    )
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET in_use_count=0 WHERE in_use_count IS NULL"
        ))
    except Exception:
        pass

    # ---- 索引 ----
    _try_exec(
        conn,
        text("CREATE INDEX IF NOT EXISTS ix_platform_cookies_cohort ON platform_cookies (cohort)"),
        ("already exists",),
    )
    _try_exec(
        conn,
        text("CREATE INDEX IF NOT EXISTS ix_platform_cookies_platform_status_cohort "
             "ON platform_cookies (platform, is_enabled, is_marked_invalid, cohort)"),
        ("already exists",),
    )


def migrate_mysql(conn) -> None:
    """MySQL 上 ALTER 加列后, 必须给 NOT NULL 列指定默认值 (sql_mode=STRICT 会拒绝 NULL 隐式默认).

    MySQL 8 没有 IF NOT EXISTS for ALTER ADD COLUMN, 这里用 try/except 幂等.
    """
    from sqlalchemy import text

    # ---- cohort ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN cohort VARCHAR(64) DEFAULT 'default'"),
        ("duplicate column", "already exists"),
    )
    # 把历史行填默认值 + 收紧 NOT NULL (MySQL: MODIFY COLUMN 同时改 DEFAULT + NOT NULL)
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET cohort='default' WHERE cohort IS NULL"
        ))
    except Exception:
        pass
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies "
             "MODIFY COLUMN cohort VARCHAR(64) NOT NULL DEFAULT 'default'"),
        (),
    )

    # ---- reserved_for_tier (允许 NULL) ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN reserved_for_tier TEXT"),
        ("duplicate column", "already exists"),
    )

    # ---- max_concurrent_uses ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN max_concurrent_uses INT DEFAULT 0"),
        ("duplicate column", "already exists"),
    )
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET max_concurrent_uses=0 WHERE max_concurrent_uses IS NULL"
        ))
    except Exception:
        pass
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies "
             "MODIFY COLUMN max_concurrent_uses INT NOT NULL DEFAULT 0"),
        (),
    )

    # ---- in_use_count ----
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies ADD COLUMN in_use_count INT DEFAULT 0"),
        ("duplicate column", "already exists"),
    )
    try:
        conn.execute(text(
            "UPDATE platform_cookies SET in_use_count=0 WHERE in_use_count IS NULL"
        ))
    except Exception:
        pass
    _try_exec(
        conn,
        text("ALTER TABLE platform_cookies "
             "MODIFY COLUMN in_use_count INT NOT NULL DEFAULT 0"),
        (),
    )

    # ---- 索引 ----
    # MySQL 8+ 支持 CREATE INDEX IF NOT EXISTS (没有的话用 information_schema 检查)
    _try_create_index_if_not_exists(
        conn,
        index_name="ix_platform_cookies_cohort",
        table="platform_cookies",
        columns="(cohort)",
    )
    _try_create_index_if_not_exists(
        conn,
        index_name="ix_platform_cookies_platform_status_cohort",
        table="platform_cookies",
        columns="(platform, is_enabled, is_marked_invalid, cohort)",
    )


def _try_create_index_if_not_exists(conn, *, index_name: str, table: str, columns: str) -> None:
    """MySQL 5.7 没有 CREATE INDEX IF NOT EXISTS, 用 information_schema 兜底."""
    from sqlalchemy import text
    try:
        conn.execute(text(f"CREATE INDEX {index_name} ON {table} {columns}"))
        logger.info("已创建索引: %s", index_name)
        return
    except Exception as e:
        msg = str(e).lower()
        if "duplicate" in msg or "already exists" in msg:
            logger.info("索引已存在, 跳过: %s", index_name)
            return
        # 没有 IF NOT EXISTS 也没 duplicate, 检查是不是版本支持
        try:
            r = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.statistics "
                "WHERE table_schema=DATABASE() AND table_name=:t AND index_name=:i"
            ), {"t": table, "i": index_name})
            n = r.scalar() or 0
            if n > 0:
                logger.info("索引已存在 (查询得), 跳过: %s", index_name)
                return
        except Exception:
            pass
        raise


def migrate():
    from app.db.engine import engine
    from sqlalchemy import text

    dialect = engine.dialect.name
    logger.info("检测到数据库方言: %s", dialect)

    fn = migrate_sqlite if dialect == "sqlite" else migrate_mysql
    with engine.begin() as conn:
        fn(conn)

    logger.info("migrate_add_cookie_cohort_and_quota 完成")


if __name__ == "__main__":
    migrate()
