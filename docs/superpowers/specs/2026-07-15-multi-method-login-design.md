# 多方式登录与强制绑定手机号 — 设计文档

日期：2026-07-15

## 背景

BiliNote 当前只支持「用户名/邮箱 + 密码」登录（`backend/app/routers/auth.py`）。需要新增邮箱验证码登录和手机验证码登录，并在用户注册成功后强制绑定手机号。项目目前未接入任何短信服务商，未接入验证码逻辑；已有 Redis 依赖（`redis==5.2.1`）但未在认证流程中使用。`users` 表已存在 `phone` 字段（当前为死字段，大量老用户为空）。

## 目标

1. 登录页支持三种方式：密码登录、邮箱验证码登录、手机验证码登录。
2. 注册成功后强制绑定手机号；老用户下次登录时同样被拦截要求补绑。
3. 验证码统一走 Redis 存储 + TTL 过期,配基础限流防止短信/邮件被刷。
4. 短信服务商选用阿里云短信。

## 非目标

- 不引入图形/滑块验证码。
- 不做后端接口层的绑定强制拦截,只做前端路由守卫拦截。
- 不迁移/清理 `phone` 字段之外的用户模型改动。

## 后端设计

### 验证码存储（Redis）

- Key: `verify_code:{purpose}:{target}` → 6 位数字码,字符串,TTL 300 秒。
  - `purpose`: `login`（验证码登录）｜ `bind`（绑定手机号）
  - `target`: 手机号或邮箱原始字符串
- 校验成功后立即删除 key（一次性消费）,避免重放。
- 限流 key：
  - `verify_code_cooldown:{target}` — `SETNX` + `EX 60`,60 秒内同一 target 只能发一次（更新：实现已改为 Lua script 原子比较并设置，语义变更为 target+purpose 维度限流，60 秒内同一 target 对同一 purpose 只能发一次，不同 purpose 互不影响）
  - `verify_code_daily:{target}:{YYYYMMDD}` — 计数器,每日上限 10 次,超出返回 `RATE_LIMITED`

### 短信服务封装

新增 `backend/app/services/sms_service.py`：

- 使用阿里云短信 SDK（`alibabacloud_dysmsapi20170525`）
- 配置来自环境变量：`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE`、`ALIYUN_SMS_REGION`（默认 `cn-hangzhou`）
- 提供 `send_verification_sms(phone: str, code: str) -> bool`
- 发送失败时抛出业务异常,由路由层转换为 `SEND_CODE_FAILED`

### 邮箱验证码

复用 `backend/app/utils/mailer.py` 的 SMTP 能力,新增 `send_verification_email(email: str, code: str)`,与现有 `send_task_completed_email` 风格一致。

### 新增/修改路由（`backend/app/routers/auth.py`）

1. **`POST /auth/send-code`**
   - Body: `{ target: str, target_type: "email" | "phone", purpose: "login" | "bind" }`
   - 校验 `target_type` 与 `target` 格式匹配（手机号正则 `^1\d{10}$`,邮箱走现有邮箱正则）
   - `purpose == "login"`：查库,若无对应账号返回 `TARGET_NOT_FOUND`
   - `purpose == "bind"`：查库,若手机号已被其他账号占用返回 `PHONE_EXISTS`
   - 触发限流检查（冷却 + 每日上限）,不通过返回 `RATE_LIMITED`
   - 生成 6 位随机码,写入 Redis,调用短信/邮件发送,失败返回 `SEND_CODE_FAILED`

2. **`POST /auth/login-by-code`**
   - Body: `{ target: str, target_type: "email" | "phone", code: str }`
   - 按 email 或 phone 查用户,不存在返回 `ACCOUNT_NOT_FOUND`
   - 校验 Redis 中的验证码,不匹配 `CODE_INVALID`,过期/不存在 `CODE_EXPIRED`
   - 校验通过：删除验证码 key,检查 `is_active`,更新 `last_login_at`,签发 JWT,返回结构与现有 `/auth/login` 一致

3. **`POST /auth/bind-phone`**（需要 `get_current_user` 依赖,即已登录态）
   - Body: `{ phone: str, code: str }`
   - 校验手机号格式、唯一性（`PHONE_EXISTS`）
   - 校验 Redis 中 `purpose=bind` 的验证码
   - 通过后写入 `current_user.phone`,提交

4. **修改 `POST /auth/login`**
   - 原有 `or_(User.username == account, User.email == account)` 扩展为 `or_(User.username == account, User.email == account, User.phone == account)`
   - 其余逻辑不变（密码校验、`is_active` 检查、签发 JWT）

### 错误码

新增到现有 `StatusCode` 体系：`TARGET_NOT_FOUND`、`PHONE_EXISTS`、`CODE_INVALID`、`CODE_EXPIRED`、`RATE_LIMITED`、`SEND_CODE_FAILED`。

### 配置文件

- `.env.example` 新增阿里云短信相关 5 个环境变量（见上）
- `backend/requirements.txt` 新增 `alibabacloud_dysmsapi20170525` 及其依赖的 `alibabacloud-tea-openapi`

## 前端设计

### 登录页 `AuthPage`

- 顶层 Tab：「密码登录」｜「验证码登录」
- 「验证码登录」下二级切换：「邮箱验证码」｜「手机验证码」
- 密码登录的账号输入框 placeholder 改为「用户名 / 邮箱 / 手机号」
- 验证码登录表单：目标账号输入框 + 「获取验证码」按钮（60 秒倒计时,倒计时期间禁用并显示剩余秒数）+ 验证码输入框 + 登录按钮
- 若 `send-code` 返回 `TARGET_NOT_FOUND`,提示文案引导用户切换到注册

### 绑定手机号页 `/bind-phone`

- 新页面,手机号输入框 + 获取验证码按钮（60 秒倒计时）+ 验证码输入框 + 提交按钮
- 提交成功后更新 `userStore` 中的 `user.phone`,跳转到主应用首页
- 无「跳过」入口（硬阻断）

### 路由守卫

- 在 `RootLayout`（或等价的受保护路由入口）中新增检查：读取 `userStore` 中当前用户的 `phone`
- 若 `phone` 为空且当前路由不是 `/bind-phone` 本身,强制 `redirect` 到 `/bind-phone`
- 每次进入受保护路由都检查（不是仅注册后一次性检查）,这样老用户在下次登录后同样会被拦截
- 绑定成功后放行到原本要去的路由（或直接到首页）

### `services/auth.ts` 新增方法

- `sendCode(params: { target: string; target_type: 'email' | 'phone'; purpose: 'login' | 'bind' })`
- `loginByCode(params: { target: string; target_type: 'email' | 'phone'; code: string })`
- `bindPhone(params: { phone: string; code: string })`
- `AuthErrorCode` 映射同步新增六个错误码的文案

## 数据流

**验证码登录：**
输入账号 → 点击获取验证码 → `POST /auth/send-code` → Redis 写码 + 短信/邮件发送 → 用户输入码 → `POST /auth/login-by-code` → 校验通过签发 JWT → 前端存 token → 路由守卫检查 `phone` → 为空则跳 `/bind-phone`,否则进主应用

**强制绑定：**
注册成功／验证码或密码登录成功 → 路由守卫检测 `phone` 为空 → 跳转 `/bind-phone` → 输入手机号 + 获取验证码 → `POST /auth/send-code`(purpose=bind) → 输入码 → `POST /auth/bind-phone` → 成功更新本地状态 → 放行

## 测试计划

- 后端单测（mock Redis、mock 短信/邮件发送）：
  - 限流逻辑（冷却期内拒绝、超过每日上限拒绝）
  - 验证码生成、校验成功后失效（一次性消费）、过期校验
  - `login-by-code` 全流程（账号不存在、码错误、码过期、成功签发 JWT）
  - `bind-phone` 全流程（格式校验、唯一性冲突、成功绑定）
  - `/auth/login` 手机号登录路径
- 前端：手动在浏览器中走一遍密码登录、邮箱验证码登录、手机验证码登录、注册后强制绑定手机号、老用户登录后被拦截补绑的完整流程

## 风险与权衡

- 强制绑定仅在前端拦截,若用户直接调用后端 API（跳过前端）可绕过绑定检查。已与用户确认接受此权衡,后续如需加固可在关键业务接口加 `phone` 校验依赖。
- 阿里云短信需要真实的 AccessKey/签名/模板审核,在没有配置这些环境变量的本地开发环境下,发送手机验证码会失败（`SEND_CODE_FAILED`）,开发时可用邮箱验证码路径验证整体流程。
