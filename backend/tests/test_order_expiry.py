import os
from pathlib import Path
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.db.models.orders import Order
from app.services.billing import order_service
from app.services.billing.exceptions import OrderStateError


MIGRATION = Path(__file__).parents[1] / "sql" / "migrate_add_order_expiry.sql"


def test_order_model_has_nullable_expiry_column():
    column = Order.__table__.c.expires_at

    assert column.nullable is True
    assert column.type.python_type.__name__ == "datetime"


def test_expiry_migration_is_guarded_and_backfills_pending_orders():
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "alter table orders" in sql
    assert "expires_at" in sql
    assert "information_schema.columns" in sql or "if not exists" in sql
    assert "date_add(created_at, interval 15 minute)" in sql
    assert "status = 'cancelled'" in sql


def test_expired_pending_order_is_closed_but_retained():
    order = SimpleNamespace(
        status="PENDING",
        expires_at=datetime.now() - timedelta(seconds=1),
        created_at=datetime.now() - timedelta(minutes=15),
        cancelled_at=None,
        mock_qrcode_token="token",
    )

    assert order_service._close_expired_order(order) is True
    assert order.status == "CANCELLED"
    assert order.cancelled_at is not None
    assert order.mock_qrcode_token is None


def test_unexpired_pending_order_is_not_closed():
    order = SimpleNamespace(
        status="PENDING",
        expires_at=datetime.now() + timedelta(minutes=1),
        created_at=datetime.now(),
        cancelled_at=None,
        mock_qrcode_token="token",
    )

    assert order_service._close_expired_order(order) is False
    assert order.status == "PENDING"


class _OrderResult:
    def __init__(self, order=None, scalar=None):
        self.order = order
        self.scalar = scalar

    def scalar_one_or_none(self):
        return self.scalar if self.order is None else self.order

    def scalars(self):
        return self

    def all(self):
        return [] if self.order is None else [self.order]


class _OrderDb:
    def __init__(self, order):
        self.order = order
        self.flushed = False

    def execute(self, _statement):
        return _OrderResult(order=self.order)

    def flush(self):
        self.flushed = True


def test_expired_gateway_notification_cannot_settle_order():
    order = SimpleNamespace(
        order_no="BN20260820EXPIRED",
        status="PENDING",
        expires_at=datetime.now() - timedelta(seconds=1),
        created_at=datetime.now() - timedelta(minutes=15),
        cancelled_at=None,
        mock_qrcode_token="token",
    )
    db = _OrderDb(order)

    result = order_service.settle_order_by_gateway(
        db, order_no=order.order_no, trade_no="TRADE-1"
    )

    assert result is None
    assert order.status == "CANCELLED"
    assert db.flushed is False


def test_manual_cancel_is_idempotent_for_closed_order():
    order = SimpleNamespace(
        order_no="BN20260820CANCELLED",
        user_id=7,
        status="CANCELLED",
        expires_at=datetime.now() + timedelta(minutes=1),
        created_at=datetime.now(),
        cancelled_at=datetime.now(),
        mock_qrcode_token=None,
    )

    result = order_service.close_pending_order(_OrderDb(order), order.order_no, 7)

    assert result is order
    assert order.status == "CANCELLED"


def test_manual_cancel_rejects_another_users_order():
    order = SimpleNamespace(
        order_no="BN20260820OTHERUSER",
        user_id=7,
        status="PENDING",
        expires_at=datetime.now() + timedelta(minutes=1),
        created_at=datetime.now(),
        cancelled_at=None,
        mock_qrcode_token="token",
    )

    with pytest.raises(OrderStateError, match="订单不存在"):
        order_service.close_pending_order(_OrderDb(order), order.order_no, 8)
