import json
from types import SimpleNamespace

import pytest

from app.routers import admin_credits
from app.services.user_notification_service import UserNotificationService
from app.services.billing.exceptions import InvalidTransactionError


class FakeSession:
    def __init__(self, users):
        self.users = users
        self.committed = False
        self.rolled_back = False

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def get(self, _model, user_id):
        return self.users.get(user_id)


def response_payload(response):
    return json.loads(response.body)


def test_single_positive_adjustment_publishes_credit_notification(monkeypatch):
    user = SimpleNamespace(id=7, username="alice", credits=620)
    tx = SimpleNamespace(id=101, amount=520, balance_after=620, note="活动赠送")
    published = []
    db = FakeSession({7: user})

    monkeypatch.setattr(
        admin_credits.credit_ledger,
        "admin_adjust",
        lambda _db, *, user_id, delta, note: tx,
    )
    monkeypatch.setattr(
        UserNotificationService,
        "publish",
        lambda **kwargs: published.append(kwargs),
    )

    response = admin_credits.adjust_credits(
        admin_credits.CreditAdjustmentRequest(user_id=7, delta=520, note="活动赠送"),
        None,
        db,
    )

    assert response_payload(response)["code"] == 0
    assert db.committed is True
    assert published == [{
        "user_id": 7,
        "category": "credit_adjustment",
        "title": "电力余额已调整",
        "content": "管理员已为你的账户增加 520 电力。\n调整后余额：620 电力\n备注：活动赠送",
        "source_type": "credit_transaction",
        "source_id": "101",
        "link": "/billing?tab=transactions",
        "severity": "info",
    }]


def test_batch_adjustment_publishes_one_notification_per_user(monkeypatch):
    users = {
        7: SimpleNamespace(id=7, username="alice", credits=620),
        8: SimpleNamespace(id=8, username="bob", credits=220),
    }
    transactions = {
        7: SimpleNamespace(id=101, amount=520, balance_after=620, note="活动赠送"),
        8: SimpleNamespace(id=102, amount=520, balance_after=220, note="活动赠送"),
    }
    published = []
    db = FakeSession(users)

    monkeypatch.setattr(
        admin_credits.credit_ledger,
        "admin_adjust",
        lambda _db, *, user_id, delta, note: transactions[user_id],
    )
    monkeypatch.setattr(
        UserNotificationService,
        "publish",
        lambda **kwargs: published.append(kwargs),
    )

    response = admin_credits.batch_adjust_credits(
        admin_credits.BatchCreditAdjustmentRequest(user_ids=[7, 8], delta=520, note="活动赠送"),
        None,
        db,
    )

    assert response_payload(response)["code"] == 0
    assert [item["user_id"] for item in published] == [7, 8]
    assert [item["source_id"] for item in published] == ["101", "102"]


def test_negative_adjustment_uses_warning_and_deduction_wording(monkeypatch):
    user = SimpleNamespace(id=7, username="alice", credits=200)
    tx = SimpleNamespace(id=103, amount=-100, balance_after=200, note="违规扣除")
    published = []
    db = FakeSession({7: user})

    monkeypatch.setattr(
        admin_credits.credit_ledger,
        "admin_adjust",
        lambda _db, *, user_id, delta, note: tx,
    )
    monkeypatch.setattr(
        UserNotificationService,
        "publish",
        lambda **kwargs: published.append(kwargs),
    )

    admin_credits.adjust_credits(
        admin_credits.CreditAdjustmentRequest(user_id=7, delta=-100, note="违规扣除"),
        None,
        db,
    )

    assert published[0]["severity"] == "warning"
    assert published[0]["content"] == "管理员已为你的账户扣除 100 电力。\n调整后余额：200 电力\n备注：违规扣除"


def test_notification_failure_does_not_fail_committed_adjustment(monkeypatch):
    user = SimpleNamespace(id=7, username="alice", credits=620)
    tx = SimpleNamespace(id=101, amount=520, balance_after=620, note="活动赠送")
    db = FakeSession({7: user})
    calls = []

    monkeypatch.setattr(
        admin_credits.credit_ledger,
        "admin_adjust",
        lambda _db, *, user_id, delta, note: tx,
    )

    def fail_publish(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("notification database unavailable")

    monkeypatch.setattr(UserNotificationService, "publish", fail_publish)

    response = admin_credits.adjust_credits(
        admin_credits.CreditAdjustmentRequest(user_id=7, delta=520, note="活动赠送"),
        None,
        db,
    )

    assert response_payload(response)["code"] == 0
    assert db.committed is True
    assert db.rolled_back is False
    assert calls[0]["source_id"] == "101"


def test_failed_adjustment_does_not_publish_notification(monkeypatch):
    db = FakeSession({7: SimpleNamespace(id=7, username="alice", credits=100)})
    published = []

    def fail_adjustment(*_args, **_kwargs):
        raise InvalidTransactionError("余额不足")

    monkeypatch.setattr(admin_credits.credit_ledger, "admin_adjust", fail_adjustment)
    monkeypatch.setattr(UserNotificationService, "publish", lambda **kwargs: published.append(kwargs))

    response = admin_credits.adjust_credits(
        admin_credits.CreditAdjustmentRequest(user_id=7, delta=-200, note="违规扣除"),
        None,
        db,
    )

    assert response_payload(response)["code"] == 400
    assert published == []
    assert db.rolled_back is True
