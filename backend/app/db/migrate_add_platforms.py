"""
迁移：为 platforms 表创建初始化数据（仅新增，不破坏现有数据）.

用法（后端启动时自动调用，或手动执行一次）:
    python -m app.db.migrate_add_platforms

确保此迁移幂等：重复执行不会报错。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.db.engine import SessionLocal, engine, Base
from app.db.models import Platform  # noqa: F401 — 触发模型导入以创建表
from app.db.platform_dao import PlatformDAO


def run():
    # 确保表已创建（幂等）
    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        dao = PlatformDAO(db)
        platforms = dao.seed_default_if_empty()
        print(f"[migrate_add_platforms] 当前平台数: {len(platforms)}")
        for p in platforms:
            print(f"  - {p.platform_id}: {p.name}  is_enabled={p.is_enabled}  proxy={p.proxy_url or '(全局)'}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
