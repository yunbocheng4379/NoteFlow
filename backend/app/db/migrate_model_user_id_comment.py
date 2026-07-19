"""
One-time migration: update models.user_id column comment.

- models.user_id 的语义已从"所属用户 ID（数据隔离键）"变更为"创建人 id"（仅用于追溯，不参与查询过滤）。
- 该迁移只修改列的 COMMENT 文案，不改变列类型/可空性/索引，安全可重复运行。

用法:
  python -m app.db.migrate_model_user_id_comment
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE models MODIFY COLUMN user_id INT NULL COMMENT '创建人 id'"
        ))
        conn.commit()
        print("  updated comment: models.user_id -> '创建人 id'")

    print("Migration done.")


if __name__ == "__main__":
    run()
