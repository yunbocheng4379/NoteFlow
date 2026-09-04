# Pro 专属原片截图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“原片截图”设为 Pro 会员专属，在 React Web 端提供锁定和升级引导，并在单个/批量生成 API 增加后端权限兜底。

**Architecture:** 复用现有 `require_pro` 会员判断，在两个生成路由进入计费和建任务前校验 `format`。前端 `FormatMultiSelect` 区分 Pro 锁定和已有的视频理解/视觉模型限制，免费用户点击截图选项时展示可跳转升级页的 toast，Pro 用户保留现有截图选择流程。

**Tech Stack:** FastAPI、SQLAlchemy、pytest、React 19、TypeScript、react-hook-form、react-hot-toast、React Router、Tailwind CSS。

## Global Constraints

- 免费用户仍能看到“原片截图”，但该选项不可选，并显示 Pro 专属标识。
- 免费用户点击锁定选项时得到升级引导，不改变当前已选格式。
- 后端单个和批量生成接口必须在扣费/建任务前拒绝非 Pro 截图请求。
- 不新增数据库字段、套餐或支付流程，不改变其他笔记格式权限。
- 不删除现有项目测试、历史设计文档或用户文件；只删除本次实现明确产生且确认冗余的临时文件。

---

### Task 1: Add backend screenshot permission coverage

**Files:**
- Modify: `backend/tests/test_kb_permissions.py`
- Test: `backend/tests/test_kb_permissions.py`

**Interfaces:**
- Consumes: `app.services.kb_permissions.require_pro`
- Produces: regression coverage proving the shared Pro gate accepts subscribed users and rejects free users with the requested feature name.

- [ ] **Step 1: Write the failing test**

Add a feature-specific test using the existing lightweight stub:

```python
def test_require_pro_rejects_free_user_for_original_screenshot():
    with pytest.raises(BizException) as exc_info:
        require_pro(_StubUser(active_subscription_id=None), "原片截图")

    assert exc_info.value.code == 40601
    assert str(exc_info.value) == "原片截图为会员功能，请升级 Pro"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && pytest tests/test_kb_permissions.py::test_require_pro_rejects_free_user_for_original_screenshot -q
```

Expected: FAIL only if `BizException.__str__` does not currently expose the message; if the existing shared gate already satisfies this exact behavior, record the test as a characterization test and continue without changing `require_pro`.

- [ ] **Step 3: Write minimal implementation**

Do not change the shared permission implementation unless the failing assertion identifies a real mismatch. The current implementation already accepts `feature_name` and returns code `40601` with the feature-specific message.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend && pytest tests/test_kb_permissions.py -q
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_kb_permissions.py
git commit -m "test: cover original screenshot Pro permission"
```

### Task 2: Enforce Pro access in note generation APIs

**Files:**
- Modify: `backend/app/routers/note.py:generate_note`
- Modify: `backend/app/routers/note.py:generate_notes_batch`
- Create: `backend/tests/test_note_screenshot_permissions.py`

**Interfaces:**
- Consumes: `VideoRequest.format`, `GenerateNotesBatchRequest.format`, `current_user`, and `require_pro(user, feature_name)`.
- Produces: both generation entry points reject requests containing `screenshot` before model checks, credit consumption, task creation, or background work.

- [ ] **Step 1: Write the failing test**

Create a focused route-source regression test that checks both public route functions invoke the shared gate before their generation work. Use AST/source inspection only for the ordering contract so the test does not require external downloaders, database credentials, or background execution:

```python
from pathlib import Path


NOTE_ROUTER_SOURCE = Path(__file__).parents[1].joinpath("app/routers/note.py").read_text()


def test_generation_routes_guard_screenshot_before_billing():
    single_start = NOTE_ROUTER_SOURCE.index("def generate_note(")
    batch_start = NOTE_ROUTER_SOURCE.index("def generate_notes_batch(")

    single_source = NOTE_ROUTER_SOURCE[single_start:batch_start]
    batch_source = NOTE_ROUTER_SOURCE[batch_start:]

    for route_source in (single_source, batch_source):
        guard = route_source.index('require_pro(current_user, "原片截图")')
        billing = route_source.index("credit_ledger.consume")
        assert guard < billing
        assert 'if "screenshot" in (data.format or []):' in route_source
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && pytest tests/test_note_screenshot_permissions.py::test_generation_routes_guard_screenshot_before_billing -q
```

Expected: FAIL because neither generation route currently contains the screenshot-specific `require_pro` guard.

- [ ] **Step 3: Write minimal implementation**

At the beginning of each route’s existing `try` block, before transcriber/model checks and before the credit-consumption block, add:

```python
if "screenshot" in (data.format or []):
    require_pro(current_user, "原片截图")
```

Keep the existing `require_pro` import and error handling path. Do not modify pricing or `NoteGenerator`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend && pytest tests/test_note_screenshot_permissions.py tests/test_kb_permissions.py -q
```

Expected: all permission tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/note.py backend/tests/test_note_screenshot_permissions.py backend/tests/test_kb_permissions.py
git commit -m "feat: require Pro for original screenshots"
```

### Task 3: Lock the screenshot format in the Web form

**Files:**
- Modify: `NoteFlow_frontend/src/pages/HomePage/components/NoteForm.tsx:FormatMultiSelect`
- Modify: `NoteFlow_frontend/src/pages/HomePage/components/NoteForm.tsx:note format field wiring`

**Interfaces:**
- Consumes: `isPro`, existing `videoUnderstandingEnabled`, `selectedModelSupportsVision`, `toast.custom`, and `RouterLink`.
- Produces: a visible, keyboard-operable locked option for free users that never mutates `format` and exposes an upgrade link.

- [ ] **Step 1: Write the failing test**

The frontend package has no test runner configured. Capture the UI contract as a type/build-checkable implementation seam by first adding the prop and handler shape to the component without changing runtime behavior:

```tsx
type FormatMultiSelectProps = {
  value: string[]
  onChange: (v: string[]) => void
  screenshotDisabled: boolean
  screenshotProLocked: boolean
  linkDisabled: boolean
  scrollAreaRef: React.RefObject<HTMLElement | null>
}
```

Run the TypeScript build after the prop is added but before all call sites are updated:

```bash
cd NoteFlow_frontend && pnpm build
```

Expected: FAIL with a missing `screenshotProLocked` prop at the existing `FormatMultiSelect` call site. This is the frontend red step for the new contract.

- [ ] **Step 2: Run test to verify it fails**

Confirm the failure is a TypeScript prop mismatch rather than a dependency or environment failure. Do not proceed until the error names the new prop/call-site mismatch.

- [ ] **Step 3: Write minimal implementation**

Implement these focused changes in `NoteForm.tsx`:

1. Import `LockKeyhole` from `lucide-react`.
2. Add `screenshotProLocked: boolean` to `FormatMultiSelect` props.
3. In `toggle`, when `v === 'screenshot' && screenshotProLocked`, keep the current value and show a custom toast containing “原片截图为 Pro 专属功能” and a `RouterLink` to `/upgrade`; return before `onChange`.
4. Replace the native `disabled` attribute on format option buttons with `aria-disabled={disabled}` so locked users can activate the upgrade hint; keep the guard in `toggle` for all disabled reasons.
5. Render a lock icon and “Pro 专属” when `screenshotProLocked`; retain “需开启视频理解” for the existing Pro-but-incompatible state.
6. Pass:

```tsx
screenshotDisabled={!isPro || !videoUnderstandingEnabled || !selectedModelSupportsVision}
screenshotProLocked={!isPro}
```

Use the existing toast visual style and avoid changing selected values when a locked option is clicked.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd NoteFlow_frontend && pnpm build && pnpm lint
```

Expected: both commands exit with code 0 and the generated build includes no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add NoteFlow_frontend/src/pages/HomePage/components/NoteForm.tsx
git commit -m "feat: lock original screenshots for free users"
```

### Task 4: Verify behavior and remove only confirmed redundant artifacts

**Files:**
- Delete: only temporary test/Markdown files created during this implementation if they are not part of the approved design/plan history.
- Verify: `backend/app/routers/note.py`, `backend/tests/test_note_screenshot_permissions.py`, `backend/tests/test_kb_permissions.py`, `NoteFlow_frontend/src/pages/HomePage/components/NoteForm.tsx`

**Interfaces:**
- Consumes: completed backend and frontend changes.
- Produces: verified implementation with no broad or ambiguous deletion.

- [ ] **Step 1: Run targeted backend tests**

```bash
cd backend && pytest tests/test_note_screenshot_permissions.py tests/test_kb_permissions.py -q
```

Expected: all selected tests pass.

- [ ] **Step 2: Run the complete backend test suite**

```bash
cd backend && pytest -q
```

Expected: no new failures attributable to this feature; report any pre-existing failures separately.

- [ ] **Step 3: Run frontend verification**

```bash
cd NoteFlow_frontend && pnpm build && pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Inspect the diff and deletion candidates**

```bash
git diff --check
git status --short
git diff --stat
```

Delete a file only if it was created during this task, is not the approved design or implementation plan, and is not referenced by the codebase. Do not delete `docs/superpowers/specs/2026-09-04-pro-original-screenshot-design.md`, this plan, or existing tests.

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add -u
git commit -m "chore: remove temporary Pro screenshot artifacts"
```

Only create this commit when the inspection found a real temporary artifact to remove; otherwise leave no cleanup commit.
