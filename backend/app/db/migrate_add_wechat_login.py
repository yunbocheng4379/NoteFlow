"""
迁移脚本: 为 users 表添加微信小程序登录字段 (wechat_openid, wechat_unionid),
并将 email / hashed_password 改为可空以支持微信用户(无需邮箱注册).

新库部署可直接走 init_db() (Base.metadata.create_all 已包含这些列),
本脚本仅用于已有数据库的平滑升级, 自动通过 ALTER TABLE 添加列.
"""
from sqlalchemy import text

from app.db.engine import get_engine

MIGRATIONS = [
    # 列名, 类型, 默认值
    ("wechat_openid", "TEXT DEFAULT NULL", None),
    ("wechat_unionid", "TEXT DEFAULT NULL", None),
]


def run():
    engine = get_engine()
    dialect = engine.dialect.name
    if dialect == "sqlite":
        _run_sqlite(engine)
    elif dialect == "mysql":
        _run_mysql(engine)
    else:
        print(f"[wechat-migrate] 未知数据库方言 {dialect}, 请手动执行 ALTER TABLE")


def _run_sqlite(engine):
    with engine.connect() as conn:
        raw_conn = conn.connection  # sqlite3 原生连接
        existing_cols = {
            row[1]
            for row in raw_conn.execute("PRAGMA table_info(users)").fetchall()
        }

        for col_name, col_type, default_val in MIGRATIONS:
            if col_name in existing_cols:
                print(f"[wechat-migrate] 列 {col_name} 已存在, 跳过")
                continue
            sql = f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"
            print(f"[wechat-migrate] 执行: {sql}")
            raw_conn.execute(sql)

        conn.commit()
    print("[wechat-migrate] 迁移完成")


def _run_mysql(engine):
    migrations = [
        (
            "wechat_openid",
            "VARCHAR(64) NULL COMMENT '微信小程序 openid, 用于快捷登录' "
            "AFTER hashed_password, ADD UNIQUE KEY uk_users_wechat_openid (wechat_openid)",
        ),
        (
            "wechat_unionid",
            "VARCHAR(64) NULL COMMENT '微信开放平台 unionid, 跨应用统一用户标识' "
            "AFTER wechat_openid, ADD UNIQUE KEY uk_users_wechat_unionid (wechat_unionid)",
        ),
    ]

    with engine.connect() as conn:
        for column_name, column_definition in migrations:
            exists = conn.execute(
                text(
                    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' "
                    f"AND COLUMN_NAME = '{column_name}'"
                )
            ).scalar()
            if exists:
                print(f"[wechat-migrate] MySQL: 列 {column_name} 已存在, 跳过")
                continue

            sql = f"ALTER TABLE users ADD COLUMN {column_name} {column_definition}"
            print(f"[wechat-migrate] MySQL 执行: {sql}")
            conn.execute(text(sql))

        conn.commit()
    print("[wechat-migrate] MySQL: 迁移完成")


if __name__ == "__main__":
    run()
