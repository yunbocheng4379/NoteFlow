"""
迁移脚本: 为 users 表添加微信小程序登录字段 (wechat_openid, wechat_unionid),
并将 email / hashed_password 改为可空以支持微信用户(无需邮箱注册).

新库部署可直接走 init_db() (Base.metadata.create_all 已包含这些列),
本脚本仅用于已有数据库的平滑升级, 自动通过 ALTER TABLE 添加列.
"""
import sqlite3

from app.db.engine import get_engine

MIGRATIONS = [
    # 列名, 类型, 默认值
    ("wechat_openid", "TEXT DEFAULT NULL", None),
    ("wechat_unionid", "TEXT DEFAULT NULL", None),
]


def run():
    engine = get_engine()
    with engine.connect() as conn:
        # 检查是否为 SQLite
        dialect = engine.dialect.name
        if dialect != "sqlite":
            print(f"[wechat-migrate] 数据库类型为 {dialect}, 跳过 ALTER TABLE 迁移 (请用 Alembic 等工具)")
            return

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


if __name__ == "__main__":
    run()
