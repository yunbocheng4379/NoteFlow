"""
One-time migration: add system_announce_enabled to users table.
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

        if "system_announce_enabled" not in existing:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN system_announce_enabled TINYINT NOT NULL DEFAULT 1"
            ))
            conn.commit()
            print("  added column: system_announce_enabled")
        else:
            print("  skipped (exists): system_announce_enabled")

    print("Migration done.")


if __name__ == "__main__":
    run()
