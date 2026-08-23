"""Add the administrator pending-notification email preference.

Safe to run multiple times. Existing users default to opt-in disabled so the
new notification stream never starts sending without an explicit choice.
"""

import os
import sys

from sqlalchemy import inspect, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.db.engine import get_engine  # noqa: E402


COLUMN_NAME = "pending_notification_email_enabled"


def run():
    engine = get_engine()
    with engine.begin() as conn:
        existing = {column["name"] for column in inspect(conn).get_columns("users")}
        if COLUMN_NAME in existing:
            print(f"  skipped (exists): {COLUMN_NAME}")
            return

        column_type = "TINYINT" if engine.dialect.name == "mysql" else "INTEGER"
        conn.execute(text(
            f"ALTER TABLE users ADD COLUMN {COLUMN_NAME} {column_type} NOT NULL DEFAULT 0"
        ))
        print(f"  added column: {COLUMN_NAME}")


if __name__ == "__main__":
    run()
