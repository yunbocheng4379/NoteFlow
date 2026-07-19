"""
One-time migration: add is_admin column to users table + bootstrap 初始管理员.

- 给 users 表加 is_admin (TINYINT, default 0), 已存在则跳过.
- 从环境变量 ADMIN_USERNAME / ADMIN_EMAIL 读取初始管理员账号, 把匹配到的
  已注册用户提升为管理员 (is_admin=1). 两个变量可同时配置, 命中任一即提升.

安全: 可重复运行. 不会创建用户, 只提升「已存在」的用户.

用法:
  ADMIN_USERNAME=alice python -m app.db.migrate_add_admin
  ADMIN_EMAIL=alice@example.com python -m app.db.migrate_add_admin
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        # 1. 加列 (若不存在)
        result = conn.execute(text("SHOW COLUMNS FROM users"))
        existing = {row[0] for row in result}

        if "is_admin" not in existing:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN is_admin TINYINT NOT NULL DEFAULT 0"
            ))
            conn.commit()
            print("  added column: is_admin")
        else:
            print("  skipped (exists): is_admin")

        # 2. 从环境变量提升初始管理员
        admin_username = (os.getenv("ADMIN_USERNAME") or "").strip()
        admin_email = (os.getenv("ADMIN_EMAIL") or "").strip()

        if not admin_username and not admin_email:
            print("  no ADMIN_USERNAME / ADMIN_EMAIL set, skip bootstrap")
        else:
            promoted = 0
            if admin_username:
                r = conn.execute(
                    text("UPDATE users SET is_admin = 1 WHERE username = :u"),
                    {"u": admin_username},
                )
                conn.commit()
                promoted += r.rowcount or 0
                print(f"  bootstrap by username={admin_username}: matched {r.rowcount}")
            if admin_email:
                r = conn.execute(
                    text("UPDATE users SET is_admin = 1 WHERE email = :e"),
                    {"e": admin_email},
                )
                conn.commit()
                promoted += r.rowcount or 0
                print(f"  bootstrap by email={admin_email}: matched {r.rowcount}")

            if promoted == 0:
                print("  WARNING: 未匹配到任何用户, 请确认该账号已注册")

    print("Migration done.")


if __name__ == "__main__":
    run()
