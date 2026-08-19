# Alipay Computer Website Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 NoteFlow 的支付宝固定金额充值和 Pro 会员订单改为电脑网站支付跳转，并保持微信/MOCK 支付兼容。

**Architecture:** 后端继续以 `Order` 为唯一金额和权益事实来源；支付宝通道使用 `api_alipay_trade_page_pay` 返回临时 `payment_url`，不持久化签名 URL。前端按通道区分支付宝跳转、微信二维码和 MOCK 模拟支付，支付结果只由后端异步通知结算。

**Tech Stack:** FastAPI、SQLAlchemy、python-alipay-sdk 3.4.0、React 19、TypeScript、React Router、Vite、pytest。

## Global Constraints

- 两类订单金额必须由后端套餐/方案计算，前端不能传入或覆盖金额。
- 生产域名统一为 `https://www.noteflow.vip`，不使用 `https://api.noteflow.vip`。
- 支付宝使用电脑网站支付，不再为支付宝调用 `alipay.trade.precreate`。
- 微信支付和 MOCK 支付行为保持兼容。
- 异步通知验签、订单金额校验和幂等结算是最终支付依据。
- 私钥、公钥文件和实际 `.env` 不得写入 Git 或返回给前端。

---

### Task 1: Add failing backend tests for Alipay page payment

**Files:**
- Create: `backend/tests/test_alipay_page_payment.py`
- Read: `backend/app/services/billing/pay_channels/alipay_channel.py`
- Read: `backend/app/services/billing/order_service.py`

**Interfaces:**
- Consumes: existing `Order`, `alipay_channel._get_client`, and order service.
- Produces: executable regression tests defining `create_page_payment_url`, fixed amount usage, and notification amount validation.

- [ ] **Step 1: Write the failing unit tests**

Add tests that fake the SDK client and assert the new page-pay method receives the database order number and yuan amount:

```python
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


def test_alipay_notify_amount_mismatch_is_rejected(monkeypatch):
    order = SimpleNamespace(amount_cents=1999)
    assert billing_notify._notify_amount_matches_order({"total_amount": "20.00"}, order) is False
```

Use a small fake `Order` namespace so the channel test does not require a live payment gateway or database.

- [ ] **Step 2: Run the focused tests and verify the expected RED failure**

Run:

```bash
cd backend && pytest tests/test_alipay_page_payment.py -q
```

Expected: collection succeeds and fails because `create_page_payment_url` and `_notify_amount_matches_order` do not exist yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add backend/tests/test_alipay_page_payment.py
git commit -m "test: define Alipay page payment behavior"
```

### Task 2: Implement the Alipay page-payment channel and secure notify validation

**Files:**
- Modify: `backend/app/services/billing/pay_channels/alipay_channel.py`
- Modify: `backend/app/routers/billing_notify.py`
- Test: `backend/tests/test_alipay_page_payment.py`

**Interfaces:**
- Consumes: `Order.amount_cents`, `ALIPAY_RETURN_URL`, `ALIPAY_NOTIFY_URL`, and existing SDK client.
- Produces: `create_page_payment_url(order, *, subject) -> str` and `_notify_amount_matches_order(data, order) -> bool`.

- [ ] **Step 1: Implement the minimal page URL builder**

Add the sandbox helper and page-pay URL builder:

```python
def _is_sandbox() -> bool:
    return os.getenv("ALIPAY_SANDBOX", "false").strip().lower() in ("1", "true", "yes")

def create_page_payment_url(order: Order, *, subject: str) -> str:
    client = _get_client()
    signed_query = client.api_alipay_trade_page_pay(
        subject=subject,
        out_trade_no=order.order_no,
        total_amount=f"{order.amount_cents / 100:.2f}",
        return_url=os.getenv("ALIPAY_RETURN_URL") or None,
        notify_url=os.getenv("ALIPAY_NOTIFY_URL") or None,
    )
    gateway = "https://openapi-sandbox.dl.alipaydev.com/gateway.do" if _is_sandbox() else "https://openapi.alipay.com/gateway.do"
    return f"{gateway}?{signed_query}"
```

Factor the existing sandbox expression into `_is_sandbox()` so the gateway and `AliPay(debug=...)` use the same value. Raise `BillingError` if the SDK returns an empty signed query.

- [ ] **Step 2: Add notification amount validation before settlement**

Add:

```python
from decimal import Decimal, InvalidOperation

def _notify_amount_matches_order(data: dict, order: Order) -> bool:
    try:
        notified = Decimal(str(data.get("total_amount")))
    except (InvalidOperation, TypeError):
        return False
    return notified == (Decimal(order.amount_cents) / Decimal(100))
```

In `alipay_notify`, after signature verification and successful trade-status filtering, load the order directly by `Order.order_no` in a short-lived `SessionLocal` transaction. Reject a missing order, a non-matching configured `ALIPAY_APP_ID`, or a mismatched amount with `fail` before calling `settle_order_by_gateway`. Keep non-success trade statuses acknowledged without settlement. The callback lookup must not use `get_order_by_no`, because that helper intentionally requires a user ID and callbacks do not carry user authentication.

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && pytest tests/test_alipay_page_payment.py -q
```

Expected: all focused tests pass.

- [ ] **Step 4: Commit the channel and callback implementation**

```bash
git add backend/app/services/billing/pay_channels/alipay_channel.py backend/app/routers/billing_notify.py backend/tests/test_alipay_page_payment.py
git commit -m "feat: add Alipay computer website payment"
```

### Task 3: Route fixed-amount orders through page payment and add safe re-pay API

**Files:**
- Modify: `backend/app/services/billing/order_service.py`
- Modify: `backend/app/routers/billing.py`
- Test: `backend/tests/test_alipay_page_payment.py`

**Interfaces:**
- Consumes: existing `create_recharge_order`, `create_subscription_order`, authenticated user ID, and stored order amount.
- Produces: `order_service.create_alipay_payment(db, order_no, current_user_id) -> str`, plus `POST /api/billing/order/{order_no}/pay/alipay`.

- [ ] **Step 1: Extend failing tests for fixed amounts and order ownership**

Add service tests with fake order/package/plan lookups or the project’s existing database fixture to assert:

```python
def test_create_alipay_payment_rejects_non_pending_order(db, paid_order):
    with pytest.raises(OrderStateError, match="PENDING"):
        order_service.create_alipay_payment(db, paid_order.order_no, paid_order.user_id)


def test_create_alipay_payment_rejects_other_user(db, pending_order):
    with pytest.raises(OrderStateError, match="订单不存在"):
        order_service.create_alipay_payment(db, pending_order.order_no, pending_order.user_id + 1)
```

Also assert the existing recharge/subscription creation paths pass their stored `amount_cents` into the Alipay builder, not a request amount.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
cd backend && pytest tests/test_alipay_page_payment.py -q
```

Expected: failures because the re-pay service does not exist and current ALIPAY creation still calls QR precreate.

- [ ] **Step 3: Implement a shared payment issuance helper**

Replace the ALIPAY branch of `_issue_qrcode` with a shared helper:

```python
def _issue_payment(order: Order, *, subject: str) -> Optional[str]:
    if order.pay_method == "ALIPAY":
        from app.services.billing.pay_channels import alipay_channel
        return alipay_channel.create_page_payment_url(order, subject=subject)
    if order.pay_method == "WECHAT":
        from app.services.billing.pay_channels import wechat_channel
        order.qrcode_url = wechat_channel.create_qrcode(order, description=subject)
    return None
```

Have recharge and subscription creation attach the returned URL only as a transient attribute, `order._payment_url`, and continue storing only WeChat `qrcode_url`. Add `payment_url_for_order(order) -> Optional[str]` to read that transient value.

Implement:

```python
def create_alipay_payment(db: Session, order_no: str, current_user_id: int) -> str:
    order = db.execute(
        select(Order).where(Order.order_no == order_no).with_for_update()
    ).scalar_one_or_none()
    if not order or order.user_id != current_user_id:
        raise OrderStateError(f"订单不存在: {order_no}")
    if order.status != "PENDING":
        raise OrderStateError(f"订单状态非 PENDING (当前: {order.status})")
    if order.pay_method != "ALIPAY":
        raise InvalidTransactionError("该订单不是支付宝订单")
    subject = _subject_for_order(db, order)
    return alipay_channel.create_page_payment_url(order, subject=subject)
```

`_subject_for_order` must load the active package or plan by the stored foreign key and must never read a new package ID, plan ID, or amount from the request.

- [ ] **Step 4: Add API serialization and re-pay route**

Change `_serialize_order(o, *, payment_url=None)` to include `payment_url`, and pass `order_service.payment_url_for_order(order)` from the two create endpoints. Add:

```python
@router.post("/order/{order_no}/pay/alipay")
def create_alipay_payment(...):
    try:
        payment_url = order_service.create_alipay_payment(db, order_no, current_user.id)
        db.commit()
        return R.success({"order_no": order_no, "payment_url": payment_url})
    except BillingError as e:
        db.rollback()
        return R.error(msg=e.message, code=e.code, data=e.data)
```

The route must return no amount supplied by the client and must not expose private key material.

- [ ] **Step 5: Run backend focused tests and commit**

Run:

```bash
cd backend && pytest tests/test_alipay_page_payment.py -q
```

Expected: all page-payment, fixed-amount, ownership, and status tests pass.

```bash
git add backend/app/services/billing/order_service.py backend/app/routers/billing.py backend/tests/test_alipay_page_payment.py
git commit -m "feat: route fixed orders through Alipay page pay"
```

### Task 4: Update frontend API, payment dialog, billing re-pay, and return page

**Files:**
- Modify: `NoteFlow_frontend/src/services/billing.ts`
- Modify: `NoteFlow_frontend/src/pages/UpgradePage/PayDialog.tsx`
- Modify: `NoteFlow_frontend/src/pages/BillingPage/index.tsx`
- Modify: `NoteFlow_frontend/src/App.tsx`
- Create: `NoteFlow_frontend/src/pages/AlipayReturnPage/index.tsx`

**Interfaces:**
- Consumes: `Order.payment_url`, `POST /billing/order/{order_no}/pay/alipay`, and existing `getOrder` polling.
- Produces: browser navigation to the signed Alipay URL and a return page that trusts only backend order status.

- [ ] **Step 1: Add frontend type/API declarations before UI changes**

Extend `Order` with:

```ts
payment_url: string | null
```

Add:

```ts
createAlipayPayment: (order_no: string) =>
  request.post<any, { order_no: string; payment_url: string }>(`/billing/order/${order_no}/pay/alipay`),
```

- [ ] **Step 2: Change the dialog to show a payment button for real Alipay**

Keep `QRCodeCanvas` only for MOCK and real WeChat. For real `ALIPAY`, render no QR canvas and add:

```tsx
const handleAlipayPay = () => {
  if (!order.payment_url) {
    toast.error('支付宝支付地址缺失，请重新获取')
    return
  }
  window.location.assign(order.payment_url)
}
```

Display “前往支付宝支付” and keep the existing order amount. Keep status polling for real orders and the existing mock confirmation button.

- [ ] **Step 3: Update billing page re-pay**

For `ALIPAY` pending orders, call `billingApi.createAlipayPayment(order.order_no)`, merge the response into the stored order, and open `PayDialog`. For WeChat/MOCK keep the existing token/QR behavior. Do not treat a missing Alipay `qrcode_url` as an error.

- [ ] **Step 4: Add the return page and route**

Create a page that reads `out_trade_no` from `useSearchParams`, calls `billingApi.getOrder(orderNo)` immediately and every 2 seconds for at most 60 seconds, and renders success only when the response status is `PAID`. On success call `refreshBalance`; on pending show “支付结果确认中”; on missing order or terminal failure show an error. Never use `trade_status` from the URL to grant access.

Register `/payment/alipay/return` outside the authenticated application layout so Alipay can load it directly; the page’s API call remains protected by the existing JWT behavior.

- [ ] **Step 5: Run frontend lint/build and commit**

Run:

```bash
cd NoteFlow_frontend && pnpm lint && pnpm build
```

Expected: ESLint exits 0 and Vite emits a production build.

```bash
git add NoteFlow_frontend/src/services/billing.ts NoteFlow_frontend/src/pages/UpgradePage/PayDialog.tsx NoteFlow_frontend/src/pages/BillingPage/index.tsx NoteFlow_frontend/src/App.tsx NoteFlow_frontend/src/pages/AlipayReturnPage/index.tsx
git commit -m "feat: add Alipay checkout redirect UI"
```

### Task 5: Update production configuration and verify the full change

**Files:**
- Modify: `backend/.env.example`
- Modify: `NoteFlow_frontend/.env.example` if present; otherwise document the value in the deployment README found by `rg --files | rg 'README|deploy|docker|nginx'`.
- Read: `docker-compose.yml`, `nginx.conf` or equivalent reverse-proxy configuration.

**Interfaces:**
- Consumes: deployment domain and existing backend/frontend proxy layout.
- Produces: safe configuration template for `www.noteflow.vip` with no real credentials.

- [ ] **Step 1: Write a configuration assertion test/check**

Add a lightweight test or shell assertion that the example configuration contains exactly these production callback URLs:

```text
ALIPAY_NOTIFY_URL=https://www.noteflow.vip/api/billing/notify/alipay
ALIPAY_RETURN_URL=https://www.noteflow.vip/payment/alipay/return
```

Do not add secrets or a real AppID.

- [ ] **Step 2: Update configuration templates**

Set the backend example paths to explicit deployment-friendly paths, set `ALIPAY_SANDBOX=false` as the production example, add `ALIPAY_RETURN_URL`, and set the frontend API base to `/api` wherever the production frontend environment is documented. Confirm reverse proxy routing for `/api` to FastAPI port 8483 and do not add `api.noteflow.vip`.

- [ ] **Step 3: Run focused and project verification**

Run:

```bash
cd backend && pytest tests/test_alipay_page_payment.py -q
cd ../NoteFlow_frontend && pnpm lint && pnpm build
```

Then inspect the final diff and status:

```bash
git diff --check
git status --short
```

Expected: focused tests, lint, and build pass; no private key or `.env` is staged; user-owned `doc/icon.png` and `doc/icon_副本.svg` remain untouched.

- [ ] **Step 4: Commit configuration changes**

```bash
git add backend/.env.example NoteFlow_frontend/.env.example README.md docs
git commit -m "docs: configure production Alipay callbacks"
```

Only stage files that actually changed; never stage real `.env`, key files, or the user’s icon files.
