"""
One-time migration: add last_login_at, total_points, used_points to users table.
Safe to run multiple times (skips columns that already exist).
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

        migrations = [
            ("last_login_at", "DATETIME NULL"),
            ("total_points", "INT NOT NULL DEFAULT 100"),
            ("used_points", "INT NOT NULL DEFAULT 0"),
        ]

        for col, definition in migrations:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {definition}"))
                conn.commit()
                print(f"  added column: {col}")
            else:
                print(f"  skipped (exists): {col}")

    print("Migration done.")


if __name__ == "__main__":
    run()
