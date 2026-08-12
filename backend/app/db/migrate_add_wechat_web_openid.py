"""
迁移脚本: 为 users 表添加微信开放平台『网站应用』的 wechat_web_openid 字段
(用于 Web 端扫码登录, 与已有的 wechat_openid 是不同 AppID 下的两个 openid, 通过 unionid 关联).

- 新库部署: init_db() 里的 Base.metadata.create_all 会自动带上, 无需手动执行
- 存量部署: 手动执行 `python -m app.db.migrate_add_wechat_web_openid`
- 同时支持 SQLite 和 MySQL 两种方言 (与生产 MySQL / 开发/桌面 SQLite 保持一致)
"""
from sqlalchemy import text

from app.db.engine import get_engine


def run():
    engine = get_engine()
    dialect = engine.dialect.name

    if dialect == "sqlite":
        _run_sqlite(engine)
    elif dialect == "mysql":
        _run_mysql(engine)
    else:
        print(f"[wechat-web-migrate] 未知数据库方言 {dialect}, 请手动执行 ALTER TABLE")


def _run_sqlite(engine):
    with engine.connect() as conn:
        raw_conn = conn.connection
        existing_cols = {
            row[1] for row in raw_conn.execute("PRAGMA table_info(users)").fetchall()
        }
        if "wechat_web_openid" in existing_cols:
            print("[wechat-web-migrate] SQLite: 列 wechat_web_openid 已存在, 跳过")
            return
        # SQLite 不支持在 ALTER TABLE 时直接加 UNIQUE 索引到列上, 分两步做
        raw_conn.execute("ALTER TABLE users ADD COLUMN wechat_web_openid TEXT DEFAULT NULL")
        raw_conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uk_users_wechat_web_openid "
            "ON users(wechat_web_openid) WHERE wechat_web_openid IS NOT NULL"
        )
        conn.commit()
        print("[wechat-web-migrate] SQLite: 迁移完成")


def _run_mysql(engine):
    with engine.connect() as conn:
        exists = conn.execute(
            text(
                "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' "
                "AND COLUMN_NAME = 'wechat_web_openid'"
            )
        ).scalar()

        if exists:
            print("[wechat-web-migrate] MySQL: 列 wechat_web_openid 已存在, 跳过")
            return

        # 加列 + 唯一索引一步完成; UNIQUE KEY 允许多个 NULL, 空 openid 不会互相冲突
        conn.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN wechat_web_openid VARCHAR(64) NULL "
                "COMMENT '微信开放平台网站应用 openid, Web 扫码登录用' "
                "AFTER wechat_openid, "
                "ADD UNIQUE KEY uk_users_wechat_web_openid (wechat_web_openid)"
            )
        )
        conn.commit()
        print("[wechat-web-migrate] MySQL: 迁移完成")


if __name__ == "__main__":
    run()
