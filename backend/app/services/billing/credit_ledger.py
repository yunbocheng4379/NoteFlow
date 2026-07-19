"""
电力账本 (Credit Ledger) 核心模块
=====================================
此模块是系统中所有电力 (credits) 出入的唯一通道. 任何加电/扣电/退电操作都
必须经过这里, 以保证:

  1. 行级锁: 通过 SELECT ... FOR UPDATE 防止并发双扣 / 双加
  2. 事务一致性: 每次操作 = 一次余额 UPDATE + 一次 INSERT 流水 (account ↔ ledger)
  3. 审计完整: 每笔变动都有一条 credit_transactions 行, 永久保留
  4. 退费幂等: 同一 task_id 的 CONSUME 行只能被退一次 (refunded_at 防重放)

接口说明:
  - 所有函数都接收一个 SQLAlchemy `Session` 作为第一参数, 由调用方提供.
    调用方需自己控制事务边界 (with db.begin(): ... 或 db.commit()).
  - 函数内部不会调用 db.commit() / db.begin() / db.close().
  - 函数会调用 db.flush() 让 INSERT/UPDATE 落到 DB 上, 触发 FK/UNIQUE 约束检查
    与释放 FOR UPDATE 行锁后供下一函数复用读到的数据.

约定:
  - amount 必须为正整数 (consume 内部转负数), grant 接受正整数.
  - 任何会修改余额的函数都会先 SELECT users FOR UPDATE 锁定该用户行.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models.users import User
from app.db.models.credit_transactions import CreditTransaction, CREDIT_TX_TYPES
from app.services.billing.exceptions import InsufficientCreditError, InvalidTransactionError
from app.utils.logger import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# 读 (无锁)
# ---------------------------------------------------------------------------
def get_balance(db: Session, user_id: int) -> int:
    """返回用户当前电力余额 (无锁读)"""
    row = db.execute(select(User.credits).where(User.id == user_id)).first()
    if not row:
        return 0
    return int(row[0] or 0)


# ---------------------------------------------------------------------------
# 内部工具: 加锁读 + 写流水
# ---------------------------------------------------------------------------
def _lock_user_for_update(db: Session, user_id: int) -> User:
    """SELECT users WHERE id=:uid FOR UPDATE, 返回锁定的 User 行"""
    user = db.execute(
        select(User).where(User.id == user_id).with_for_update()
    ).scalar_one_or_none()
    if not user:
        raise InvalidTransactionError(f"用户不存在: user_id={user_id}")
    return user


def _insert_tx(
    db: Session,
    *,
    user_id: int,
    type_: str,
    amount: int,
    balance_after: int,
    related_task_id: Optional[str] = None,
    related_order_id: Optional[int] = None,
    related_subscription_id: Optional[int] = None,
    related_referral_id: Optional[int] = None,
    note: Optional[str] = None,
) -> CreditTransaction:
    """落一条 credit_transactions 流水"""
    if type_ not in CREDIT_TX_TYPES:
        raise InvalidTransactionError(f"未知流水类型: {type_}")
    tx = CreditTransaction(
        user_id=user_id,
        type=type_,
        amount=amount,
        balance_after=balance_after,
        related_task_id=related_task_id,
        related_order_id=related_order_id,
        related_subscription_id=related_subscription_id,
        related_referral_id=related_referral_id,
        note=note,
    )
    db.add(tx)
    db.flush()
    return tx


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------
def consume(
    db: Session,
    *,
    user_id: int,
    amount: int,
    task_id: str,
    model_name: Optional[str] = None,
    note: Optional[str] = None,
) -> CreditTransaction:
    """
    扣电 (生成笔记预扣).

    Args:
        amount: 必须为正整数 (内部会扣减此数, 流水 amount=-amount).
        task_id: 关联的 video_tasks.task_id, 必填 (退费时按此查回).

    Raises:
        InsufficientCreditError: 余额不足.

    要求:
        必须在调用方事务里 (with db.begin()) 调用, 函数内不开 commit.
    """
    if amount <= 0:
        raise InvalidTransactionError(f"consume amount 必须为正整数, got {amount}")
    if not task_id:
        raise InvalidTransactionError("consume 必须传 task_id")

    user = _lock_user_for_update(db, user_id)
    current = int(user.credits or 0)

    if current < amount:
        raise InsufficientCreditError(current=current, required=amount)

    user.credits = current - amount
    user.used_points = int(user.used_points or 0) + amount
    db.flush()

    tx = _insert_tx(
        db,
        user_id=user_id,
        type_="CONSUME",
        amount=-amount,
        balance_after=user.credits,
        related_task_id=task_id,
        note=note or (f"生成笔记 (model={model_name})" if model_name else "生成笔记"),
    )
    logger.info(f"[ledger] CONSUME user={user_id} amount={amount} balance_after={user.credits} task_id={task_id}")
    return tx


def refund(db: Session, *, task_id: str) -> Optional[CreditTransaction]:
    """
    退费 (任务失败时调用).

    通过 task_id 查到 CONSUME 流水, 反向加回电力, 并标记 CONSUME.refunded_at.
    幂等: 同一 task_id 的 CONSUME 已退过 (refunded_at != NULL) 则直接 return None.
    """
    if not task_id:
        raise InvalidTransactionError("refund 必须传 task_id")

    # 找到该 task 对应未退费的 CONSUME 行
    consume_tx: CreditTransaction | None = db.execute(
        select(CreditTransaction)
        .where(
            CreditTransaction.related_task_id == task_id,
            CreditTransaction.type == "CONSUME",
            CreditTransaction.refunded_at.is_(None),
        )
        .with_for_update()
    ).scalar_one_or_none()

    if not consume_tx:
        logger.info(f"[ledger] refund skipped (no unresolved CONSUME) task_id={task_id}")
        return None

    user_id = consume_tx.user_id
    refund_amount = abs(consume_tx.amount)  # 退回正数

    user = _lock_user_for_update(db, user_id)
    user.credits = int(user.credits or 0) + refund_amount
    user.used_points = max(0, int(user.used_points or 0) - refund_amount)
    db.flush()

    refund_tx = _insert_tx(
        db,
        user_id=user_id,
        type_="REFUND",
        amount=refund_amount,
        balance_after=user.credits,
        related_task_id=task_id,
        note=f"任务失败退费 (consume_tx_id={consume_tx.id})",
    )

    # 防重放标记
    consume_tx.refunded_at = datetime.now()
    db.flush()

    logger.info(f"[ledger] REFUND user={user_id} amount={refund_amount} balance_after={user.credits} task_id={task_id}")
    return refund_tx


def grant(
    db: Session,
    *,
    user_id: int,
    amount: int,
    type_: str,
    related_order_id: Optional[int] = None,
    related_subscription_id: Optional[int] = None,
    related_referral_id: Optional[int] = None,
    note: Optional[str] = None,
) -> CreditTransaction:
    """
    加电 (任何来源).

    Args:
        type_: 必须是 CREDIT_TX_TYPES 之一的 "加电" 类型:
               RECHARGE / MONTHLY_GRANT / REGISTER_GRANT / REGISTER_INVITEE /
               REGISTER_INVITER / FIRST_SUB_INVITER / ADMIN_ADJUST
        amount: 必须为正整数.
    """
    if amount <= 0:
        raise InvalidTransactionError(f"grant amount 必须为正整数, got {amount}")

    DISALLOWED = {"CONSUME", "REFUND"}
    if type_ in DISALLOWED:
        raise InvalidTransactionError(f"grant 不允许使用扣费类型: {type_}")

    user = _lock_user_for_update(db, user_id)
    user.credits = int(user.credits or 0) + amount
    db.flush()

    tx = _insert_tx(
        db,
        user_id=user_id,
        type_=type_,
        amount=amount,
        balance_after=user.credits,
        related_order_id=related_order_id,
        related_subscription_id=related_subscription_id,
        related_referral_id=related_referral_id,
        note=note,
    )
    logger.info(
        f"[ledger] GRANT user={user_id} type={type_} amount={amount} balance_after={user.credits}"
    )
    return tx


def admin_adjust(
    db: Session,
    *,
    user_id: int,
    delta: int,
    note: str,
) -> CreditTransaction:
    """
    管理员手动调整 (正负皆可). 必须填 note 说明原因.

    Args:
        delta: 调整量, 正=加, 负=扣.
    """
    if delta == 0:
        raise InvalidTransactionError("admin_adjust delta 不能为 0")
    if not note:
        raise InvalidTransactionError("admin_adjust 必须填 note")

    user = _lock_user_for_update(db, user_id)
    new_balance = int(user.credits or 0) + delta
    if new_balance < 0:
        raise InvalidTransactionError(f"admin_adjust 会导致余额为负: {new_balance}")
    user.credits = new_balance
    db.flush()

    tx = _insert_tx(
        db,
        user_id=user_id,
        type_="ADMIN_ADJUST",
        amount=delta,
        balance_after=new_balance,
        note=note,
    )
    logger.info(f"[ledger] ADMIN_ADJUST user={user_id} delta={delta} balance_after={new_balance}")
    return tx
