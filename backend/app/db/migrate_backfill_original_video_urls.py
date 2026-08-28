"""Backfill original web URLs for legacy Douyin/Kuaishou task records."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.db.video_task_dao import backfill_original_video_urls


if __name__ == "__main__":
    print(f"Backfilled {backfill_original_video_urls()} video task URL(s).")
