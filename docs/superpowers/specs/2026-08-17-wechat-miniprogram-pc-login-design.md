# 微信小程序扫码登录 PC 端设计

## 背景

NoteFlow 当前 PC 端使用微信开放平台网站应用 OAuth 二维码登录。项目已经存在微信小程序登录能力：小程序通过 `wx.login()` 获取临时 code，后端调用 `jscode2session` 查找或创建用户并签发系统 JWT。

本次改造将 PC 端登录入口切换为“小程序码扫码桥接登录”，复用现有用户、JWT、手机号绑定和权限体系，不新增独立的 PC 权限模型。

## 目标

- PC 端展示由后端生成的微信小程序码。
- 用户扫码后进入小程序专用确认页，点击确认后完成 PC 登录。
- PC 端取得现有系统 JWT，继续使用当前 `userStore`、路由守卫和手机号绑定流程。
- 登录状态和票据短时有效、一次性消费，避免二维码重放。
- 尽量通过 `openid`/`unionid` 复用已有账号，降低重复建号风险。
- 保留旧网站 OAuth 后端接口作为短期回滚能力，替换 PC 前端默认入口。

## 非目标

- 本次不实现微信支付。
- 本次不改变现有登录后的权限判定规则。
- 本次不把 AppSecret 放入前端、代码仓库或构建产物。
- 本次不在服务器上自动完成 HTTPS 证书申请和 Nginx 改造；生产启用前需要单独完成域名 HTTPS 和小程序合法域名配置。

## 用户流程

```text
PC 登录页
  │ GET /api/auth/wechat/mini/qr
  ▼
后端生成 state + 小程序码，Redis 保存 pending state
  │
  ▼
PC 展示二维码并轮询 status
  │
  ▼
微信扫码打开 pages/pc-login/pc-login?scene=state
  │
  ▼
小程序展示“确认登录 NoteFlow PC 端”
  │ 用户点击确认
  ▼
wx.login() → POST /api/auth/wechat/mini/complete
  │
  ▼
后端 jscode2session → 查找/创建用户 → 生成 JWT
  │ Redis 保存一次性 ticket
  ▼
PC status 得到 ready → POST /api/auth/wechat/mini/exchange
  │
  ▼
PC 写入 userStore → 现有 PhoneGuard/权限流程继续工作
```

## 后端设计

### 配置

使用以下服务端环境变量：

```env
WECHAT_MP_APPID=微信小程序 AppID
WECHAT_MP_SECRET=微信小程序 AppSecret
WECHAT_MP_PAGE=pages/pc-login/pc-login
WECHAT_MP_QR_TTL=180
```

AppSecret 只从后端环境读取。现有代码中的默认 AppID 应逐步改为要求显式配置，避免生产环境误用默认值。

### 小程序码生成

新增 PC 桥接二维码接口，后端完成以下工作：

1. 生成高熵随机 state。
2. 将 pending 状态写入 Redis，包含创建时间和状态，TTL 默认 180 秒。
3. 使用后端缓存的微信 `access_token` 调用 `wxa/getwxacodeunlimit`。
4. `scene` 只携带 state，页面固定为 `pages/pc-login/pc-login`。
5. 返回二维码图片数据、state 和有效期，不返回微信 access_token。

微信 access_token 单独按有效期缓存，接近过期时刷新；错误响应统一转换为业务错误，避免泄露微信密钥或原始敏感响应。

### 桥接接口

接口路径使用 `/api/auth/wechat/mini/*`，与小程序常规登录接口区分：

- `GET /auth/wechat/mini/qr`
  - 返回 `{ qr_image, state, expires_in }`。
  - 创建待登录状态。

- `POST /auth/wechat/mini/complete`
  - 请求 `{ state, code }`，由小程序确认页调用。
  - 校验并消费 pending state；调用现有小程序 `code2session` 流程。
  - 查找/创建用户并生成现有 JWT。
  - 将 `{ token, user, is_new }` 写入一次性 ticket，ticket TTL 默认 60 秒。
  - 返回成功或业务错误；小程序端只需要知道是否完成，不需要把 PC ticket 展示给用户。

- `GET /auth/wechat/mini/status?state=...`
  - 返回 `pending`、`ready`、`expired` 或 `failed`。
  - `ready` 只表示存在待换取 ticket，不直接返回 JWT。

- `POST /auth/wechat/mini/exchange`
  - 请求 `{ state }`。
  - 一次性消费 ticket，返回现有统一登录响应 `{ token, user, is_new }`。

### 用户匹配与权限

将现有 `/auth/wechat-login` 的“code 换用户/创建用户/签发 JWT”逻辑抽为可复用服务，普通小程序登录和 PC 桥接登录共用同一实现。

用户匹配顺序：

1. 小程序 `openid`。
2. 微信返回 `unionid` 时按 `unionid` 查找已有用户，并补齐小程序 `openid`。
3. 都未命中时创建新用户，沿用现有邀请码和注册赠送逻辑。

如果匹配到的用户已停用，登录失败且不签发 JWT。登录成功后使用现有 `create_access_token` 和 `_user_payload`，因此 PC 端的管理员、手机号守卫、积分和其他权限逻辑不变。

### Redis 安全

- state 使用 24 字节随机值并编码为 32 个 URL-safe 字符，满足微信 `scene` 长度限制且不能被预测。
- pending state、ticket 均设置 TTL。
- complete 只能消费一次 pending state。
- exchange 使用 Redis 原子删除/取值逻辑，避免重复换票。
- 前端轮询停止、弹窗关闭或超时后，后端状态自然过期。

旧 `/auth/wechat/qr-url`、`/auth/wechat/callback`、`/auth/wechat/exchange` 后端接口暂时保留，前端不再默认调用，便于灰度回滚；旧接口不参与新桥接流程。

## PC 前端设计

改造 `WechatLoginDialog`：

- 由 iframe 加载网站 OAuth 页面改为展示后端返回的小程序码图片。
- 打开弹窗时请求 `/auth/wechat/mini/qr`。
- 每 2 秒轮询 `/auth/wechat/mini/status`，最长等待约 3 分钟。
- `ready` 后调用 `/auth/wechat/mini/exchange`。
- 成功后调用现有 `setAuth`、任务历史刷新和导航逻辑。
- 未绑定手机号继续跳转 `/bind-phone`。
- 显示加载、二维码过期、登录成功、用户取消和服务异常状态。
- 关闭弹窗时停止轮询；不把 JWT 放入 URL 或 `postMessage`。

删除或停用 PC 端对旧 iframe callback 的依赖，旧 callback 路由可以暂时保留为兼容入口，但不再由新组件使用。

## 小程序设计

新增主包页面 `pages/pc-login/pc-login`，避免扫码进入时受到分包加载限制。

页面行为：

1. 从 `onLoad(options)` 读取 `options.scene`，兼容 URL 解码。
2. 没有 scene 或 scene 已过期时显示错误和返回入口。
3. 展示产品名称、登录说明和“确认登录”按钮。
4. 点击确认后调用 `wx.login()`，把 `code` 与 `state` 发给 `/api/auth/wechat/mini/complete`。
5. 成功显示“已登录 PC 端”，失败显示可重试提示。
6. 普通从小程序入口打开时不触发 PC 桥接逻辑。

小程序自己的常规登录仍调用 `/api/auth/wechat-login`，成功后照旧保存小程序端 JWT；PC 桥接确认页只负责通知后端完成桥接，不改变小程序当前会话行为。

## 错误和边界情况

- 二维码过期：PC 和小程序均提示重新扫码。
- 用户取消：小程序不调用 complete，PC 继续等待直到超时。
- code 失效：小程序允许重新获取 code 后重试，但 state 仍只能完成一次。
- 用户停用：返回统一账号停用错误，不创建 ticket。
- 微信接口异常：后端记录内部日志，前端显示通用错误。
- PC 多标签页：只有持有该 state 的弹窗可以完成本次登录；exchange 一次性消费。
- 小程序网络域名未配置 HTTPS：部署检查项中明确提示，不在前端静默重试。

## 测试与验证

后端测试先覆盖：

- QR state 创建和过期。
- complete 状态转换、重复 complete 拒绝。
- status 的 pending/ready/expired/failed 状态。
- exchange 一次性消费和重复 exchange 拒绝。
- openid/unionid 用户匹配及新用户创建。
- 停用用户不能签发 JWT。

前端测试覆盖：

- 二维码加载和轮询生命周期。
- ready 后换票并写入 `userStore`。
- 过期、关闭弹窗和错误提示。

小程序测试覆盖：

- 从 scene 进入确认页。
- 无 scene、过期和重复提交处理。
- 确认后调用 wx.login 和桥接接口。

完成后运行后端 pytest、前端 lint/build，以及小程序现有测试；对接口做一次本地 mock 流程验证。

## 部署注意事项

- 生产环境显式配置 `WECHAT_MP_APPID` 和 `WECHAT_MP_SECRET`。
- 立即轮换曾在聊天中暴露过的 AppSecret。
- 为 `www.noteflow.vip` 配置 HTTPS。
- 在微信公众平台配置小程序 request 合法域名为 `https://www.noteflow.vip`。
- 上传并发布包含 `pages/pc-login/pc-login` 的小程序版本后，再启用 PC 端入口。
