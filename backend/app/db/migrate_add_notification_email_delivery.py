"""Create notification email audit tables for existing installations.

The migration is intentionally SQLAlchemy-based so it is safe to run against
both the project's MySQL database and the SQLite databases used by tests.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.db.engine import get_engine  # noqa: E402
from app.db.models.notification_email import (  # noqa: E402
    NotificationEmailBatch,
    NotificationEmailBatchItem,
    NotificationEmailDelivery,
)


def run(engine=None):
    engine = engine or get_engine()
    NotificationEmailBatch.metadata.create_all(
        bind=engine,
        tables=[
            NotificationEmailBatch.__table__,
            NotificationEmailBatchItem.__table__,
            NotificationEmailDelivery.__table__,
        ],
    )
    print("Notification email delivery tables ready.")


if __name__ == "__main__":
    run()
