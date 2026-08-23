import os
from datetime import datetime, timedelta
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.routers.billing import _serialize_order
from app.services.billing import order_service


def test_expired_pending_order_is_closed_before_serialization():
    order = SimpleNamespace(
        id=1,
        order_no="BN20260823EXPIRED",
        kind="RECHARGE",
        package_id=1,
        plan_id=None,
        amount_cents=1,
        credits_amount=100,
        status="PENDING",
        pay_method="ALIPAY",
        mock_qrcode_token="token",
        qrcode_url=None,
        is_first_subscription=0,
        paid_at=None,
        cancelled_at=None,
        expires_at=datetime.now() - timedelta(seconds=1),
        created_at=datetime.now() - timedelta(minutes=15),
    )

    payload = _serialize_order(order)

    assert order.status == "CANCELLED"
    assert payload["status"] == "CANCELLED"
    assert payload["remaining_seconds"] is None


def test_pending_order_serialization_never_returns_zero_second_countdown():
    order = SimpleNamespace(
        id=2,
        order_no="BN20260823ATLIMIT",
        kind="RECHARGE",
        package_id=1,
        plan_id=None,
        amount_cents=1,
        credits_amount=100,
        status="PENDING",
        pay_method="ALIPAY",
        mock_qrcode_token="token",
        qrcode_url=None,
        is_first_subscription=0,
        paid_at=None,
        cancelled_at=None,
        expires_at=datetime.now() - timedelta(seconds=1),
        created_at=datetime.now() - timedelta(minutes=15),
    )

    payload = _serialize_order(order)

    assert payload["status"] == "CANCELLED"
    assert payload["remaining_seconds"] is None
