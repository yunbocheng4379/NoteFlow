# 微信 Web 扫码登录 设计文档

**日期**: 2026-08-11
**范围**: 在 NoteFlow Web 端 (`NoteFlow_frontend`) 增加微信开放平台"网站应用"的扫码登录方式；扫码成功即建号 + 签发 JWT，随后由现有 `PhoneGuard` 强制走短信绑定手机号；用户信息字段与现有登录返回完全一致。
**不在范围**:
- 小程序登录 (`/auth/wechat-login` 已存在, 不改动)
- 公众号 H5 OAuth / Tauri 桌面端唤起微信
- 密码账号 ↔ 微信账号手动合并 UI
- profile 里解绑微信

---

## 1. 背景与现状

- `users` 表已存在 `wechat_openid` (unique) / `wechat_unionid` (unique) / `avatar` / `phone` 字段, 且 `email` 和 `hashed_password` 已改为可空 —— **数据模型已支持无邮箱/无密码的微信用户**。
- 现有 `/api/auth/wechat-login` 走的是**微信小程序** `sns/jscode2session`, 依赖 `WECHAT_MP_APPID` / `WECHAT_MP_SECRET`, 与本次要接入的"网站应用"体系**完全独立**。
- `AuthPage` 目前只有"密码登录 / 验证码登录 + 登录 / 注册" 两级 Tab, **没有任何第三方登录入口**。
- `App.tsx:42` 的 `PhoneGuard` 已经把所有 `user.phone == null` 的登录态强制重定向到 `/bind-phone`, 该页面走完 SMS 验证后写入 `users.phone`。**因此"微信登录后必须再用手机号验证"这一诉求由 PhoneGuard 天然满足, 无需新增中间态。**
- `backend/.env.example` 已有的 `WECHAT_APP_ID` / `WECHAT_MCH_ID` / `WECHAT_API_V3_KEY` 是**微信支付**用途, 不能复用为登录凭证。

---

## 2. 总体流程

```
浏览器 (AuthPage)                          后端 FastAPI                       微信开放平台
─────────────────                          ────────────                       ─────────────
[用户点"微信登录"]
      ↓
render <iframe src="qr_url" /> —— GET /api/auth/wechat/qr-url ─→
      ↓                             ← {qr_url, state}
iframe.src = qr_url  (open.weixin.qq.com/connect/qrconnect?…&state=xxx)  ──→ [显示二维码]
      ↓
[手机微信扫码 + 确认授权]                                                     ↓
      ↓                                                                    [302 回 redirect_uri]
iframe 内跳到 /api/auth/wechat/callback?code=XXX&state=xxx  ←──────────────
                                          ↓
                                     校验 state → code→access_token→openid/unionid
                                     → sns/userinfo 拿 nickname+headimgurl
                                     按 unionid 优先查 users
                                          ├─ 命中: 复用账号, 补 wechat_web_openid, 更新 last_login_at
                                          └─ 未命中: 建新号 (avatar+昵称+credits 赠送)
                                          ↓
                                     缓存 {token,user,is_new} 到 Redis (TTL 60s)
                                     302 到 WECHAT_WEB_FRONTEND_CALLBACK?state=xxx
      ↓
iframe 落地 /wechat/callback?state=xxx
      → postMessage({type:'wechat-login', state}) 到 window.parent
      ↓
父窗口 AuthPage: 收到消息 → POST /api/auth/wechat/exchange {state}
                → 拿 {token, user, is_new} → setAuth → 关闭 iframe
                ├─ !user.phone → navigate('/bind-phone')  ← PhoneGuard 也会兜底
                └─ 否则 → navigate('/')
```

**关键设计**:
- token **不出现在 URL 里**, 只通过 POST /exchange 从 Redis ticket 取回, 降低泄漏面
- state 是 Redis 一次性 nonce (`SETNX`+`GETDEL`), 防 CSRF, 300s TTL
- 无轮询: 用 `postMessage` 由 iframe 主动通知父页

---

## 3. 后端改动

### 3.1 环境变量 (`backend/.env.example`)

```env
# —— 微信开放平台 · 网站应用 (Web 扫码登录, 独立于小程序 / 微信支付) ——
WECHAT_WEB_APPID=
WECHAT_WEB_SECRET=
# 微信后台配置的"授权回调域"必须与此 base 前缀一致
# 生产: https://your-domain.com   开发: http://localhost:8483
WECHAT_WEB_REDIRECT_BASE=http://localhost:8483
# 扫码完成后, 后端 302 回到前端的地址
WECHAT_WEB_FRONTEND_CALLBACK=http://localhost:3015/wechat/callback
# 开发用: 无资质时开 mock, 固定返回一个 openid, 走完整前后端链路
WECHAT_WEB_MOCK=false
```

- **失败模式**: `WECHAT_WEB_APPID` 或 `WECHAT_WEB_SECRET` 缺失时, `/qr-url` 返回 HTTP 500 显式报错; 不做静默降级 (跟现有 `/auth/wechat-login` 的做法一致)
- **mock 模式**: `WECHAT_WEB_MOCK=true` 时, `/callback` 跳过 `code→access_token` 和 `sns/userinfo`, 用固定 payload `{openid: "mock_web_" + state[:8], unionid: None, nickname: "微信用户_" + state[:4], headimgurl: None}` 走完剩余流程, 方便无资质时联调

### 3.2 users 表字段调整

现有 `wechat_openid` 存的是**小程序 openid**, 与"网站应用 openid"不同 (同一个微信号在两端 openid 不同, unionid 相同)。为避免语义混乱且保留两端来源, **新增字段** `wechat_web_openid`:

| 字段 | 类型 | 约束 | 语义 |
|---|---|---|---|
| `wechat_openid` (已存在) | `VARCHAR(64)` | unique nullable | 小程序 openid |
| `wechat_web_openid` (**新增**) | `VARCHAR(64)` | unique nullable | 网站应用 openid |
| `wechat_unionid` (已存在) | `VARCHAR(64)` | unique nullable | 跨端主键, Web 扫码优先按此查用户 |

**用户查询顺序** (Web 扫码 callback 里):
1. 若 `unionid` 存在, `WHERE wechat_unionid = :unionid` 命中即复用, 顺便补写 `wechat_web_openid` (如果之前是空的)
2. 否则 `WHERE wechat_web_openid = :openid` 命中即复用
3. 都没命中 → 建新用户

### 3.3 数据库迁移

新增 `backend/app/db/migrate_add_wechat_web_openid.py`, 参照现有 `migrate_add_wechat_login.py` 但**修复其对 MySQL 静默跳过的缺陷** —— 本项目生产环境是 MySQL, 迁移脚本必须真跑 `ALTER TABLE`:

```python
# 伪代码
if dialect == "sqlite":
    check PRAGMA table_info(users) → ALTER TABLE users ADD COLUMN wechat_web_openid TEXT
if dialect == "mysql":
    check INFORMATION_SCHEMA.COLUMNS → ALTER TABLE users
      ADD COLUMN wechat_web_openid VARCHAR(64) NULL AFTER wechat_openid,
      ADD UNIQUE KEY uk_users_wechat_web_openid (wechat_web_openid)
```

**运维步骤**:
- 现有 MySQL 部署: `python -m app.db.migrate_add_wechat_web_openid` 手动执行一次
- 新部署: `init_db()` 里的 `Base.metadata.create_all` 会自动创建

### 3.4 Redis key

| Key | TTL | 消费方式 | 用途 |
|---|---|---|---|
| `wechat:oauth_state:{state}` | 300s | `SETNX` 写入, callback 里 `GETDEL` 消费 | CSRF 防护, 一次性 nonce |
| `wechat:qr_ticket:{state}` | 60s | callback 里 `SET`, exchange 里 `GETDEL` | 存扫码结果 (token+user+is_new) 供前端拉取 |

### 3.5 新增路由 (`app/routers/auth.py`)

| 路由 | 方法 | 认证 | 作用 |
|---|---|---|---|
| `/auth/wechat/qr-url` | GET | 无 | 生成 state → 存 Redis → 返回 `{qr_url, state}`。`qr_url = https://open.weixin.qq.com/connect/qrconnect?appid={APPID}&redirect_uri={URL-ENCODED redirect}&response_type=code&scope=snsapi_login&state={state}#wechat_redirect`, 其中 `redirect = {WECHAT_WEB_REDIRECT_BASE}/api/auth/wechat/callback` |
| `/auth/wechat/callback` | GET | 无 | 微信 302 命中的入口, `?code=...&state=...`。校验 state → 调 `https://api.weixin.qq.com/sns/oauth2/access_token` → 调 `https://api.weixin.qq.com/sns/userinfo` → 查/建 users → 缓存结果到 `wechat:qr_ticket:{state}` → **302 到 `WECHAT_WEB_FRONTEND_CALLBACK?state={state}`**。所有错误分支都 302 到 `WECHAT_WEB_FRONTEND_CALLBACK?state={state}&error={code}` |
| `/auth/wechat/exchange` | POST | 无 | Body: `{state}`。`GETDEL wechat:qr_ticket:{state}` → 返回 `{token, user, is_new}`。ticket 不存在/已消费 → `StatusCode.CODE_INVALID` |

**不复用**现有 `/auth/wechat-login`。小程序流程和 Web 扫码流程各自一个 endpoint, 字段各存各的, 通过 unionid 天然合并账号。

### 3.6 建新用户时的字段写入

```python
# nickname 清洗: 去掉两侧空白 + 屏蔽 emoji 变体选择符 (︎-️, ‍ 等 ZWJ)
# 避免部分 DB collation 存 emoji 时报错; 若清洗后为空则 fallback
cleaned_nickname = clean_wechat_nickname(nickname)
username = cleaned_nickname or f"wx_{openid[:10]}_{secrets.token_hex(2)}"

user = User(
    username=username,
    email=None,
    hashed_password=None,
    wechat_openid=None,               # 小程序 openid 保持空
    wechat_web_openid=openid,          # 网站应用 openid
    wechat_unionid=unionid,            # 可能为 None (账号未绑开放平台时)
    avatar=headimgurl or None,
    phone=None,                        # 由 PhoneGuard 强推走 /bind-phone
    credits=0,
    total_points=0,
    used_points=0,
)
db.add(user); db.flush()
referral_service.generate_referral_code(db, user.id)
credit_ledger.grant(
    db,
    user_id=user.id,
    amount=referral_service.REGISTER_GRANT_CREDITS,
    type_="REGISTER_GRANT",
    note="微信网站扫码新用户注册赠送",
)
```

**返回前端时统一走 `_user_payload(user)`**, 字段和密码 / 短信 / 小程序登录**完全一致**。前端 `UserInfo` 类型无需扩展。

### 3.7 用户名冲突

微信昵称可能重复。`users.username` 有 unique 索引, 需捕获 `IntegrityError` 后 fallback 到 `{nickname}_{secrets.token_hex(2)}` 重试, 最多 3 次; 仍冲突则用 `wx_{openid[:10]}_{secrets.token_hex(2)}` 兜底。

---

## 4. 前端改动

### 4.1 新增路由 `/wechat/callback` (`App.tsx`)

**不套 `AuthGuard` / `PhoneGuard`** (此时还没登录态)。组件 `WechatCallbackPage` 有两条运行路径:

1. **iframe 内被微信 302 命中** (主路径): `useEffect` 里读 `?state=…`, 校验 origin 后 `window.parent.postMessage({type:'wechat-login', state}, window.location.origin)`, 展示 loading (正常情况下父页会关掉 iframe)
2. **被用户直接打开** (兜底): 检测到 `window.parent === window` 时, 直接调 `authApi.wechatExchange(state)` 完成登录, 然后 `navigate('/')` 或 `navigate('/bind-phone')`

### 4.2 `AuthPage` 新增微信登录入口

**登录 mode 底部**新增区块 (注册 mode 不显示, 减少与"填写邀请码"表单的视觉冲突):

```
——————— 其他登录方式 ———————
        [微信官方绿 SVG 图标]
         微信扫码登录
```

点击后打开 **Dialog** (`components/ui/dialog` 已存在), 内容:
- 顶部标题"微信扫码登录"
- 中间 iframe: `<iframe src={qrUrl} sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation" />`, 尺寸 300×360 (微信 qrconnect 页面标准尺寸)
- 底部提示"请使用微信扫描二维码进行登录"

**Dialog 打开时的交互**:
1. `authApi.wechatQrUrl()` → `{qr_url, state}`, 存到组件 state
2. 挂载 `window.addEventListener('message', handler)`, `handler` 校验 `event.origin === window.location.origin && event.data.type === 'wechat-login' && event.data.state === savedState`
3. handler 触发后:
   - `authApi.wechatExchange(state)` → `{token, user, is_new}`
   - `setAuth(token, user)` + `rehydrateTaskStore()` + `loadHistory()` (跟现有密码登录完全一样的收尾)
   - 关闭 Dialog
   - `!user.phone` → `navigate('/bind-phone', { replace: true })`, 否则 → `navigate('/', { replace: true })`
4. Dialog 关闭时 `removeEventListener` + 清理 state
5. **超时兜底**: 打开 3 分钟无 message → 弹窗内展示"二维码已过期, 点击刷新", 点击后重新调 `/qr-url`

### 4.3 `services/auth.ts` 新增 API

```ts
wechatQrUrl: () =>
  request.get<any, { qr_url: string; state: string }>('/auth/wechat/qr-url'),

wechatExchange: (state: string) =>
  request.post<any, { token: string; user: UserInfo; is_new: boolean }>(
    '/auth/wechat/exchange',
    { state },
    { suppressToast: true },
  ),
```

`user` 字段类型 **完全复用**现有 `UserInfo`, 不新增字段 —— 这是"存储的用户信息格式和现有保持一致"的类型层保证。

### 4.4 品牌合规

- 图标: 内联微信官方绿 `#07C160` 的 SVG (不引外部依赖, 不落磁盘图片)
- 文案: 统一"微信登录"/"微信扫码登录", 避免使用"WeChat"英文

---

## 5. 配置清单

### 5.1 需要向业务方索要的凭证

| 项 | 来源 | 落地位置 | 缺失时的行为 |
|---|---|---|---|
| 网站应用 AppID | 微信开放平台 → 网站应用详情 | `WECHAT_WEB_APPID` | mock 模式可用假 openid; 生产模式 `/qr-url` 返回 500 |
| 网站应用 AppSecret | 同上 | `WECHAT_WEB_SECRET` | 同上 |
| 授权回调域 (纯域名, 非 URL) | 在开放平台后台配置 | `WECHAT_WEB_REDIRECT_BASE` 需要以此域名为前缀 | 微信授权页报 "redirect_uri 参数错误" |
| 备案域名 + HTTPS (仅生产) | 业务方自备 | 同上 | 微信生产环境强制要求 |

### 5.2 业务方需在微信开放平台后台完成的操作

1. 企业主体开通"网站应用"审核 (1-3 天, 个人主体不支持)
2. 拿到 AppID / AppSecret
3. 授权回调域填生产域名 (`localhost` 一般可以配, 用于开发)
4. **绑定小程序到同一开放平台账号** → 保证两端 unionid 一致, "按 unionid 合并账号"策略才生效; 不绑定则 Web 扫码和小程序会各建各的号 (这不是缺陷, 只是账号不合并)

### 5.3 本次代码交付默认开发行为

- `.env.example` 里 AppID / Secret 空着提交, 默认 `WECHAT_WEB_MOCK=true`
- 本地开发全链路可跑, 拿真实二维码需业务方填 Secret 后关闭 mock
- 代码不做二次改动即可切换到真实模式

---

## 6. 影响面与风险

| 项 | 结论 |
|---|---|
| 影响现有小程序登录 (`/auth/wechat-login`) | 否, 新增独立路由, 字段各存各的, 通过 unionid 关联 |
| 影响密码 / 短信 / 注册流程 | 否, 只在 AuthPage 底部追加区块, 不改现有表单 |
| 影响 `PhoneGuard` / `/bind-phone` | 否, 直接复用其兜底逻辑 |
| 影响 `_user_payload` 返回结构 | 否, 复用同一 serializer |
| iframe 被浏览器隐私模式拦截 | 低: `open.weixin.qq.com` 允许被嵌; 若拦截, WechatCallbackPage 的直接打开兜底路径会接手 |
| unionid 空 (账号未绑开放平台) | 低: 按 web_openid 建新号即可, 后续绑定后可手动合并 (phase 2) |
| MySQL 已有部署未跑迁移 | 中: 需在发版说明里显式列出迁移命令; 未跑时 SQLAlchemy 写入 `wechat_web_openid` 会报 "Unknown column" |
| 微信侧短暂故障 | 已在 callback 里捕获 httpx 异常 → 302 回前端带 `error=` 参数, 前端 dialog 展示"微信服务异常, 请稍后再试" |

---

## 7. 明确不做 (YAGNI)

- 独立的"扫码后中间态"页面 (PhoneGuard 承担)
- 密码账号与微信账号的手动合并 UI
- Profile 里的解绑微信操作
- 扫码状态轮询 (postMessage 更简洁)
- 桌面 Tauri 端唤起微信客户端 (前端环境不同, 后续独立立项)

---

## 8. 验收标准

- **场景 A**: mock 模式下, 点击微信登录 → dialog 打开显示二维码占位 → callback 302 → dialog 消失 → 跳 `/bind-phone` → SMS 验证完成 → 落地 `/`, `users` 表出现新用户, `wechat_web_openid = mock_web_...`, `phone` 有值
- **场景 B**: 真实模式下, 手机扫码授权后同上, `wechat_web_openid` 是真实值, `avatar` 是微信 CDN URL, `username` 是微信昵称 (清洗后)
- **场景 C**: 同一微信号 (unionid 相同) 已在小程序注册过一次, Web 扫码 → 不建新号, 复用旧账号, 补写 `wechat_web_openid`, `last_login_at` 更新
- **场景 D**: 后端返回的 `user` 对象字段与密码登录完全一致 (前端类型编译不报错, JSON diff 为空)
- **场景 E**: 手机绑定后 (`user.phone` 非空), 下次 Web 扫码复用账号, 直接跳 `/`, 不再进 `/bind-phone`
- **场景 F**: state 已消费 / 已过期时, `/exchange` 返回 `CODE_INVALID`, 前端展示"登录链接已失效, 请重新扫码"

