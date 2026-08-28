"""Create AI usage audit and model pricing tables.

The migration is intentionally idempotent. New installations also create the
tables through SQLAlchemy metadata during init_db().
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.db.engine import Base, get_engine
from app.db.models.ai_usage import AIModelPricing, AIUsageLog


def run() -> None:
    engine = get_engine()
    Base.metadata.create_all(
        bind=engine,
        tables=[AIUsageLog.__table__, AIModelPricing.__table__],
    )
    print("AI usage migration done.")


if __name__ == "__main__":
    run()
