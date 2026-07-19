"""
One-time migration: add email_notify_enabled to users table.
Safe to run multiple times (skips column if it already exists).
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(text("SHOW COLUMNS FROM users"))
        existing = {row[0] for row in result}

        if "email_notify_enabled" not in existing:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN email_notify_enabled TINYINT NOT NULL DEFAULT 1"
            ))
            conn.commit()
            print("  added column: email_notify_enabled")
        else:
            print("  skipped (exists): email_notify_enabled")

    print("Migration done.")


if __name__ == "__main__":
    run()
