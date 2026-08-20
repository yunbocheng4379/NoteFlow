from datetime import datetime
from types import SimpleNamespace

import pytest

from app.db.models.orders import Order
from app.services.billing import order_service
from app.services.billing.exceptions import OrderStateError


class _Result:
    def __init__(self, *, scalar=None, rows=()):
        self._scalar = scalar
        self._rows = list(rows)

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _LockingDb:
    def __init__(self, order):
        self.order = order
        self.flush_count = 0

    def execute(self, _statement):
        return _Result(scalar=self.order)

    def flush(self):
        self.flush_count += 1


class _ListingDb:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)
        return _Result(rows=[])


def _order(*, status="CANCELLED", user_id=7, hidden_at=None):
    return SimpleNamespace(
        order_no="BN20260820SOFTDELETE",
        user_id=user_id,
        status=status,
        hidden_at=hidden_at,
    )


def test_order_model_has_nullable_hidden_at_column():
    assert hasattr(Order, "hidden_at")
    assert Order.hidden_at.property.columns[0].nullable is True


def test_hide_cancelled_order_sets_hidden_at_and_is_idempotent():
    order = _order()
    db = _LockingDb(order)

    hidden = order_service.hide_order(db, order.order_no, current_user_id=7)
    hidden_again = order_service.hide_order(db, order.order_no, current_user_id=7)

    assert hidden is order
    assert hidden_again is order
    assert isinstance(order.hidden_at, datetime)
    assert db.flush_count == 1


@pytest.mark.parametrize("status", ["PENDING", "PAID", "REFUNDED"])
def test_hide_order_rejects_non_cancelled_order(status):
    db = _LockingDb(_order(status=status))

    with pytest.raises(OrderStateError, match="已关闭"):
        order_service.hide_order(db, db.order.order_no, current_user_id=7)


def test_hide_order_rejects_another_users_order():
    db = _LockingDb(_order(user_id=8))

    with pytest.raises(OrderStateError, match="订单不存在"):
        order_service.hide_order(db, db.order.order_no, current_user_id=7)


def test_user_order_queries_exclude_hidden_records():
    db = _ListingDb()

    order_service.get_order_by_no(db, user_id=7, order_no="BN20260820SOFTDELETE")
    order_service.list_user_orders(db, user_id=7)

    assert len(db.statements) == 3
    assert all("hidden_at" in str(statement) for statement in db.statements)
    assert all("IS NULL" in str(statement) for statement in db.statements)
