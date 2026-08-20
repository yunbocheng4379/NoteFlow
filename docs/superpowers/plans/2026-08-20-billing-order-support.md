# Billing Order Expiry and Customer Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Enforce one global pending order per user with 15-minute expiry and cancellation, add deterministic customer-support QR responses, clean the current user's legacy pending orders, and remove the temporary design document after delivery.

**Architecture:** Extend the existing `Order` model with `expires_at`, centralize expiry/uniqueness/cancellation in `order_service`, and reuse the existing APScheduler for periodic closure plus request-time guards. Expose expiry and cancellation through the billing API and render a client-side countdown in `BillingPage`. Add a small client-side keyword router before the existing AI assistant stream, reusing `enterprise-service-qr.png`.

**Tech Stack:** FastAPI, SQLAlchemy, MySQL, APScheduler, React 19, TypeScript, Tailwind, existing billing and assistant services.

## Global Constraints

- The pending-order limit is global across recharge and subscription orders.
- A pending order expires exactly 15 minutes after creation.
- Expired/manual-closed records remain in `orders` with database status `CANCELLED`, displayed as “已关闭”.
- Backend state is authoritative; the frontend countdown never authorizes payment.
- Only the authenticated current user may inspect/cancel their own order.
- The one-time cleanup must target only the current user's `PENDING` rows after a database backup and explicit target verification.
- Do not implement self-service refunds in this change.
- Reuse `NoteFlow_frontend/src/assets/enterprise-service-qr.png`; do not replace the QR image.
- The temporary design document `docs/superpowers/specs/2026-08-20-billing-order-support-design.md` is deleted after implementation and verification.

---

### Task 1: Add order expiry schema and migration

**Files:**
- Modify: `backend/app/db/models/orders.py`
- Create: `backend/sql/migrate_add_order_expiry.sql`
- Create: `backend/tests/test_order_expiry.py`

**Interfaces:**
- Produces `Order.expires_at` as a nullable DateTime column.
- Produces a trusted SQL migration that adds `orders.expires_at` idempotently where supported by the project migration convention.
- Produces test fixtures/helpers for later order-service tests.

- [ ] **Step 1: Write the failing model/migration tests**

Add tests that assert the model exposes `expires_at`, and that the migration text contains an `ALTER TABLE orders` path for `expires_at` plus a guard against duplicate execution.

- [ ] **Step 2: Run the focused tests**

Run:

```bash
cd backend
pytest tests/test_order_expiry.py -q
```

Expected: FAIL because `Order.expires_at` and the migration file do not exist.

- [ ] **Step 3: Implement the model and SQL migration**

Add:

```python
expires_at = Column(DateTime, nullable=True, comment="待支付订单过期时间")
```

The migration must:
- inspect `information_schema.columns`;
- add `expires_at DATETIME NULL` only if absent;
- backfill existing `PENDING` rows with `DATE_ADD(created_at, INTERVAL 15 MINUTE)`;
- close already-expired pending rows by setting `status='CANCELLED'` and `cancelled_at=NOW()`;
- leave paid/cancelled/refunded rows unchanged;
- be safe to execute once in production after backup.

- [ ] **Step 4: Run the focused tests again**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models/orders.py backend/sql/migrate_add_order_expiry.sql backend/tests/test_order_expiry.py
git commit -m "feat: add pending order expiry"
```

---

### Task 2: Implement order lifecycle and single-pending enforcement

**Files:**
- Modify: `backend/app/services/billing/order_service.py`
- Modify: `backend/app/services/billing/scheduler.py`
- Modify: `backend/app/routers/billing.py`
- Modify: `backend/tests/test_order_expiry.py`
- Modify: `backend/tests/test_alipay_page_payment.py`

**Interfaces:**
- Add `PENDING_ORDER_TTL_MINUTES = 15`.
- Add `expire_pending_orders(db, user_id: int | None = None) -> int`.
- Add `close_pending_order(db, order_no: str, current_user_id: int) -> Order`.
- Add `has_active_pending_order(db, user_id: int) -> bool`.
- Add `POST /api/billing/order/{order_no}/cancel`.
- Extend order serialization with `expires_at` and `remaining_seconds`.

- [ ] **Step 1: Add failing service tests**

Cover:
- recharge then subscription creation is rejected;
- subscription then recharge creation is rejected;
- an expired pending order is closed and a new order can be created;
- manual cancellation only changes the authenticated user's pending order;
- cancellation of paid/other-user orders is rejected;
- closed orders cannot create an Alipay payment URL;
- an expired order notification cannot settle benefits;
- expiry preserves the order row and does not create a credit transaction.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
cd backend
pytest tests/test_order_expiry.py tests/test_alipay_page_payment.py -q
```

Expected: FAIL on the new behaviors.

- [ ] **Step 3: Implement shared lifecycle helpers**

Use a 15-minute UTC/application-time comparison consistent with the existing `datetime.now()` usage. Before create/list/detail/pay/cancel:
- close expired pending rows;
- use a `with_for_update()` lock on the current user row during order creation;
- query for any remaining pending order;
- raise `BillingError` with the existing response pattern when one exists.

Manual cancellation must:
- lock the order row;
- validate user ownership;
- be idempotent for already-cancelled orders;
- reject paid/refunded orders;
- set `status='CANCELLED'` and `cancelled_at=datetime.now()`.

- [ ] **Step 4: Update scheduler**

Reuse the existing APScheduler. Replace the daily stale-order job with an every-minute job that calls `expire_pending_orders` in a transaction. Keep gateway reconciliation separate and unchanged.

- [ ] **Step 5: Add API behavior and serialization**

Add the cancel endpoint and return:
- `expires_at` as ISO text;
- `remaining_seconds=max(0, floor(expires_at-now))`.

Ensure all order list/detail paths call expiry before serialization.

- [ ] **Step 6: Run focused tests and confirm GREEN**

```bash
cd backend
pytest tests/test_order_expiry.py tests/test_alipay_page_payment.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/billing/order_service.py backend/app/services/billing/scheduler.py backend/app/routers/billing.py backend/tests/test_order_expiry.py backend/tests/test_alipay_page_payment.py
git commit -m "feat: enforce pending order lifecycle"
```

---

### Task 3: Add billing API types, countdown, and cancel UI

**Files:**
- Modify: `NoteFlow_frontend/src/services/billing.ts`
- Modify: `NoteFlow_frontend/src/pages/BillingPage/index.tsx`
- Create or modify: `NoteFlow_frontend/src/pages/BillingPage/*.test.*` only if the existing test setup supports it

**Interfaces:**
- `Order.expires_at: string | null`
- `Order.remaining_seconds: number | null`
- `billingApi.cancelOrder(order_no: string): Promise<Order>`
- `OrdersList` renders countdown, continue payment, and cancel controls.

- [ ] **Step 1: Add a focused frontend test or executable behavior check**

If no frontend test runner is configured, add a small pure helper for formatting remaining seconds and test it using the repository-supported TypeScript test path; otherwise use the existing runner. The test must fail before the helper/UI behavior exists.

- [ ] **Step 2: Implement API types and countdown**

Use the server `expires_at` as the target timestamp. Update the visible countdown once per second. At zero:
- display `00:00`;
- refresh the order list;
- let the backend status determine the final state.

Render “取消订单” for pending rows and “继续支付” only while the row remains pending.

- [ ] **Step 3: Implement cancel confirmation and refresh**

Add a confirmation dialog or `window.confirm` consistent with the project’s existing UI. Disable the button during the request, show a toast on success/failure, and refresh the current page.

- [ ] **Step 4: Build the frontend**

```bash
VITE_WEB_BUILD=1 pnpm --dir NoteFlow_frontend build
```

Expected: exit 0 and generated `dist/index.html` contains root-relative `/assets/` references.

- [ ] **Step 5: Commit**

```bash
git add NoteFlow_frontend/src/services/billing.ts NoteFlow_frontend/src/pages/BillingPage
git commit -m "feat: add pending order countdown and cancel"
```

---

### Task 4: Add deterministic customer-support QR response

**Files:**
- Modify: `NoteFlow_frontend/src/components/AssistantPanel.tsx`
- Modify: `NoteFlow_frontend/src/pages/SettingPage/about.tsx`
- Create or modify: `NoteFlow_frontend/src/components/AssistantPanel.test.*` only if the existing test setup supports it

**Interfaces:**
- Add a pure keyword classifier such as `getCustomerSupportReply(question: string)` returning `null` for normal questions or a fixed response object containing text and QR asset for support questions.
- The assistant send path uses the classifier before `askAssistantStream`.
- The About page adds a “联系客服” entry using the existing QR preview pattern.

- [ ] **Step 1: Add failing classifier tests**

Cover:
- “客服”“人工客服”“退款”“支付问题” match;
- “人工智能怎么用” does not match;
- ordinary product questions return `null`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run the repository-supported frontend test command for the new classifier. Expected: FAIL because the classifier is absent.

- [ ] **Step 3: Implement the classifier and fixed response**

Normalize whitespace and lower-case English. Match explicit customer-service phrases, but do not match “人工智能” by the bare “人工” token. The response adds a user-facing text message and the QR image; it must not open the AI stream.

- [ ] **Step 4: Add the About-page contact entry**

Reuse `enterprise-service-qr.png`, keep the existing enterprise card, and add a clearly labeled customer-service card/entry with click-to-preview behavior.

- [ ] **Step 5: Build and run focused checks**

```bash
VITE_WEB_BUILD=1 pnpm --dir NoteFlow_frontend build
```

Expected: exit 0. Verify the generated bundle includes the QR asset and support text.

- [ ] **Step 6: Commit**

```bash
git add NoteFlow_frontend/src/components/AssistantPanel.tsx NoteFlow_frontend/src/pages/SettingPage/about.tsx
git commit -m "feat: add customer support QR guidance"
```

---

### Task 5: Production data cleanup and migration

**Files:**
- Modify: `backend/sql/migrate_add_order_expiry.sql` if test results require it
- Delete after completion: `docs/superpowers/specs/2026-08-20-billing-order-support-design.md`

- [ ] **Step 1: Run all backend billing tests**

```bash
cd backend
pytest tests/test_order_expiry.py tests/test_alipay_page_payment.py tests/test_credit_ledger.py -q
```

- [ ] **Step 2: Prepare production backup**

On the server, create and verify a MySQL dump before changing the schema or deleting user data. Record path and size; never print the password.

- [ ] **Step 3: Execute the migration file**

Copy the committed SQL file to the server and execute that exact file. Verify:
- `orders.expires_at` exists;
- expired pending rows are cancelled;
- no paid/refunded rows changed.

- [ ] **Step 4: Identify the current user safely**

Use the authenticated user’s known paid order from the user’s billing screen or a user-provided account identifier. Query the target user ID and list all of that user’s pending order numbers before deletion. Do not use an unrestricted delete.

- [ ] **Step 5: Delete only the confirmed current-user pending rows**

After confirming the target user ID and backup:
- delete only rows with that `user_id` and `status='PENDING'`;
- verify the target count is zero;
- verify other users’ pending orders remain untouched.

- [ ] **Step 6: Commit deletion of the temporary design document**

```bash
git rm docs/superpowers/specs/2026-08-20-billing-order-support-design.md
git commit -m "chore: remove temporary billing design"
git push origin main
```

---

### Task 6: Final verification and deployment

**Files:**
- No new source files; verify all changed files and the production environment.

- [ ] **Step 1: Run repository verification**

```bash
git diff --check
cd backend && pytest tests/test_order_expiry.py tests/test_alipay_page_payment.py tests/test_credit_ledger.py -q
VITE_WEB_BUILD=1 pnpm --dir NoteFlow_frontend build
```

- [ ] **Step 2: Push source commits**

Confirm `HEAD == origin/main` and the temporary design document is absent from the repository.

- [ ] **Step 3: Deploy**

Back up the production database, run the expiry migration, build/restart the backend and frontend as needed, and do not modify payment credentials.

- [ ] **Step 4: Verify production**

Check:
- all NoteFlow containers are running/healthy;
- `/api/sys_health` reports backend, ffmpeg, and database OK;
- billing orders endpoint loads for a logged-in user;
- a pending order returns `expires_at`;
- second recharge/subscription creation is rejected;
- cancel endpoint changes only the target order to `CANCELLED`;
- About page shows the customer-service QR;
- AI assistant shows the QR for “人工客服” and still streams normal questions;
- existing Alipay return and notify endpoints remain reachable.

- [ ] **Step 5: Report**

Include commit, migration result, backup path, cleanup count, container status, verification URLs, and any known limitations. Do not include credentials, private keys, full `.env`, or full payment URLs.

