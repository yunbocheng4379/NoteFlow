from types import SimpleNamespace

from app.routers import billing_notify
from app.services.billing import order_service
from app.services.billing.exceptions import OrderStateError
from app.services.billing.pay_channels import alipay_channel


def test_create_page_payment_url_uses_server_order_amount(monkeypatch):
    order = SimpleNamespace(order_no="BN20260819TEST", amount_cents=1999)
    calls = {}

    class FakeClient:
        def api_alipay_trade_page_pay(self, **kwargs):
            calls.update(kwargs)
            return "app_id=demo&out_trade_no=BN20260819TEST"

    monkeypatch.setattr(alipay_channel, "_get_client", lambda: FakeClient())
    monkeypatch.setenv("ALIPAY_RETURN_URL", "https://www.noteflow.vip/payment/alipay/return")
    monkeypatch.setenv("ALIPAY_NOTIFY_URL", "https://www.noteflow.vip/api/billing/notify/alipay")

    result = alipay_channel.create_page_payment_url(order, subject="NoteFlow 充值")

    assert result == "https://openapi.alipay.com/gateway.do?app_id=demo&out_trade_no=BN20260819TEST"
    assert calls["total_amount"] == "19.99"
    assert calls["return_url"] == "https://www.noteflow.vip/payment/alipay/return"
    assert calls["notify_url"] == "https://www.noteflow.vip/api/billing/notify/alipay"


def test_alipay_notify_amount_mismatch_is_rejected():
    order = SimpleNamespace(amount_cents=1999)

    assert billing_notify._notify_amount_matches_order({"total_amount": "20.00"}, order) is False


def test_issue_payment_uses_alipay_page_payment_and_stored_order_amount(monkeypatch):
    order = SimpleNamespace(pay_method="ALIPAY", order_no="BN20260819TEST", amount_cents=1999)
    calls = {}

    def fake_page_payment(order, *, subject):
        calls.update(order_no=order.order_no, amount_cents=order.amount_cents, subject=subject)
        return "https://openapi.alipay.com/gateway.do?demo"

    monkeypatch.setattr(alipay_channel, "create_page_payment_url", fake_page_payment)

    result = order_service._issue_payment(order, subject="NoteFlow 充值")

    assert result is None
    assert order.qrcode_url is None
    assert order_service.payment_url_for_order(order) == "https://openapi.alipay.com/gateway.do?demo"
    assert calls == {
        "order_no": "BN20260819TEST",
        "amount_cents": 1999,
        "subject": "NoteFlow 充值",
    }


def test_issue_payment_ignores_legacy_qr_mode(monkeypatch):
    order = SimpleNamespace(pay_method="ALIPAY", order_no="BN20260819PAGE", amount_cents=1999)

    monkeypatch.setenv("ALIPAY_PAYMENT_MODE", "QR")
    monkeypatch.setattr(
        alipay_channel,
        "create_page_payment_url",
        lambda order, *, subject: "https://openapi.alipay.com/gateway.do?page",
    )

    result = order_service._issue_payment(order, subject="NoteFlow 充值")

    assert result is None
    assert order.qrcode_url is None
    assert order_service.payment_url_for_order(order) == "https://openapi.alipay.com/gateway.do?page"


def test_create_alipay_payment_regenerates_pending_page_payment(monkeypatch):
    order = SimpleNamespace(
        order_no="BN20260819PENDING",
        user_id=7,
        status="PENDING",
        pay_method="ALIPAY",
        amount_cents=1999,
        expires_at=order_service.utcnow_naive() + order_service.timedelta(minutes=5),
        qrcode_url="old-qr",
    )
    calls = {}

    def fake_page_payment(order, *, subject):
        calls.update(order_no=order.order_no, subject=subject)
        return "new-page"

    monkeypatch.setattr(alipay_channel, "create_page_payment_url", fake_page_payment)
    monkeypatch.setattr(order_service, "_subject_for_order", lambda db, order: "NoteFlow 充值")

    result = order_service.create_alipay_payment(_FakeDb(order), order.order_no, order.user_id)

    assert result is order
    assert order.qrcode_url is None
    assert order_service.payment_url_for_order(order) == "new-page"
    assert calls == {"order_no": order.order_no, "subject": "NoteFlow 充值"}


def test_create_alipay_payment_replaces_expired_order(monkeypatch):
    order = SimpleNamespace(
        order_no="BN20260819EXPIRED",
        user_id=7,
        status="CANCELLED",
        pay_method="ALIPAY",
        kind="RECHARGE",
        package_id=3,
        plan_id=None,
        is_first_subscription=0,
        amount_cents=1999,
        credits_amount=1000,
        expires_at=order_service.utcnow_naive() - order_service.timedelta(minutes=1),
        qrcode_url=None,
    )
    db = _FakeDb(order)

    monkeypatch.setattr(order_service, "_gen_order_no", lambda: "BN20260819REPLACED")
    monkeypatch.setattr(order_service, "_subject_for_order", lambda db, order: "NoteFlow 充值")
    monkeypatch.setattr(
        alipay_channel,
        "create_page_payment_url",
        lambda order, *, subject: f"page-{order.order_no}",
    )

    result = order_service.create_alipay_payment(db, order.order_no, order.user_id)

    assert result is db.added
    assert result.order_no == "BN20260819REPLACED"
    assert result.status == "PENDING"
    assert result.pay_method == "ALIPAY"
    assert result.amount_cents == order.amount_cents
    assert result.credits_amount == order.credits_amount
    assert result.qrcode_url is None
    assert order_service.payment_url_for_order(result) == "page-BN20260819REPLACED"


class _FakeResult:
    def __init__(self, order):
        self.order = order

    def scalar_one_or_none(self):
        return self.order


class _FakeDb:
    def __init__(self, order):
        self.order = order
        self.added = None

    def execute(self, _statement):
        return _FakeResult(self.order)

    def flush(self):
        return None

    def add(self, order):
        self.added = order


def test_create_alipay_payment_rejects_non_pending_order():
    order = SimpleNamespace(
        order_no="BN20260819PAID",
        user_id=7,
        status="PAID",
        pay_method="ALIPAY",
    )

    try:
        order_service.create_alipay_payment(_FakeDb(order), order.order_no, order.user_id)
    except OrderStateError as exc:
        assert "PENDING" in str(exc)
    else:
        raise AssertionError("expected OrderStateError")


def test_create_alipay_payment_rejects_other_user():
    order = SimpleNamespace(
        order_no="BN20260819PENDING",
        user_id=7,
        status="PENDING",
        pay_method="ALIPAY",
    )

    try:
        order_service.create_alipay_payment(_FakeDb(order), order.order_no, 8)
    except OrderStateError as exc:
        assert "订单不存在" in str(exc)
    else:
        raise AssertionError("expected OrderStateError")
