"""
电力 / 计费系统迁移脚本 — Phase 1
====================================
本脚本在 billing_init.sql 执行后运行, 一次性把现有 users 的数据回填到新结构:
  1. 把 total_points → credits (老用户保留原有 100 点)
  2. 为每个用户生成全局唯一的 referral_code
  3. 写一条 REGISTER_GRANT 审计流水, balance_after = credits, 备注 "历史用户初始电力"

幂等保证: 已经迁移过的用户 (credits>0 且 referral_code 不为空) 直接跳过.

执行方式:
  cd backend && python -m app.db.migrate_billing_phase1
"""
import random
import string
from datetime import datetime

from sqlalchemy import select

from app.db.engine import SessionLocal
# 导入所有 model 让 SQLAlchemy 能解析外键 (users.active_subscription_id -> subscriptions.id 等)
import app.db.init_db  # noqa: F401
from app.db.models.users import User
from app.db.models.credit_transactions import CreditTransaction
from app.utils.logger import get_logger

logger = get_logger(__name__)

# base32 字符集 (去掉易混 0/O/1/I/L)
REFERRAL_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
REFERRAL_LEN = 6
MAX_RETRIES = 10


def gen_referral_code() -> str:
    return "".join(random.choices(REFERRAL_CHARS, k=REFERRAL_LEN))


def gen_unique_referral_code(db) -> str:
    for _ in range(MAX_RETRIES):
        code = gen_referral_code()
        exists = db.execute(select(User.id).where(User.referral_code == code)).first()
        if not exists:
            return code
    raise RuntimeError("无法生成唯一 referral_code, 重试 10 次仍冲突")


def migrate():
    db = SessionLocal()
    try:
        # 锁住所有 users 行 (单进程跑迁移, 但保险起见)
        users = db.execute(select(User).order_by(User.id)).scalars().all()
        logger.info(f"待迁移用户数: {len(users)}")

        migrated = 0
        skipped = 0

        for u in users:
            # 跳过已迁移用户
            if u.credits and u.credits > 0 and u.referral_code:
                skipped += 1
                continue

            # 1. credits 来自 total_points (或默认 100)
            initial_credits = u.total_points if (u.total_points is not None and u.total_points > 0) else 100

            # 2. referral_code
            if not u.referral_code:
                u.referral_code = gen_unique_referral_code(db)
                db.flush()  # 让唯一索引立刻生效

            # 3. credits 字段
            u.credits = initial_credits

            # 4. 审计流水 (REGISTER_GRANT)
            tx = CreditTransaction(
                user_id=u.id,
                type="REGISTER_GRANT",
                amount=initial_credits,
                balance_after=initial_credits,
                note="历史用户初始电力 (迁移脚本回填)",
            )
            db.add(tx)
            migrated += 1
            logger.info(f"迁移用户 id={u.id}, username={u.username}, credits={initial_credits}, referral_code={u.referral_code}")

        db.commit()
        logger.info(f"迁移完成: migrated={migrated}, skipped={skipped}, total={len(users)}")
        return {"migrated": migrated, "skipped": skipped, "total": len(users)}
    except Exception:
        db.rollback()
        logger.exception("迁移失败, 已回滚")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print(f"[{datetime.now()}] 开始迁移 billing phase1")
    result = migrate()
    print(f"[{datetime.now()}] 迁移结果: {result}")
