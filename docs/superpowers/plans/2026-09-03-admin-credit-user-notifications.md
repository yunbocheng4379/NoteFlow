# 管理员电力调整用户通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理员成功调整用户电力后，为每个受影响用户写入一条可在“我的通知”查看的站内通知。

**Architecture:** 保持现有 `credit_ledger.admin_adjust` 账务事务不变，在单个或批量接口提交成功后调用统一的通知辅助函数。辅助函数复用 `UserNotificationService.publish`，以电力流水 ID 作为幂等键，并吞掉通知写入异常以保护已提交账务。前端只增加通知分类映射，复用现有通知页和电力流水页。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy、pytest、React 19、TypeScript、Vite、pnpm。

## Global Constraints

- 电力调整成功提交后，再生成站内通知。
- 单个调整发送 1 条；批量调整按用户分别发送 1 条。
- 使用电力流水 ID 作为通知幂等键。
- 通知正文包含调整方向与数量、调整后余额和管理员备注。
- 增加电力为 `info`，扣除电力为 `warning`。
- 通知写入失败只记录日志，不影响已经成功提交的电力调整。
- 不新增通知表、通知查询 API 或新的异步队列。
- 不改变电力流水、余额校验、事务提交和批量全量回滚规则。

---

### Task 1: 为管理员调整接口增加后端通知行为

**Files:**
- Create: `backend/tests/test_admin_credit_notifications.py`
- Modify: `backend/app/routers/admin_credits.py`

**Interfaces:**
- Consumes: 现有 `CreditTransaction`（`id`、`amount`、`balance_after`、`note`）和 `User`（`id`、`username`、`credits`）。
- Produces: `_publish_credit_adjustment_notification(tx: CreditTransaction, user: User) -> None`，供单个与批量管理员调整接口调用。

- [ ] **Step 1: Write the failing tests for single and batch adjustment notifications**

Add a focused unit test module. The fake session and ledger functions keep the test independent of a live admin HTTP authentication flow while executing the real router functions and notification construction path.

```python
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
```

- [ ] **Step 2: Run the new tests to verify they fail for the missing behavior**

Run:

```bash
cd backend && pytest tests/test_admin_credit_notifications.py -q
```

Expected: FAIL because the current `adjust_credits` and `batch_adjust_credits` endpoints do not call `UserNotificationService.publish`; the assertions for `published` are empty.

- [ ] **Step 3: Implement the shared notification helper and invoke it after commit**

In `backend/app/routers/admin_credits.py`, add the imports and logger near the existing service imports:

```python
from app.services.user_notification_service import UserNotificationService
from app.utils.logger import get_logger

logger = get_logger(__name__)
```

Add this helper before the route declarations:

```python
def _publish_credit_adjustment_notification(tx: CreditTransaction, user: User) -> None:
    delta = int(tx.amount or 0)
    direction = "增加" if delta > 0 else "扣除"
    content = (
        f"管理员已为你的账户{direction} {abs(delta)} 电力。\n"
        f"调整后余额：{int(tx.balance_after or 0)} 电力\n"
        f"备注：{tx.note or '管理员未填写备注'}"
    )
    try:
        UserNotificationService.publish(
            user_id=user.id,
            category="credit_adjustment",
            title="电力余额已调整",
            content=content,
            source_type="credit_transaction",
            source_id=str(tx.id),
            link="/billing?tab=transactions",
            severity="info" if delta > 0 else "warning",
        )
    except Exception:
        logger.exception(
            f"管理员电力调整通知写入失败 (user_id={user.id}, transaction_id={tx.id})"
        )
```

In `adjust_credits`, call `_publish_credit_adjustment_notification(tx, user)` after the existing `db.get`/missing-user check and before returning the success response. In `batch_adjust_credits`, call the same helper for every `(tx, user)` pair after the existing missing-user check and before constructing the success response:

```python
        for tx, user in zip(transactions, users):
            _publish_credit_adjustment_notification(tx, user)
```

Do not move `db.commit()`, change the existing rollback branches, or put notification publishing before the commit.

- [ ] **Step 4: Run the backend tests to verify the implementation passes**

Run:

```bash
cd backend && pytest tests/test_admin_credit_notifications.py -q
```

Expected: PASS for all five tests. Then run the related ledger regression tests:

```bash
cd backend && pytest tests/test_credit_ledger.py -q
```

Expected: all existing credit ledger tests pass.

- [ ] **Step 5: Commit the backend change**

```bash
git add backend/app/routers/admin_credits.py backend/tests/test_admin_credit_notifications.py
git commit -m "feat: notify users after admin credit adjustments"
```

### Task 2: 在“我的通知”页面标记电力调整分类

**Files:**
- Modify: `NoteFlow_frontend/src/pages/NotificationsPage/index.tsx:15-18`

**Interfaces:**
- Consumes: 后端返回的 `UserNotification.category === "credit_adjustment"`。
- Produces: 现有列表与详情组件将该类别显示为“电力调整”，继续复用现有 severity badge、已读和详情行为。

- [ ] **Step 1: Add the category mapping**

Extend the existing `CATEGORY_LABEL` constant without changing the fallback behavior:

```tsx
const CATEGORY_LABEL: Record<string, string> = {
  note_style_review: '笔记风格审核',
  credit_adjustment: '电力调整',
}
```

- [ ] **Step 2: Verify the frontend build and lint**

Run:

```bash
cd NoteFlow_frontend && pnpm build
cd NoteFlow_frontend && pnpm lint
```

Expected: both commands exit with code 0; the existing notification page compiles with the new category mapping.

- [ ] **Step 3: Commit the frontend change**

```bash
git add NoteFlow_frontend/src/pages/NotificationsPage/index.tsx
git commit -m "feat: label credit adjustment notifications"
```

### Task 3: End-to-end verification and final review

**Files:**
- Modify: none.

**Interfaces:**
- Consumes: Task 1 backend behavior and Task 2 frontend category mapping.
- Produces: verified single/batch notification behavior with unchanged ledger and notification-page behavior.

- [ ] **Step 1: Run the focused backend tests together**

```bash
cd backend && pytest tests/test_admin_credit_notifications.py tests/test_credit_ledger.py -q
```

Expected: all focused notification and ledger tests pass.

- [ ] **Step 2: Inspect the final diff for scope and formatting**

```bash
git diff HEAD~2..HEAD --check
git diff HEAD~2..HEAD --stat
git status --short
```

Expected: only the backend router/test, frontend notification category mapping, and the two committed planning documents are present; no generated build artifacts or unrelated changes are included.

- [ ] **Step 3: Confirm acceptance criteria**

Verify that:

1. A positive single adjustment creates one `info` notification with the positive amount, resulting balance, note, and transaction source ID.
2. A negative single adjustment creates one `warning` notification using deduction wording.
3. A successful batch creates one notification per target user, each tied to that user’s transaction.
4. Notification persistence errors do not turn a committed adjustment into an API error.
5. Failed adjustments publish no notification.
6. “我的通知” shows the category as “电力调整” and links to `/billing?tab=transactions`.
