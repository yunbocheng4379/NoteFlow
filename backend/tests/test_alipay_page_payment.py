from types import SimpleNamespace

from app.routers import billing_notify
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
