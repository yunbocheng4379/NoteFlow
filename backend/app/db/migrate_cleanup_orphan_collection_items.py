"""
数据修复：清理 note_collection_items 中悬空的关联记录.

背景
----
早期 /api/tasks/{task_id} 删除笔记、以及按 video_id 删除笔记(delete_task_by_video)
两条路径都只删了 video_tasks 行，没有同步清理 note_collection_items 里的关联记录。
这会导致合集详情页的 note_count (对 note_collection_items 做 COUNT) 比合集里
实际还能查到的笔记数量偏大 —— 表现为：合集外部卡片显示"N 篇笔记"，
点进详情却看不到对应数量的笔记。

这两条删除路径已经在 note.py / video_task_dao.py 里修复为会同步清理关联记录，
本脚本只用于一次性清掉历史遗留的悬空数据。

用法:
    python -m app.db.migrate_cleanup_orphan_collection_items

幂等: 重复执行不会报错，没有悬空记录时什么都不做。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        orphans = conn.execute(
            text(
                "SELECT nci.id, nci.collection_id, nci.task_id FROM note_collection_items nci "
                "LEFT JOIN video_tasks vt ON vt.task_id = nci.task_id "
                "WHERE vt.task_id IS NULL"
            )
        ).fetchall()

        if not orphans:
            print("  no orphan collection items found.")
            print("Migration done.")
            return

        print(f"  found {len(orphans)} orphan collection item(s):")
        for row in orphans:
            print(f"    - collection_item.id={row[0]} collection_id={row[1]} task_id={row[2]}")

        affected_collection_ids = sorted({row[1] for row in orphans})
        orphan_ids = [row[0] for row in orphans]

        conn.execute(
            text(
                "DELETE FROM note_collection_items WHERE id IN ("
                + ",".join(str(i) for i in orphan_ids)
                + ")"
            )
        )
        print(f"  deleted {len(orphan_ids)} orphan row(s)")

        for cid in affected_collection_ids:
            conn.execute(
                text("UPDATE note_collections SET updated_at = NOW() WHERE id = :cid"),
                {"cid": cid},
            )
        print(f"  touched {len(affected_collection_ids)} affected collection(s)")

    print("Migration done.")


if __name__ == "__main__":
    run()
