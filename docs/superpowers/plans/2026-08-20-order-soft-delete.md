# Order Record Soft Delete Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Allow users to remove closed order records from their visible order list without deleting the underlying financial record.

**Architecture:** Add a nullable `orders.hidden_at` timestamp and make ordinary user order queries exclude rows where it is set. Add an authenticated endpoint that only hides `CANCELLED` orders belonging to the current user. Keep payment, settlement, audit, and administrative data unchanged. The frontend exposes the action only for closed orders and refreshes the list after a successful hide.

**Tech Stack:** FastAPI, SQLAlchemy, MySQL migration SQL, React 19, TypeScript, Axios, pytest, Vite.

### Task 1: Add failing backend behavior tests

**Files:**
- Create: `backend/tests/test_order_soft_delete.py`

**Steps:**
1. Add tests for the `hidden_at` model field and idempotent hiding of a user-owned `CANCELLED` order.
2. Add tests proving `PENDING`, `PAID`, and `REFUNDED` orders cannot be hidden.
3. Add tests proving another user cannot hide an order.
4. Add a query assertion proving user order listing adds `hidden_at IS NULL` to both count and row queries.
5. Run `DATABASE_URL=sqlite:///:memory: /opt/anaconda3/bin/python3 -m pytest backend/tests/test_order_soft_delete.py -q` and confirm the new tests fail because the production behavior is not implemented.

### Task 2: Implement backend soft delete and migration

**Files:**
- Modify: `backend/app/db/models/orders.py`
- Modify: `backend/app/services/billing/order_service.py`
- Modify: `backend/app/routers/billing.py`
- Create: `backend/sql/migrate_add_order_hidden_at.sql`

**Steps:**
1. Add nullable `hidden_at` to `Order`.
2. Update `get_order_by_no` and `list_user_orders` to exclude hidden records for normal user queries while preserving ownership checks.
3. Implement `hide_order(db, order_no, current_user_id)` with row locking, ownership validation, `CANCELLED`-only validation, idempotent repeated calls, and `hidden_at = datetime.now()`.
4. Add `POST /billing/order/{order_no}/hide`, returning the normal serialized order and using existing billing error handling.
5. Add an idempotent MySQL migration that adds `hidden_at` after `expires_at` when absent.
6. Re-run the focused backend tests and confirm they pass.

### Task 3: Add the frontend action

**Files:**
- Modify: `NoteFlow_frontend/src/services/billing.ts`
- Modify: `NoteFlow_frontend/src/pages/BillingPage/index.tsx`

**Steps:**
1. Add `billingApi.hideOrder(order_no)`.
2. Add a loading state and confirmation flow in `BillingPage`.
3. Pass the hide handler into `OrdersList`.
4. Render “移除记录” only for `CANCELLED` orders; keep pending payment/cancel actions unchanged.
5. Refresh the current order page after a successful hide and show a toast.
6. Run the frontend production build and lint/type checks available in the repository.

### Task 4: Verify, remove the design document, and commit

**Files:**
- Delete: `docs/superpowers/specs/2026-08-20-order-soft-delete-design.md`

**Steps:**
1. Run the focused backend tests, existing billing tests, and frontend production build.
2. Run `git diff --check` and inspect the final diff for unrelated changes.
3. Delete the approved design document after implementation and verification.
4. Commit the implementation, migration, tests, frontend changes, and design-document deletion.
5. Commit the completed changes locally; remote push and production deployment require an explicit follow-up request.

**Not in scope:** Executing the production database migration or deploying containers in this turn; that requires a separate explicit deployment request.
