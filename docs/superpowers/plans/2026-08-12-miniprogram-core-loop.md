# NoteFlow Mini Program Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有微信小程序中交付与桌面端主题统一的核心闭环：会话登录、视频解析与笔记生成、任务列表、笔记阅读、AI 问答和个人中心。

**Architecture:** 保留现有原生微信小程序结构和 FastAPI `/api` 后端，新增小而纯的契约/状态工具供 Node 测试使用，页面通过服务层调用统一请求封装。主包仅保留首页、笔记、我的、详情和登录；非核心分包不纳入本轮 UI 流程。

**Tech Stack:** 微信小程序原生 JavaScript/WXML/WXSS、Node.js `node:test`、现有 FastAPI ResponseWrapper、现有 markdown-parser 和自定义组件。

## Global Constraints

- 视觉使用 `#F7F8F6`、`#FFFFFF`、`#167A6E`、`#0F6B60`、`#E6F7F5`、`#243447`、`#52636D`、`#93A19D`、`#C66B5D`。
- 页面左右边距为 32rpx，卡片圆角为 20rpx，主按钮高度为 96rpx。
- 微信一键登录优先，邮箱/用户名/手机号 + 密码登录兜底；后端登录字段必须是 `{ account, password }`。
- 生成接口必须使用后端真实字段，成功响应必须读取 `task_id`。
- 401 清理会话并停止循环，不调用未确认存在的 refresh 接口。
- 非核心的充值/会员、订单、合集、知识库、闪记卡不进入本轮主流程。
- 只修改 `noteflow-miniprogram/` 和本计划文件；保留工作区其他已有修改。

---

### Task 1: 建立小程序纯逻辑测试与接口契约

**Files:** `noteflow-miniprogram/tests/contract.test.js`, `noteflow-miniprogram/utils/contracts.js`, `noteflow-miniprogram/utils/platform-detector.js`, `noteflow-miniprogram/utils/task-polling.js`

**Interfaces:** `normalizeAuthResult(result)`、`buildGeneratePayload(form)`、`unwrapResponse(body)`、`mapTaskStatus(status)`、`normalizeTask(task)` 均放在 `utils/contracts.js`，并保持 `parseUrl(url)` 为页面 API。

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAuthResult, buildGeneratePayload, unwrapResponse, mapTaskStatus } = require('../utils/contracts');
const { parseUrl } = require('../utils/platform-detector');

test('normalizes backend auth response', () => {
  assert.deepEqual(normalizeAuthResult({ token: 'jwt', user: { id: 1 } }), { token: 'jwt', refreshToken: '', user: { id: 1 } });
  assert.equal(normalizeAuthResult({ access_token: 'legacy' }).token, 'legacy');
});
test('builds VideoRequest field names', () => {
  assert.deepEqual(buildGeneratePayload({ url: 'https://www.bilibili.com/video/BV1xx', platform: 'bilibili', provider: { id: 'p1' }, model: { name: 'model-a' }, style: { value: 'outline' } }), {
    video_url: 'https://www.bilibili.com/video/BV1xx', platform: 'bilibili', quality: 'best', screenshot: false, link: false, model_name: 'model-a', provider_id: 'p1', format: [], style: 'outline', video_understanding: false, video_interval: 0, grid_size: [],
  });
});
test('unwraps success and throws business errors', () => {
  assert.deepEqual(unwrapResponse({ code: 200, data: { ok: true } }), { ok: true });
  assert.throws(() => unwrapResponse({ code: 400, msg: '参数错误' }), { code: 400, message: '参数错误' });
});
test('maps task states', () => {
  assert.deepEqual(mapTaskStatus('SUCCESS'), { key: 'success', label: '已完成', terminal: true, progress: 100 });
  assert.equal(mapTaskStatus('FAILED').terminal, true);
  assert.equal(mapTaskStatus('PENDING').progress, 12);
});
test('recognizes supported platforms', () => {
  assert.equal(parseUrl('https://www.bilibili.com/video/BV1xx'), 'bilibili');
  assert.equal(parseUrl('https://youtu.be/abc'), 'youtube');
  assert.equal(parseUrl('https://example.com/video'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run `node --test tests/contract.test.js` from `noteflow-miniprogram/`. Expected: FAIL because `utils/contracts.js` is absent.

- [ ] **Step 3: Implement the minimal contract helpers**

Create the four helpers above without `wx` dependencies. Normalize `token/access_token`; default backend generation options; map `SUCCESS`, `FAILED`, `CANCELLED`, `TIMEOUT`, `PENDING`, `DOWNLOADING`, `TRANSCRIBING`, `GENERATING`, and unknown states. Update platform parsing and polling terminal detection only where needed.

- [ ] **Step 4: Run tests**

Run `node --test tests/contract.test.js`. Expected: 5 tests, 0 failures.

- [ ] **Step 5: Commit**

`git add noteflow-miniprogram/tests noteflow-miniprogram/utils && git commit -m "test: define miniprogram api contracts"`

### Task 2: 修复环境、会话和统一请求层

**Files:** `noteflow-miniprogram/.env.js`, `noteflow-miniprogram/utils/request.js`, `noteflow-miniprogram/utils/auth.js`, `noteflow-miniprogram/app.js`, `noteflow-miniprogram/services/auth.js`, `noteflow-miniprogram/utils/contracts.js`, `noteflow-miniprogram/tests/contract.test.js`

- [ ] **Step 1: Add a failing session test**

Add `saveSessionPayload()` to the test import and this assertion:

```js
test('creates stable session payload', () => {
  assert.deepEqual(saveSessionPayload({ token: 'jwt', user: { username: 'Z' } }), { accessToken: 'jwt', refreshToken: '', user: { username: 'Z' } });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run `node --test tests/contract.test.js`. Expected: FAIL because `saveSessionPayload` is not exported.

- [ ] **Step 3: Implement session and request behavior**

Add `saveSessionPayload()`. Make auth use one `saveSession()`/`clearSession()` path for WeChat and password login. Send `{ account, password }` to `/api/auth/login`; accept both `token` and `access_token`. Remove refresh network calls from 401 handling; clear and reject with `登录已过期，请重新登录`. Use a configurable production-safe `API_BASE`, never defaulting to `localhost:3015`.

- [ ] **Step 4: Verify**

Run `node --test tests/contract.test.js` and `node --check utils/auth.js && node --check utils/request.js` from `noteflow-miniprogram/`. Expected: all pass and syntax checks exit 0.

- [ ] **Step 5: Commit**

`git add noteflow-miniprogram && git commit -m "fix: stabilize miniprogram authentication"`

### Task 3: 对齐服务层和生成/问答契约

**Files:** `noteflow-miniprogram/services/note.js`, `noteflow-miniprogram/services/chat.js`, `noteflow-miniprogram/services/profile.js`, `noteflow-miniprogram/utils/task-polling.js`, `noteflow-miniprogram/utils/contracts.js`, `noteflow-miniprogram/tests/contract.test.js`

- [ ] **Step 1: Write failing service contract tests**

Add assertions that `normalizeTask({ task_id: 't1', status: 'SUCCESS' })` returns `id: 't1'`, `status: 'success'`, and missing title becomes `未命名笔记`; add a chat payload assertion with `task_id/question/history/provider_id/model_name`. Run tests and confirm RED.

- [ ] **Step 2: Implement service corrections**

Add the pure normalizers; update `note.js` to use `generateNote`, expose `getTaskList` as an alias, normalize `task_id`, and keep the actual detail endpoint. Update `chat.js` to expose `sendMessage` only as a compatibility wrapper while detail uses `indexNote → getChatStatus → ask`. Polling stops on all terminal states.

- [ ] **Step 3: Verify**

Run `node --test tests/contract.test.js` and syntax-check `services/note.js services/chat.js services/profile.js utils/task-polling.js`. Expected: all pass.

- [ ] **Step 4: Commit**

`git add noteflow-miniprogram/services noteflow-miniprogram/utils noteflow-miniprogram/tests && git commit -m "fix: align miniprogram services with api"`

### Task 4: 重做全局视觉和首页生成体验

**Files:** `noteflow-miniprogram/app.json`, `noteflow-miniprogram/app.wxss`, `noteflow-miniprogram/pages/home/*`, `noteflow-miniprogram/components/video-preview/*`, `noteflow-miniprogram/components/model-selector/*`, `noteflow-miniprogram/components/credit-badge/*`

- [ ] **Step 1: Add a failing home payload fixture test**

Assert a valid home form builds `video_url`, `platform`, `model_name`, `provider_id`, and `style`. Run tests and observe RED before changing page/service mapping.

- [ ] **Step 2: Implement home flow**

Replace undefined `noteApi.createTask` with `noteApi.generateNote`; pass backend fields and defaults; read `res.task_id`; render `mapTaskStatus`; load recent tasks; preserve URL through login; add preview retry, clear, current-task access, and inline errors.

- [ ] **Step 3: Apply visual system**

Set navigation/tab colors to the teal system. Rewrite home around a warm-white page, one prominent input card, cards with a 4rpx top status line, restrained platform chips, typography hierarchy, and one full-width primary action. Remove emoji from formal controls and keep bottom TabBar safe.

- [ ] **Step 4: Verify and commit**

Run tests and syntax-check `pages/home/home.js components/video-preview/video-preview.js components/model-selector/model-selector.js`; then `git diff --check`. Commit as `feat: redesign miniprogram home workspace`.

### Task 5: 重做任务列表、详情阅读与 AI 问答

**Files:** `noteflow-miniprogram/pages/tasks/*`, `noteflow-miniprogram/pages/note-detail/*`, `noteflow-miniprogram/components/task-card/*`, `noteflow-miniprogram/components/markdown-viewer/*`, `noteflow-miniprogram/components/chat-bubble/*`, `noteflow-miniprogram/tests/contract.test.js`

- [ ] **Step 1: Add failing status/detail tests**

Test list normalization, `SUCCESS → success`, missing title, and chat history payload. Run tests and confirm RED.

- [ ] **Step 2: Implement list**

Normalize backend list responses, render filters and inline empty/network states, use `task_id` for navigation/deletion, refresh on show/pull-down, and poll only active tasks.

- [ ] **Step 3: Implement detail**

Parse Markdown safely; show empty/error/retry states; use a warm-white reading card with the teal status line; remove flashcard/collection actions; keep share/copy/delete.

- [ ] **Step 4: Implement non-streaming Q&A**

First question calls `indexNote`, polls `getChatStatus` to `indexed`, then calls `ask` with `task_id`, question, history, provider_id, model_name. Preserve failed questions and add retry; do not call `ask_stream`.

- [ ] **Step 5: Verify and commit**

Run tests, syntax-check every changed JS file, and run `git diff --check`; commit as `feat: add comfortable note reading flow`.

### Task 6: 重做登录与个人中心并完成静态验收

**Files:** `noteflow-miniprogram/pages/login/*`, `noteflow-miniprogram/pages/profile/*`, `noteflow-miniprogram/components/empty-state/*`, `noteflow-miniprogram/components/loading-skeleton/*`

- [ ] **Step 1: Add failing login/profile state tests**

Test empty account/password rejection messages and a login response storing `token`; run the Node test and confirm RED.

- [ ] **Step 2: Implement login**

Build centered login with NoteFlow mark, primary WeChat button, “其他方式” divider, account/password fallback, inline error, loading lock, and protocol copy. On success navigate back when possible, otherwise switch home.

- [ ] **Step 3: Implement profile**

Use one session source. Show logged-out login card; logged-in user card, credits, generated count, used model count; retain only core menu actions; make logout clear state and return home. Remove emoji from formal menu icons.

- [ ] **Step 4: Run final checks**

From `noteflow-miniprogram/`, run `node --test tests/contract.test.js`, `find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check`, and `git diff --check`. From root run `git diff --stat -- noteflow-miniprogram` and `git status --short -- noteflow-miniprogram docs/superpowers/plans/2026-08-12-miniprogram-core-loop.md`. Expected: tests and syntax checks pass; only intended paths are changed.

- [ ] **Step 5: Commit**

`git add noteflow-miniprogram docs/superpowers/plans/2026-08-12-miniprogram-core-loop.md && git commit -m "feat: deliver miniprogram core loop"`

## Self-Review Checklist

- [ ] Spec coverage: session, generation, task list, detail reading, Q&A, profile, visual tokens, error states, and acceptance checks each map to a task above.
- [ ] Placeholder scan: no `TBD`, `TODO`, vague error-handling steps, or undefined cross-task function names remain.
- [ ] Field consistency: backend names remain `account`, `video_url`, `model_name`, `provider_id`, `style`, `task_id`, and chat `task_id/question/history/provider_id/model_name`.
- [ ] Existing worktree changes are excluded from all add/commit commands except scoped paths listed above.
