# 微信小程序扫码登录 PC 端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 NoteFlow PC 端微信网站 OAuth 二维码替换为“小程序扫码确认登录”，并复用现有 JWT、用户、手机号绑定和权限体系。

**Architecture:** 后端新增小程序码生成与 Redis 登录桥接接口；小程序新增 PC 登录确认页，通过 `wx.login()` 完成身份确认；PC 前端展示小程序码并轮询一次性 ticket，成功后写入现有 Zustand `userStore`。旧网站 OAuth 后端接口暂时保留作为回滚能力，但不再由 PC 默认入口调用。

**Tech Stack:** FastAPI、SQLAlchemy、Redis、httpx、Pydantic、React 19、TypeScript、Zustand、微信小程序原生 JavaScript。

## Global Constraints

- AppSecret 只能从后端环境变量 `WECHAT_MP_SECRET` 读取，不得写入前端、源码或构建产物。
- 生产配置必须显式提供 `WECHAT_MP_APPID`、`WECHAT_MP_SECRET`、`WECHAT_MP_PAGE`、`WECHAT_MP_QR_TTL`。
- state/ticket 必须短时有效且一次性消费；JWT 不得出现在 URL、二维码 scene 或 `postMessage` 中。
- PC 登录必须调用现有 `userStore.setAuth`，继续使用现有手机号绑定和权限路由。
- 小程序普通登录 `/api/auth/wechat-login` 的响应和行为必须兼容。
- 修改时避开当前工作区已有无关未提交改动；提交只包含本任务文件。
- 生产启用前必须完成 `www.noteflow.vip` HTTPS 和微信小程序合法域名配置。

---

## 文件结构

- Create `backend/app/services/wechat_miniprogram.py`: code2session、用户匹配/创建、统一 JWT 登录。
- Modify `backend/app/routers/auth.py`: 新增 QR、complete、status、exchange 接口；保留旧网站 OAuth 路由。
- Create `backend/tests/test_wechat_miniprogram_login.py`: 后端服务和桥接状态机测试。
- Modify `NoteFlow_frontend/src/services/auth.ts`: 新接口和类型。
- Modify `NoteFlow_frontend/src/components/WechatLoginDialog/index.tsx`: 小程序码展示、轮询和换票。
- Create `noteflow-miniprogram/pages/pc-login/pc-login.js/.wxml/.wxss`: 扫码确认页。
- Modify `noteflow-miniprogram/app.json` 和 `services/auth.js`。
- Create `noteflow-miniprogram/tests/pc-login.test.js`。
- Modify `.env.example`；不存在时创建 `docs/deployment/wechat.md`，只记录占位符配置。

## Task 1: 抽取可复用的小程序登录服务

**Files:**
- Create: `backend/app/services/wechat_miniprogram.py`
- Modify: `backend/app/routers/auth.py:561-655`
- Create: `backend/tests/test_wechat_miniprogram_login.py`

**Interfaces:**
- `async def wechat_code_to_session(code: str) -> dict`
- `def find_or_create_wechat_user(db: Session, openid: str, unionid: str | None) -> tuple[User, bool]`
- `async def login_with_wechat_code(db: Session, code: str) -> tuple[User, bool, str]`

- [ ] **Step 1: Write failing tests.** 在 `test_wechat_miniprogram_login.py` 测试 openid 命中、unionid 命中并补齐 openid、未命中创建用户、微信 errcode 转换为 `WechatMiniProgramError`。微信 HTTP 使用 fake `httpx.AsyncClient`，数据库沿用项目现有测试夹具或本文件内存 SQLite fixture。
- [ ] **Step 2: Verify failure.** Run `cd backend && pytest tests/test_wechat_miniprogram_login.py -q`；预期因服务文件/函数不存在而失败。
- [ ] **Step 3: Implement minimal service.** 读取 `WECHAT_MP_APPID`/`WECHAT_MP_SECRET`，请求 `https://api.weixin.qq.com/sns/jscode2session`；HTTP 错误、微信 `errcode`、缺少 openid 统一抛出 `WechatMiniProgramError`，日志不得包含 secret、完整请求 URL 或 code。用户匹配顺序为 openid → unionid → 新建用户；沿用当前邀请码、注册赠送和用户名兜底逻辑，IntegrityError 时回滚。命中停用账号时拒绝登录；成功用 `create_access_token` 签发 JWT。
- [ ] **Step 4: Replace `/auth/wechat-login` body.** 路由只调用 `login_with_wechat_code`，返回现有 `{token,user,is_new}`；保留现有错误包装，确保小程序 `utils/auth.js` 无需改动。
- [ ] **Step 5: Run focused tests.** Run `cd backend && pytest tests/test_wechat_miniprogram_login.py tests/test_auth_code_login.py -q`；预期 PASS。
- [ ] **Step 6: Commit scoped changes.** `git add backend/app/services/wechat_miniprogram.py backend/app/routers/auth.py backend/tests/test_wechat_miniprogram_login.py && git commit -m "refactor: share mini program login service"`。

## Task 2: 实现 Redis 登录桥接和小程序码接口

**Files:**
- Modify: `backend/app/routers/auth.py`（小程序登录路由后、旧网站 OAuth 区块前）
- Modify: `backend/app/db/redis_client.py`（只有确需原子 get-and-delete 时）
- Modify: `backend/tests/test_wechat_miniprogram_login.py`
- Modify: `.env.example` or Create: `docs/deployment/wechat.md`

**Interfaces:**
- `GET /api/auth/wechat/mini/qr` → `{qr_image,state,expires_in}`
- `POST /api/auth/wechat/mini/complete`，body `{state,code}` → `{completed:true}`
- `GET /api/auth/wechat/mini/status?state=...` → `{status: pending|ready|expired|failed}`
- `POST /api/auth/wechat/mini/exchange`，body `{state}` → 现有 `{token,user,is_new}`

- [ ] **Step 1: Write failing state-machine tests.** 使用 fake Redis 和 fake 微信 HTTP，覆盖：QR 生成高熵随机 state 并写 pending；status 初始 pending；complete 成功后 status ready；exchange 返回 JWT；重复 exchange 失败；过期/重复 complete 失败；停用用户无 ticket。二维码响应使用固定 PNG bytes，不调用真实微信。
- [ ] **Step 2: Verify failure.** Run `cd backend && pytest tests/test_wechat_miniprogram_login.py -q`；预期新路由不存在而失败。
- [ ] **Step 3: Add models and Redis keys.** 增加 `WechatMiniQrCompleteRequest`、`WechatMiniExchangeRequest`；state 使用 `secrets.token_urlsafe(24)` 生成 32 个 URL-safe 字符以满足微信 scene 限制；key 使用 `wechat:mini:pc:state:{state}` 和 `wechat:mini:pc:ticket:{state}`；state TTL 读取 `WECHAT_MP_QR_TTL` 默认 180 秒，ticket TTL 60 秒；Redis value 使用 JSON，不保存原始 wx code。
- [ ] **Step 4: Implement access_token and QR generation.** 缓存 `wechat:mini:access_token`，按微信 `expires_in - 60` 写入；调用 `cgi-bin/token` 和 `wxa/getwxacodeunlimit`，body 为 `{"scene": state, "page": os.getenv("WECHAT_MP_PAGE", "pages/pc-login/pc-login")}`；返回 `data:image/png;base64,...`，不返回微信 access_token。
- [ ] **Step 5: Implement transitions.** QR 写 pending；complete 先一次性删除 pending，再调用 Task 1 服务，成功写 ticket、失败写短 TTL failed；status 只返回状态不返回 JWT；exchange 使用 Redis Lua 或当前客户端可用的 GETDEL 原子取删 ticket，重复换票必须失败。
- [ ] **Step 6: Run tests.** `cd backend && pytest tests/test_wechat_miniprogram_login.py tests/test_auth_code_login.py -q`；预期 PASS。
- [ ] **Step 7: Commit.** `git add backend/app/routers/auth.py backend/app/db/redis_client.py backend/tests/test_wechat_miniprogram_login.py .env.example docs/deployment/wechat.md && git commit -m "feat: add mini program pc login bridge"`，只添加实际存在的配置文档文件。

## Task 3: 替换 PC 前端登录对话框

**Files:**
- Modify: `NoteFlow_frontend/src/services/auth.ts`
- Modify: `NoteFlow_frontend/src/components/WechatLoginDialog/index.tsx`
- Leave: `WechatCallbackPage` 和旧 callback 路由作为回滚兼容入口，除非构建明确要求清理未使用导入。

**Interfaces:**
- `authApi.wechatMiniQr(): Promise<{qr_image:string;state:string;expires_in:number}>`
- `authApi.wechatMiniStatus(state): Promise<{status:'pending'|'ready'|'expired'|'failed'}>`
- `authApi.wechatMiniExchange(state): Promise<WechatExchangeResult>`

- [ ] **Step 1: Add failing usage/types.** 先在组件中按上述签名调用新 API；运行 `cd NoteFlow_frontend && pnpm build`，预期因方法/类型未实现而失败。
- [ ] **Step 2: Implement API client.** 在 `auth.ts` 增加 `WechatMiniQrResult`、`WechatMiniStatusResult` 和三个 `suppressToast` 请求方法，路径分别为 `/auth/wechat/mini/qr`、`/auth/wechat/mini/status`、`/auth/wechat/mini/exchange`。
- [ ] **Step 3: Replace iframe flow.** `WechatLoginDialog` 使用 `<img src={qr_image}>`；打开时申请 QR，保存 state，按 2 秒轮询 status，最长使用服务端 TTL；ready 时只 exchange 一次，然后沿用现有 `setAuth`、`rehydrateTaskStore`、`loadHistory`、手机号绑定导航。移除 window message、stateRef、iframe sandbox；关闭/卸载/成功都清理 interval。
- [ ] **Step 4: Verify frontend.** Run `cd NoteFlow_frontend && pnpm lint && pnpm build`；预期 PASS。
- [ ] **Step 5: Commit.** `git add NoteFlow_frontend/src/services/auth.ts NoteFlow_frontend/src/components/WechatLoginDialog/index.tsx && git commit -m "feat: use mini program qr for pc login"`。

## Task 4: 新增小程序 PC 登录确认页

**Files:**
- Create: `noteflow-miniprogram/pages/pc-login/pc-login.js`
- Create: `noteflow-miniprogram/pages/pc-login/pc-login.wxml`
- Create: `noteflow-miniprogram/pages/pc-login/pc-login.wxss`
- Modify: `noteflow-miniprogram/app.json`
- Modify: `noteflow-miniprogram/services/auth.js`
- Create: `noteflow-miniprogram/tests/pc-login.test.js`

**Interfaces:**
- `auth.completePcLogin(state, code) -> Promise<{completed:boolean}>`
- 页面 `onLoad(options)` 读取 `options.scene`；不保存或展示 PC JWT。

- [ ] **Step 1: Write failing Node tests.** 测试页面导出的 `normalizeScene(scene)`（正确 decode、异常时返回原值）和 `canSubmitPcLogin(state)`（空值 false、非空 true）。
- [ ] **Step 2: Verify failure.** Run `cd noteflow-miniprogram && node --test tests/pc-login.test.js`；预期页面模块不存在而失败。
- [ ] **Step 3: Add service API.** 在 `services/auth.js` 加入：`request({url:'/api/auth/wechat/mini/complete', method:'POST', data:{state,code}, noAuth:true, suppressToast:true})`。
- [ ] **Step 4: Implement page.** `normalizeScene` 使用 `decodeURIComponent`；无 state 显示二维码无效；确认按钮调用 `wx.login()` 后 complete；处理中禁用按钮；成功显示已确认；失败允许重试；不调用 `saveSession`，不改变小程序当前会话。WXML/WXSS 使用本地 NoteFlow 风格。
- [ ] **Step 5: Register main-package page.** 在 `noteflow-miniprogram/app.json` 的 `pages` 数组加入 `pages/pc-login/pc-login`，不能放 subpackage。
- [ ] **Step 6: Verify.** Run `cd noteflow-miniprogram && node --test tests/pc-login.test.js tests/contract.test.js`；预期 PASS。
- [ ] **Step 7: Commit.** `git add noteflow-miniprogram/pages/pc-login noteflow-miniprogram/app.json noteflow-miniprogram/services/auth.js noteflow-miniprogram/tests/pc-login.test.js && git commit -m "feat: add mini program pc login confirmation"`。

## Task 5: 全量验证与上线交接

**Files:**
- Modify `.env.example` or `docs/deployment/wechat.md`，只写占位符。
- 必要时更新已批准设计文档的实现差异。

- [ ] **Step 1: Document safe configuration.** 写入：

```env
WECHAT_MP_APPID=wx_your_miniprogram_appid
WECHAT_MP_SECRET=replace_with_server_side_secret
WECHAT_MP_PAGE=pages/pc-login/pc-login
WECHAT_MP_QR_TTL=180
```

同时说明 AppSecret 不得提交 Git、`www.noteflow.vip` 必须 HTTPS、微信 request 合法域名为 `https://www.noteflow.vip`，以及小程序发布后再启用 PC 入口。
- [ ] **Step 2: Run backend tests.** `cd backend && pytest -q`；预期全部 PASS。
- [ ] **Step 3: Run frontend checks.** `cd NoteFlow_frontend && pnpm lint && pnpm build`；预期 PASS。
- [ ] **Step 4: Run Mini Program tests.** `cd noteflow-miniprogram && node --test tests/*.test.js`；预期全部 PASS。
- [ ] **Step 5: Run mocked smoke flow.** 验证 `QR → pending → complete → ready → exchange → second exchange rejected`，并检查响应和 tracked diff 不包含 AppSecret、微信 access_token 或微信 code。
- [ ] **Step 6: Scope/secrets check.** Run `git status --short`、`git diff --check`，并使用本地安全扫描工具检查实际密钥模式；预期真实密钥不在代码文件，现有无关改动保持不变。
- [ ] **Step 7: Handoff.** 交付服务器环境变量、AppSecret 轮换、HTTPS/合法域名、小程序发布和未配置时的友好错误提示说明。

## Plan Self-Review

- **Spec coverage:** 后端配置、二维码生成、Redis 状态、openid/unionid 匹配、现有 JWT/权限复用、PC 轮询、小程序确认页、错误边界、测试和部署前置条件均覆盖在 Task 1–5。
- **Placeholder scan:** 没有 TBD/TODO 作为实施依赖；代码片段中的 `...` 仅出现在服务接口示意，Task 1 明确要求实际实现时不得保留。
- **Type consistency:** 前端三条新 API 的字段与后端响应一致；小程序 complete 只返回 completed，JWT 只由 PC exchange 获取。
- **Scope check:** 旧网站 OAuth 路由不删除，避免对现有用户造成无关影响；每个提交命令只包含本任务文件。
