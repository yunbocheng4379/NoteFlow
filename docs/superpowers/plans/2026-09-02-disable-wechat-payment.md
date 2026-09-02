# Disable WeChat Payment Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep WeChat Pay visible in the payment dialog as an unavailable option while preventing selection and order creation until the feature is launched.

**Architecture:** Add a small pure payment-availability module used by the payment dialog. The dialog will render WeChat as a disabled-but-clickable option that shows a toast without changing the selected method, and the order creation handler will reject WeChat defensively.

**Tech Stack:** React 19, TypeScript, Vite, react-hot-toast, TypeScript compiler.

## Global Constraints

- Keep the WeChat Pay option visible so users see that it is planned.
- Clicking WeChat Pay must show “微信支付暂不支持，功能即将上线，请先使用支付宝支付”.
- Clicking WeChat Pay must not change the selected payment method.
- WeChat Pay must not trigger an order creation request.
- Existing Alipay and historical order display flows must remain unchanged.
- Preserve the committed design document; remove only temporary test files after verification.

---

### Task 1: Define and test payment availability behavior

**Files:**
- Create: `NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.ts`
- Create: `NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.test.ts` (temporary, delete after verification)

**Interfaces:**
- Produces `isPaymentMethodEnabled(method: PaymentMethod): boolean`.
- Produces `selectPaymentMethod(current: PaymentMethod, requested: PaymentMethod): PaymentMethod`.
- Produces `canCreatePaymentOrder(method: PaymentMethod): boolean`.
- Produces `WECHAT_UNAVAILABLE_MESSAGE: string`.

- [ ] **Step 1: Write the failing test**

Create the temporary test with these assertions:

```ts
import assert from 'node:assert/strict'
import {
  canCreatePaymentOrder,
  isPaymentMethodEnabled,
  selectPaymentMethod,
  WECHAT_UNAVAILABLE_MESSAGE,
} from './paymentAvailability'

assert.equal(isPaymentMethodEnabled('ALIPAY'), true)
assert.equal(isPaymentMethodEnabled('WECHAT'), false)
assert.equal(selectPaymentMethod('ALIPAY', 'WECHAT'), 'ALIPAY')
assert.equal(selectPaymentMethod('ALIPAY', 'ALIPAY'), 'ALIPAY')
assert.equal(canCreatePaymentOrder('WECHAT'), false)
assert.equal(canCreatePaymentOrder('ALIPAY'), true)
assert.equal(WECHAT_UNAVAILABLE_MESSAGE, '微信支付暂不支持，功能即将上线，请先使用支付宝支付')
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd NoteFlow_frontend
pnpm exec tsc --noEmit --strict --module ESNext --moduleResolution Bundler --target ES2020 src/pages/UpgradePage/paymentAvailability.test.ts
```

Expected: FAIL because `paymentAvailability.ts` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create the module:

```ts
export type PaymentMethod = 'ALIPAY' | 'WECHAT'

export const WECHAT_UNAVAILABLE_MESSAGE = '微信支付暂不支持，功能即将上线，请先使用支付宝支付'

export function isPaymentMethodEnabled(method: PaymentMethod): boolean {
  return method === 'ALIPAY'
}

export function selectPaymentMethod(current: PaymentMethod, requested: PaymentMethod): PaymentMethod {
  return isPaymentMethodEnabled(requested) ? requested : current
}

export function canCreatePaymentOrder(method: PaymentMethod): boolean {
  return isPaymentMethodEnabled(method)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same TypeScript command and expect it to pass.

- [ ] **Step 5: Commit**

Do not commit the temporary test; retain the production helper for the dialog.

```bash
git add NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.ts
git commit -m "feat: define unavailable WeChat payment state"
```

### Task 2: Block WeChat selection and order creation

**Files:**
- Modify: `NoteFlow_frontend/src/pages/UpgradePage/PayDialog.tsx:31-39,216-230`

**Interfaces:**
- Consumes `isPaymentMethodEnabled` and `WECHAT_UNAVAILABLE_MESSAGE` from `paymentAvailability.ts`.
- Keeps `onCreateOrder(method)` unchanged for enabled Alipay behavior.

- [ ] **Step 1: Use the tested guards in the UI**

Update `REAL_METHODS` and `MOCK_METHODS` entries to include availability, import the helper, and use `selectPaymentMethod` for enabled selection. Use this click behavior:

```tsx
onClick={() => {
  if (m.code === 'WECHAT') {
    toast.error(WECHAT_UNAVAILABLE_MESSAGE)
    return
  }
  if (isDraft && !creatingOrderRef.current) {
    setSelectedMethod(selectPaymentMethod(selectedMethod, m.code as 'ALIPAY' | 'WECHAT'))
  }
}}
```

Render the WeChat option with disabled styling and `aria-disabled="true"`, but keep it clickable so the user receives the message. In `handleCreateOrder`, return with the same toast when `!canCreatePaymentOrder(selectedMethod)` before invoking `onCreateOrder`.

- [ ] **Step 2: Run verification**

Run:

```bash
cd NoteFlow_frontend
pnpm lint
pnpm build
```

Expected: both commands pass. Confirm manually that selecting WeChat shows the unavailable message, leaves Alipay selected, and does not send a billing order request. The repository has no React test runner configured, so the pure guard contract is covered by the temporary TypeScript test and the component wiring is verified by lint/build plus manual interaction.

- [ ] **Step 3: Commit**

```bash
git add NoteFlow_frontend/src/pages/UpgradePage/PayDialog.tsx
git commit -m "feat: disable unavailable WeChat payment option"
```

### Task 3: Remove temporary test artifact and inspect the final diff

**Files:**
- Delete: `NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.test.ts`

- [ ] **Step 1: Delete only the temporary test file**

Remove the test file created for the TDD red-green cycle. Keep `paymentAvailability.ts` and the committed design/plan documents.

- [ ] **Step 2: Run final verification**

Run:

```bash
cd NoteFlow_frontend
pnpm lint
pnpm build
cd ..
git status --short
git diff -- NoteFlow_frontend/src/pages/UpgradePage/PayDialog.tsx NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.ts
```

Expected: lint and build pass; the final diff contains only the intended frontend behavior plus the production helper, while unrelated user changes remain untouched.

- [ ] **Step 3: Commit**

```bash
git add -u NoteFlow_frontend/src/pages/UpgradePage/paymentAvailability.test.ts
git commit -m "test: remove temporary payment availability test"
```
