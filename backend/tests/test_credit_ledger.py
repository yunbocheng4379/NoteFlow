"""
credit_ledger.py 集成测试 — 直连本地 MySQL.
覆盖财务红线: 余额不足, 并发扣费, 退费幂等, 负余额防御.

跑法:
  cd backend && pytest tests/test_credit_ledger.py -v
"""
import os
import pytest
import threading
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import app.db.init_db  # noqa: F401  让所有 model 被 SQLAlchemy 注册
from app.db.engine import SessionLocal
from app.db.models.users import User
from app.db.models.credit_transactions import CreditTransaction
from app.services.billing import credit_ledger
from app.services.billing.exceptions import InsufficientCreditError, InvalidTransactionError


# ---------- Fixtures ----------

@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def test_user(db):
    """每个测试创建一个独立用户, 测试结束后清理"""
    suffix = datetime.now().strftime("%H%M%S%f")
    u = User(
        username=f"ledger_test_{suffix}",
        email=f"ledger_{suffix}@test.local",
        hashed_password="x",
        credits=0,
        total_points=0,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id

    yield u

    # cleanup
    db.execute(CreditTransaction.__table__.delete().where(CreditTransaction.user_id == user_id))
    db.execute(User.__table__.delete().where(User.id == user_id))
    db.commit()


# ---------- 基础正确性 ----------

def test_grant_increases_credits(db, test_user):
    tx = credit_ledger.grant(
        db, user_id=test_user.id, amount=500, type_="RECHARGE", note="充值测试"
    )
    db.commit()
    db.refresh(test_user)

    assert test_user.credits == 500
    assert tx.amount == 500
    assert tx.balance_after == 500
    assert tx.type == "RECHARGE"


def test_consume_decreases_credits(db, test_user):
    credit_ledger.grant(db, user_id=test_user.id, amount=300, type_="RECHARGE")
    db.commit()

    credit_ledger.consume(db, user_id=test_user.id, amount=120, task_id="task-A", model_name="gpt-4o")
    db.commit()
    db.refresh(test_user)

    assert test_user.credits == 180
    assert test_user.used_points == 120


def test_consume_insufficient_raises(db, test_user):
    credit_ledger.grant(db, user_id=test_user.id, amount=50, type_="REGISTER_GRANT")
    db.commit()

    with pytest.raises(InsufficientCreditError) as exc_info:
        credit_ledger.consume(db, user_id=test_user.id, amount=100, task_id="task-X")
    # 应未扣减
    db.rollback()
    db.refresh(test_user)
    assert test_user.credits == 50
    assert exc_info.value.current == 50
    assert exc_info.value.required == 100


# ---------- 退费幂等 ----------

def test_refund_restores_credits(db, test_user):
    credit_ledger.grant(db, user_id=test_user.id, amount=200, type_="RECHARGE")
    credit_ledger.consume(db, user_id=test_user.id, amount=150, task_id="task-refund-1")
    db.commit()

    refund_tx = credit_ledger.refund(db, task_id="task-refund-1")
    db.commit()
    db.refresh(test_user)

    assert refund_tx is not None
    assert refund_tx.amount == 150
    assert test_user.credits == 200  # 退回去了
    assert test_user.used_points == 0


def test_refund_idempotent(db, test_user):
    """同一 task 调两次退费, 只能生效一次"""
    credit_ledger.grant(db, user_id=test_user.id, amount=300, type_="RECHARGE")
    credit_ledger.consume(db, user_id=test_user.id, amount=100, task_id="task-idem")
    db.commit()

    r1 = credit_ledger.refund(db, task_id="task-idem")
    db.commit()
    r2 = credit_ledger.refund(db, task_id="task-idem")
    db.commit()
    db.refresh(test_user)

    assert r1 is not None
    assert r2 is None  # 第二次退费应为 None (已经被退过)
    assert test_user.credits == 300


def test_refund_no_consume_returns_none(db, test_user):
    """未存在的 task_id 调退费, 不报错, 返回 None"""
    r = credit_ledger.refund(db, task_id="task-not-exist")
    db.commit()
    assert r is None


# ---------- 防呆 ----------

def test_consume_zero_raises(db, test_user):
    with pytest.raises(InvalidTransactionError):
        credit_ledger.consume(db, user_id=test_user.id, amount=0, task_id="t")
    db.rollback()


def test_grant_negative_raises(db, test_user):
    with pytest.raises(InvalidTransactionError):
        credit_ledger.grant(db, user_id=test_user.id, amount=-10, type_="RECHARGE")
    db.rollback()


def test_grant_disallowed_type_raises(db, test_user):
    with pytest.raises(InvalidTransactionError):
        credit_ledger.grant(db, user_id=test_user.id, amount=10, type_="CONSUME")
    db.rollback()


def test_admin_adjust_negative_balance_blocked(db, test_user):
    credit_ledger.grant(db, user_id=test_user.id, amount=10, type_="RECHARGE")
    db.commit()
    with pytest.raises(InvalidTransactionError):
        credit_ledger.admin_adjust(db, user_id=test_user.id, delta=-50, note="尝试扣超")
    db.rollback()
    db.refresh(test_user)
    assert test_user.credits == 10  # 不变


# ---------- 并发安全 (行级锁) ----------

def test_concurrent_consume_locks_correctly(db, test_user):
    """10 个并发线程各扣 100, 初始余额 500, 应该只有 5 个成功, 5 个 InsufficientCredit"""
    credit_ledger.grant(db, user_id=test_user.id, amount=500, type_="RECHARGE")
    db.commit()
    user_id = test_user.id

    results = {"ok": 0, "fail": 0}
    lock = threading.Lock()

    def worker(i):
        s = SessionLocal()
        try:
            with s.begin():
                credit_ledger.consume(
                    s, user_id=user_id, amount=100, task_id=f"concurrent-{i}"
                )
            with lock:
                results["ok"] += 1
        except InsufficientCreditError:
            with lock:
                results["fail"] += 1
        finally:
            s.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # 关键: fixture session 默认 REPEATABLE READ 会缓存快照, 必须 commit 后再 refresh
    db.commit()
    db.refresh(test_user)
    assert test_user.credits == 0
    assert results["ok"] == 5
    assert results["fail"] == 5

    # 流水审计: 应该有 5 条 CONSUME, balance_after 严格递减
    txs = (
        db.execute(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user_id, CreditTransaction.type == "CONSUME")
            .order_by(CreditTransaction.id.asc())
        )
        .scalars()
        .all()
    )
    assert len(txs) == 5
    balances = [t.balance_after for t in txs]
    assert balances == [400, 300, 200, 100, 0]
