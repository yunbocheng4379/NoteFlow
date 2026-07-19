# 电力（Credit）计费与会员订阅系统 — 设计文档

> 创建日期：2026-06-30
> 状态：与用户对齐 11 项核心决策完成；6 张截图已收，账单页 + 支付页自由设计
> 涉及子系统：后端计费/订单/订阅、前端三级菜单（升级 Pro / 账单与额度 / 我的推荐码）、数据库 7 张新表 + 1 张表迁移、note 生成链路改造

---

## 1. 背景与目标

BiliNote 当前为开源 AI 视频笔记工具，无商业化模型。本设计为系统引入**电力（Credit）** 概念作为统一的内部计费单位：

- 用户每次生成笔记按「视频时长 × 模型计费率」**预扣**电力，失败自动退还
- 电力可通过**充值套餐**（一次性付款）或**会员订阅**（每月固定发放）获取
- 系统支持**两段式推荐邀请**：注册即得 + 邀请人在被邀请人首订阅时获额外加成
- 所有金额流转均在 MySQL 事务中完成，行级锁防并发，账本不可改

UI 用「电力 ⚡」作为唯一术语；代码 / API / DB 字段全部使用 `credits`。

成功标准：
1. 用户余额任何时刻都等于 `users.credits`，不依赖任何聚合
2. 同一笔扣费 / 加电 / 返点不可能因为重试或并发出现"双扣""漏退""漏发"
3. 老用户的 100 点免费额度无损迁移到新模型
4. 所有金额相关操作必有审计流水（`credit_transactions` 永久保留，只 INSERT）
5. 用户隔离严格：任意接口不可读写他人余额、订单、流水

---

## 2. 核心商业决策（最终对齐，11 条）

| # | 决策点 | 选定方案 |
|---|---|---|
| 1 | 支付集成 | Mock 支付（二维码 + 「我已支付」按钮 → 后端直接 mark PAID）。结构上预留真实支付宝/微信接入点 |
| 2 | 会员语义 | 订阅期内每月发放固定电力 |
| 3 | 计费模型 | `credits = ceil(duration_min) × model_rate`，model_rate 在 `credit_pricing` 表配置 |
| 4 | 扣费时机 | 预估预扣 + 失败退费。后端独立调 downloader.skip_download 拿 duration |
| 5 | 推荐返点（两段） | (a) 注册时若填邀请码：被邀请人 +200，邀请人 +20；(b) 被邀请人**首次**订阅会员（任何方案）支付成功：邀请人额外 +100 |
| 6 | 过期策略 | **所有电力永不过期**（充值、会员发放、注册赠送、推荐返点全都永久有效） |
| 7 | 字段对接 | `users.total_points` → 重命名为 `credits`；`users.used_points` 保留为「累计消耗」展示用，不参与扣费计算 |
| 8 | 免费额度 | 老+新用户都送 100 点（落 credits） |
| 9 | 充值套餐 seed | ¥9.9=100, ¥29=350, ¥99=1500（非线性档位） |
| 10 | 会员套餐 seed | 月度 首单¥9.9/续费¥19.9=月发1000；季度 首单¥39/续费¥59=月发800；年度 首单¥168/续费¥199=月发2000 |
| 11 | 视觉主题 | `/upgrade` 升级 Pro 页用蓝色（`#2563eb` 系，对应截图视觉），`/billing` 账单页 / `/referral` 推荐码页延续 teal `#167a6e` 主题 |

> "首单价"机制：每个用户每个 plan 只能享受一次首单价。续订或购买不同周期时**该 plan** 的下一次按续费价计费。`subscriptions` 表通过 `(user_id, plan_id)` 历史记录判断。

---

## 3. 数据模型

### 3.1 `users` 表改造

| 字段 | 类型 | 默认 | 改动 | 备注 |
|---|---|---|---|---|
| **credits**（原 total_points） | INT | 100 | 重命名 | 当前电力余额，永不过期，扣费/加电直接增减 |
| used_points | INT | 0 | 保留 | 累计总消耗（仅展示用，不参与扣费） |
| **referral_code** | VARCHAR(16) UNIQUE | — | 新增 | 当前用户的推荐码（注册时生成，6 位 base32） |
| **referred_by_user_id** | INT NULL | NULL | 新增 | 注册时填写邀请码绑定的邀请人，不可改；FK→users(id) |
| **active_subscription_id** | BIGINT NULL | NULL | 新增 | 当前生效订阅 id，NULL = 免费用户；FK→subscriptions(id) |

迁移策略详见 §6。

### 3.2 新表 `credit_pricing`

```sql
CREATE TABLE credit_pricing (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  model_name VARCHAR(128) NOT NULL UNIQUE COMMENT '模型名称, 与 VideoTask.model_name 一致',
  rate_per_minute INT NOT NULL COMMENT '每分钟消耗电力数',
  is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用 1/0',
  is_default TINYINT NOT NULL DEFAULT 0 COMMENT '未匹配模型时的兜底, 应用层保证全表至多一条 is_default=1',
  description VARCHAR(255) NULL COMMENT '展示用描述',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) COMMENT '模型计费率配置表';
```

Seed：
- `gpt-4o` → 5
- `gpt-4o-mini` → 1
- `claude-opus` → 10
- `claude-sonnet` → 5
- `claude-haiku` → 1
- `deepseek-v3` → 1
- `gemini-2.0-pro` → 5
- `__default__` → 3（`is_default=1`，兜底）

### 3.3 新表 `credit_transactions`（账本，核心）

```sql
CREATE TABLE credit_transactions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '流水主键',
  user_id INT NOT NULL COMMENT '用户 id',
  type ENUM(
    'RECHARGE',           -- 充值到账
    'CONSUME',            -- 生成笔记消耗
    'REFUND',             -- 笔记失败退费
    'MONTHLY_GRANT',      -- 会员月度发放
    'REGISTER_GRANT',     -- 注册赠送 100
    'REGISTER_INVITEE',   -- 被邀请人注册奖励 200
    'REGISTER_INVITER',   -- 邀请人注册奖励 20
    'FIRST_SUB_INVITER',  -- 邀请人在被邀请人首订阅时奖励 100
    'ADMIN_ADJUST'        -- 管理员手动调整
  ) NOT NULL COMMENT '流水类型',
  amount INT NOT NULL COMMENT '变动量, 正=加电, 负=扣电',
  balance_after INT NOT NULL COMMENT '本次操作后 credits 余额',
  related_task_id VARCHAR(64) NULL COMMENT '关联的 video_tasks.task_id (CONSUME/REFUND 必填)',
  related_order_id BIGINT NULL COMMENT '关联的 orders.id (RECHARGE/MONTHLY_GRANT/FIRST_SUB_INVITER 关联)',
  related_subscription_id BIGINT NULL COMMENT '关联的 subscriptions.id (MONTHLY_GRANT)',
  related_referral_id BIGINT NULL COMMENT '关联的 referral_rewards.id (REGISTER_INVITEE/REGISTER_INVITER/FIRST_SUB_INVITER)',
  refunded_at DATETIME NULL COMMENT '当本行 type=CONSUME, 该字段记录被退费时间, NULL 表示未退; 防重放',
  note VARCHAR(255) NULL COMMENT '备注, 如 "生成笔记: https://...", "Pro 月度发放"',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_user_type (user_id, type),
  INDEX idx_task (related_task_id),
  INDEX idx_order (related_order_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '电力流水/账本, 永久保留, 只 INSERT (除 refunded_at 例外)';
```

不变量：任意时刻一个用户最新一条 `credit_transactions.balance_after` 必须等于该用户的 `users.credits`。

### 3.4 新表 `recharge_packages`

```sql
CREATE TABLE recharge_packages (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  code VARCHAR(32) NOT NULL UNIQUE COMMENT '套餐编码, 如 PKG_BASIC',
  name VARCHAR(64) NOT NULL COMMENT '展示名称, 如 "入门包"',
  price_cents INT NOT NULL COMMENT '价格(分)',
  credits INT NOT NULL COMMENT '充值获得的电力',
  unit_price_text VARCHAR(32) NULL COMMENT '展示用单价文案, 如 "¥0.099/电力"',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '展示排序, 升序',
  badge VARCHAR(32) NULL COMMENT '徽章文案, 如 "最受欢迎"',
  is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否上架',
  description VARCHAR(255) NULL COMMENT '描述, 如 "≈5 篇 30 分钟视频"',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) COMMENT '充值套餐定义表';
```

Seed（与截图严格对齐）：

| code | name | price_cents | credits | unit_price_text | sort_order | badge | description |
|---|---|---|---|---|---|---|---|
| PKG_BASIC | 入门包 | 990 | 100 | ¥0.099/电力 | 1 | — | ≈5 篇 30 分钟视频 |
| PKG_STANDARD | 标准包 | 2900 | 350 | ¥0.083/电力 | 2 | 最受欢迎 | ≈17 篇 30 分钟视频 |
| PKG_PRO | 专业包 | 9900 | 1500 | ¥0.066/电力 | 3 | — | ≈75 篇 30 分钟视频 |

### 3.5 新表 `subscription_plans`

```sql
CREATE TABLE subscription_plans (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  code VARCHAR(32) NOT NULL UNIQUE COMMENT '方案编码, 如 SUB_MONTHLY',
  name VARCHAR(64) NOT NULL COMMENT '展示名称, 如 "月度会员"',
  duration_days INT NOT NULL COMMENT '订阅时长(天), 月/季/年 = 30/90/365',
  monthly_credits INT NOT NULL COMMENT '每月发放电力数',
  first_price_cents INT NOT NULL COMMENT '首单价(分), 用户首次订阅此 plan 适用',
  renewal_price_cents INT NOT NULL COMMENT '续费价(分), 用户再次订阅此 plan 适用',
  original_price_cents INT NULL COMMENT '展示用原价(分), 用于划线显示',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '展示排序',
  badge VARCHAR(32) NULL COMMENT '徽章文案, 如 "推荐 · 立省 17%"',
  is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否上架',
  description TEXT NULL COMMENT '权益描述, JSON 数组或 markdown 列表',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) COMMENT '会员订阅方案表(按订阅时长分档)';
```

Seed（与截图严格对齐）：

| code | name | duration_days | monthly_credits | first_price_cents | renewal_price_cents | original_price_cents | sort_order | badge |
|---|---|---|---|---|---|---|---|---|
| SUB_MONTHLY | 月度会员 | 30 | 1000 | 990 | 1990 | 2900 | 1 | — |
| SUB_QUARTERLY | 季度会员 | 90 | 800 | 3900 | 5900 | 7800 | 2 | — |
| SUB_YEARLY | 年度会员 | 365 | 2000 | 16800 | 19900 | 28800 | 3 | 推荐 · 立省 17% |

**首单价规则**：创单时查询当前用户在 `subscriptions` 表中 `plan_id = X` 的历史记录（含 EXPIRED/CANCELLED），如果为空则使用 `first_price_cents`，否则 `renewal_price_cents`。前端 `/api/subscription/plans` 接口同时返回该用户当前每个 plan 的「应付价格」字段（`current_price_cents`），UI 显示时直接用，不要前端二次判断。

### 3.6 新表 `orders`

```sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  order_no VARCHAR(32) NOT NULL UNIQUE COMMENT '订单号, 格式 BN + yyyymmdd + 12位随机',
  user_id INT NOT NULL COMMENT '下单用户',
  kind ENUM('RECHARGE','SUBSCRIPTION') NOT NULL COMMENT '订单类型',
  package_id INT NULL COMMENT 'kind=RECHARGE 时引用 recharge_packages.id',
  plan_id INT NULL COMMENT 'kind=SUBSCRIPTION 时引用 subscription_plans.id',
  is_first_subscription TINYINT NOT NULL DEFAULT 0 COMMENT '创单时是否享受首单价 (仅 SUBSCRIPTION 有意义), 用于审计',
  amount_cents INT NOT NULL COMMENT '下单时锁定的金额(分)',
  credits_amount INT NOT NULL COMMENT '下单时锁定的电力数(订阅订单为本期月发放量)',
  status ENUM('PENDING','PAID','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING' COMMENT '订单状态',
  pay_method ENUM('MOCK_ALIPAY','MOCK_WECHAT','ALIPAY','WECHAT') NULL COMMENT '支付方式, MOCK_ 前缀代表 mock 通道',
  mock_qrcode_token VARCHAR(64) NULL COMMENT '一次性 token, 前端持此 token 才能调 mock_pay 接口; PAID 后 NULL',
  paid_at DATETIME NULL COMMENT '支付完成时间',
  cancelled_at DATETIME NULL COMMENT '取消时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES recharge_packages(id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) COMMENT '订单表(充值+订阅)';
```

状态机：`PENDING → PAID`（mock_pay 成功）；`PENDING → CANCELLED`（用户取消 / 后台日清理 24h 超时单）；`PAID → REFUNDED`（管理员退款，MVP 暂不开放）。

### 3.7 新表 `subscriptions`

```sql
CREATE TABLE subscriptions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  user_id INT NOT NULL COMMENT '订阅用户',
  plan_id INT NOT NULL COMMENT '订阅方案',
  order_id BIGINT NOT NULL COMMENT '激活该订阅的订单',
  start_at DATETIME NOT NULL COMMENT '订阅开始时间',
  end_at DATETIME NOT NULL COMMENT '订阅结束时间 (start_at + plan.duration_days)',
  status ENUM('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '订阅状态',
  last_grant_at DATETIME NULL COMMENT '最近一次月度发放时间, 用于幂等判断',
  next_grant_at DATETIME NULL COMMENT '下次预定发放时间',
  grant_count INT NOT NULL DEFAULT 0 COMMENT '已发放月数, 不超过 ceil(duration_days/30)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_user_status (user_id, status),
  INDEX idx_next_grant (next_grant_at, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
) COMMENT '用户订阅记录, 一次成功支付 = 一行 ACTIVE';
```

发放节奏：
- 激活时**立即首次发放** `monthly_credits`，`grant_count=1`，`last_grant_at=now`
- 月度会员 (`duration_days=30`): 只发一次（grant_count 上限 1）
- 季度会员 (`duration_days=90`): 30/60 天后再各发一次，共 3 次
- 年度会员 (`duration_days=365`): 每 30 天发一次，共 12 次
- 简化规则：`next_grant_at = last_grant_at + 30 days`；`grant_count >= ceil(duration_days/30)` 时不再发放，订阅 end_at 到达时 set EXPIRED

### 3.8 新表 `referral_rewards`

```sql
CREATE TABLE referral_rewards (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  inviter_user_id INT NOT NULL COMMENT '邀请人 user_id',
  invitee_user_id INT NOT NULL COMMENT '被邀请人 user_id',
  reward_type ENUM('REGISTER','FIRST_SUBSCRIPTION') NOT NULL COMMENT '奖励触发类型',
  inviter_credits INT NOT NULL COMMENT '本次发给邀请人的电力 (REGISTER=20, FIRST_SUBSCRIPTION=100)',
  invitee_credits INT NOT NULL DEFAULT 0 COMMENT '本次发给被邀请人的电力 (REGISTER=200, FIRST_SUBSCRIPTION=0)',
  trigger_order_id BIGINT NULL COMMENT 'reward_type=FIRST_SUBSCRIPTION 时关联的订阅订单 id',
  status ENUM('PAID') NOT NULL DEFAULT 'PAID' COMMENT '状态, MVP 始终 PAID',
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '到账时间',
  UNIQUE KEY uk_invitee_type (invitee_user_id, reward_type) COMMENT '同一被邀请人每种奖励类型仅触发一次, DB 兜底',
  INDEX idx_inviter (inviter_user_id, paid_at DESC),
  FOREIGN KEY (inviter_user_id) REFERENCES users(id),
  FOREIGN KEY (invitee_user_id) REFERENCES users(id),
  FOREIGN KEY (trigger_order_id) REFERENCES orders(id)
) COMMENT '推荐奖励记录, 注册触发 + 首订阅触发, 每种类型对被邀请人唯一';
```

两段触发逻辑：

| reward_type | 触发时机 | 给邀请人 | 给被邀请人 |
|---|---|---|---|
| REGISTER | 被邀请人成功注册且填写了 invite_code | +20 电力 | +200 电力 |
| FIRST_SUBSCRIPTION | 被邀请人的**任一** SUBSCRIPTION 订单首次 PAID | +100 电力 | 0（被邀请人自己拿到订阅 monthly_credits） |

注：邀请人独享 FIRST_SUBSCRIPTION 加成，被邀请人自己拿订阅的月发放和首单价优惠即可，不重复加。

---

## 4. 后端模块设计

### 4.1 新模块 `backend/app/services/billing/`

```
billing/
├── __init__.py
├── credit_ledger.py        # 余额读写核心 (加电/扣电/退电, 行级锁)
├── pricing.py              # model+duration → credits
├── order_service.py        # 创单 / mock 支付 / 订单查询 / 首单价判断
├── subscription_service.py # 激活订阅 / 月度发放
├── referral_service.py     # 邀请码生成校验 / 两段返点
└── scheduler.py            # apscheduler 注册的定时任务
```

#### `credit_ledger.py`

```python
class InsufficientCreditError(Exception):
    """余额不足, 携带 current/required"""

def get_balance(user_id: int) -> int:
    """返回 users.credits"""

def consume(user_id: int, amount: int, task_id: str, model_name: str, note: str | None = None) -> CreditTransaction:
    """扣电. 余额不足 raise InsufficientCreditError.
       在调用方事务内调用; 内部 SELECT users WHERE id=:uid FOR UPDATE 锁行;
       UPDATE users SET credits = credits - :amount, used_points = used_points + :amount;
       INSERT credit_transactions(type=CONSUME, amount=-amount, balance_after, related_task_id, note)"""

def refund(task_id: str) -> CreditTransaction | None:
    """根据 task_id 找到 CONSUME 行(refunded_at IS NULL),反向加电;
       UPDATE users SET credits = credits + :amount, used_points = used_points - :amount;
       INSERT credit_transactions(type=REFUND, amount=+amount, balance_after, related_task_id);
       UPDATE consume_row SET refunded_at = now()  (幂等)"""

def grant(user_id: int, amount: int, type: str, related_order_id: int = None,
          related_subscription_id: int = None, related_referral_id: int = None,
          note: str | None = None) -> CreditTransaction:
    """加电 (任何来源). type 必须是 RECHARGE/MONTHLY_GRANT/REGISTER_GRANT/
       REGISTER_INVITEE/REGISTER_INVITER/FIRST_SUB_INVITER/ADMIN_ADJUST 之一.
       SELECT users FOR UPDATE; UPDATE users SET credits += :amount; INSERT tx row"""
```

所有 `consume / refund / grant` 均：
- 进入函数即 `SELECT users WHERE id=:uid FOR UPDATE`
- 计算变动后 UPDATE users 余额字段
- INSERT credit_transactions
- 不开新事务（由调用方 `with db.begin():` 包裹）

#### `pricing.py`

```python
def calculate_required_credits(model_name: str, duration_sec: float) -> int:
    """ceil(duration_sec / 60) * rate.
       rate 从 credit_pricing.rate_per_minute 查; 未命中 model_name 则使用 is_default=1 的兜底.
       最小值 1 (防 0 秒视频被白嫖)"""

def preview_for_url(url: str, model_name: str) -> dict:
    """前端 preview 接口入口: 调 downloader.skip_download 拿 duration → calculate_required_credits.
       返回 {duration_sec, required_credits, model_rate, current_balance}"""
```

#### `order_service.py`

```python
def is_first_subscription(user_id: int, plan_id: int) -> bool:
    """查 subscriptions 表 (含 EXPIRED/CANCELLED) 是否存在 (user_id, plan_id) 行"""

def create_recharge_order(user_id: int, package_id: int, pay_method: str) -> Order:
    """事务: SELECT package; 检查 is_active=1;
       生成 order_no + mock_qrcode_token; INSERT orders status=PENDING"""

def create_subscription_order(user_id: int, plan_id: int, pay_method: str) -> Order:
    """事务: SELECT plan; 检查 is_active=1;
       price = first_price_cents if is_first_subscription(user_id, plan_id) else renewal_price_cents;
       生成 order_no; INSERT orders status=PENDING, is_first_subscription=(price 是首单价?)"""

def mock_pay(order_no: str, mock_qrcode_token: str, current_user_id: int) -> Order:
    """单事务执行以下步骤, 任一异常整体回滚:
       1. SELECT order FOR UPDATE; 校验 order.user_id == current_user_id
       2. 校验 order.mock_qrcode_token == :token (一次性)
       3. 校验 order.status == 'PENDING'
       4. UPDATE order: status='PAID', paid_at=now, mock_qrcode_token=NULL
       5. 根据 order.kind 分发:
          - RECHARGE: credit_ledger.grant(user, package.credits, type='RECHARGE', related_order_id)
          - SUBSCRIPTION: subscription_service.activate_subscription_from_order(order)
             (该函数内部会同步 grant monthly_credits)
       6. referral_service.maybe_pay_first_subscription_reward(order)  # 仅 kind=SUBSCRIPTION 起作用
       返回最新 order"""

def get_order(user_id: int, order_no: str) -> Order | None:
    """WHERE user_id=:uid AND order_no=:no, 用户隔离"""

def list_user_orders(user_id: int, page: int, page_size: int) -> tuple[list[Order], int]:
    """分页查订单"""

def cleanup_stale_pending_orders() -> int:
    """日任务: PENDING 且 created_at < now - 24h 的订单, set CANCELLED"""
```

#### `subscription_service.py`

```python
def activate_subscription_from_order(order: Order) -> Subscription:
    """订单 PAID 后由 order_service.mock_pay 同事务调用:
       1. INSERT subscriptions(status='ACTIVE', start_at=now, end_at=now+plan.duration_days,
                               grant_count=0, last_grant_at=NULL, next_grant_at=NULL)
       2. 立即首次发放: credit_ledger.grant(user, monthly_credits, type='MONTHLY_GRANT',
                                            related_subscription_id, related_order_id)
       3. UPDATE subscription: grant_count=1, last_grant_at=now, next_grant_at=now+30d
       4. 终结老订阅(升级语义): UPDATE subscriptions SET status='EXPIRED'
          WHERE user_id=:uid AND status='ACTIVE' AND id!=:new_id
          (即用户已有 ACTIVE 订阅时再买, 旧的立即失效, 已发放电力保留)
       5. 取消同用户其他 PENDING 订阅订单 (避免下面这种刷优惠的攻击:
          创建 2 个 MONTHLY 首单订单 → 先付一个享首单价 → 再付第二个又是首单价):
          UPDATE orders SET status='CANCELLED', cancelled_at=now
          WHERE user_id=:uid AND kind='SUBSCRIPTION' AND status='PENDING' AND id!=:this_order_id
       6. UPDATE users SET active_subscription_id = new_subscription_id
       返回 new subscription"""

def run_monthly_grant_tick() -> dict:
    """定时任务 (每日凌晨跑一次): 找所有 status=ACTIVE 且 next_grant_at<=now 且
       grant_count < ceil(duration_days/30) 的订阅, 逐个发放 monthly_credits;
       更新 grant_count, last_grant_at, next_grant_at += 30d.
       幂等: 单订阅多次发放需检查 grant_count 上限"""

def expire_outdated_subscriptions() -> int:
    """日任务: status=ACTIVE 且 end_at<now → SET EXPIRED;
       同步清 users.active_subscription_id"""
```

#### `referral_service.py`

```python
def generate_referral_code(user_id: int) -> str:
    """生成 6 位 base32 (字母去 0/O/1/I/L), 数据库唯一约束冲突重试 5 次,
       仍冲突 raise; 写入 users.referral_code"""

def bind_referrer_and_pay_register_reward(invitee_user_id: int, invite_code: str | None) -> None:
    """注册流程内调用:
       if not invite_code: return
       事务:
       1. 查 invite_code 对应 inviter = SELECT users WHERE referral_code=:code
          - 不存在 → log warning, 不报错 (用户体验: 错误码也允许注册成功)
          - inviter.id == invitee_user_id → log warning, return (防自邀)
       2. UPDATE users SET referred_by_user_id = inviter.id WHERE id = invitee
       3. INSERT referral_rewards(reward_type='REGISTER', inviter, invitee, +20, +200)
          - DB 唯一约束 (invitee_user_id, reward_type='REGISTER') 兜底重复
       4. credit_ledger.grant(invitee, 200, type='REGISTER_INVITEE', related_referral_id)
       5. credit_ledger.grant(inviter,  20, type='REGISTER_INVITER', related_referral_id)"""

def maybe_pay_first_subscription_reward(order: Order) -> ReferralReward | None:
    """订单 PAID 后调用, 仅 order.kind=SUBSCRIPTION 触发:
       1. 查 invitee = order.user; if not invitee.referred_by_user_id: return None
       2. 查 inviter = invitee.referred_by_user_id
       3. 检查 referral_rewards 是否已有 (invitee, FIRST_SUBSCRIPTION) 行, 有则 return (幂等)
       4. 事务:
          INSERT referral_rewards(reward_type='FIRST_SUBSCRIPTION', inviter, invitee, +100, +0, trigger_order_id)
          credit_ledger.grant(inviter, 100, type='FIRST_SUB_INVITER', related_referral_id, related_order_id)"""

def get_referral_stats(user_id: int) -> dict:
    """返回 {invited_count, total_rewards_credits, referral_code, share_url}.
       invited_count = COUNT referrals WHERE inviter_user_id=:uid (DISTINCT invitee).
       total_rewards = SUM tx.amount WHERE user_id=:uid AND type IN (REGISTER_INVITER, FIRST_SUB_INVITER)"""

def list_invited_users(user_id: int, page: int, page_size: int) -> tuple[list, int]:
    """分页查邀请记录: invitee 信息 + 是否完成首订阅 + 累计返点"""
```

#### `scheduler.py`

```python
def register_jobs(app):
    """在 lifespan 注册 (apscheduler BackgroundScheduler):
       - 每天 02:00 → subscription_service.run_monthly_grant_tick()
       - 每天 02:05 → subscription_service.expire_outdated_subscriptions()
       - 每天 02:10 → order_service.cleanup_stale_pending_orders()
       MVP 单进程内存, 不依赖 redis/celery"""
```

### 4.2 新 Routers

文件：`backend/app/routers/billing.py`、`backend/app/routers/order.py`、`backend/app/routers/referral.py`

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/api/credit/balance` | 当前余额 + 累计消耗 + 当前订阅 | 是 |
| POST | `/api/credit/pricing/preview` | `{url, model_name}` → 预计消耗 | 是 |
| GET | `/api/recharge/packages` | 充值套餐列表 | 是 |
| GET | `/api/subscription/plans` | 会员方案列表（含当前用户应付价 `current_price_cents`） | 是 |
| POST | `/api/order/recharge` | `{package_id, pay_method}` → 创充值订单 | 是 |
| POST | `/api/order/subscription` | `{plan_id, pay_method}` → 创订阅订单 | 是 |
| POST | `/api/order/mock_pay` | `{order_no, mock_qrcode_token}` → 模拟付款 | 是 |
| GET | `/api/order/{order_no}` | 查订单详情（前端支付页轮询用） | 是 |
| GET | `/api/billing/transactions` | 分页查电力流水 | 是 |
| GET | `/api/billing/orders` | 分页查订单 | 是 |
| GET | `/api/referral/me` | 推荐码 + 累计返点 + 邀请人数 | 是 |
| GET | `/api/referral/rewards` | 分页查返点流水 | 是 |
| GET | `/api/referral/invited` | 分页查邀请记录 | 是 |

### 4.3 改造现有接口

#### `/api/auth/register`（`backend/app/routers/auth.py`）

入参 `RegisterRequest` 增加可选字段 `invite_code: Optional[str]`。注册成功创建 User 之后**在同一事务中**：
1. `referral_service.generate_referral_code(new_user.id)` 写入自己的 referral_code
2. `credit_ledger.grant(new_user.id, 100, type='REGISTER_GRANT', note='新用户注册赠送')`
   — 即原 `users.credits=100` 默认值，改为统一通过 ledger 入账，保证审计可追溯
3. 若 `invite_code` 非空，调 `referral_service.bind_referrer_and_pay_register_reward(new_user.id, invite_code)`

注：步骤 2 中将 `users.credits` 默认值改为 0，由 ledger 函数补 100。这样新老用户都有审计流水入口。

#### `/api/generate_note`（`backend/app/routers/note.py`）

在现有 line 250 `_update_status(PENDING)` 之前插入：

```python
# 1. 同步获取视频时长 (只取 metadata, 不下载音频):
downloader = get_downloader_for_url(data.video_url)
preview_meta = downloader.download(data.video_url, skip_download=True)
duration_sec = preview_meta.duration

# 2. 计算所需电力:
required = pricing.calculate_required_credits(data.model_name, duration_sec)

# 3. 事务内扣费 + 写流水 + 落 video_task:
with db.begin():
    consume_tx = credit_ledger.consume(
        user_id=current_user.id,
        amount=required,
        task_id=task_id,
        model_name=data.model_name,
        note=f"生成笔记: {data.video_url[:64]}"
    )
    insert_video_task(..., credits_used=required)
```

`credit_ledger.consume` 余额不足 → raise `InsufficientCreditError` → FastAPI 全局 handler 返 402 + JSON `{current_balance, required_credits}`（前端跳「去充值」）。

`duration_sec` 后端独立调取，**前端不能伪造时长绕过扣费**。downloader 失败（无效 URL）返 400，不扣费。

#### `NoteGenerator._update_status`（`backend/app/services/note.py`）

在 FAILED 分支调用：

```python
if status == TaskStatus.FAILED:
    try:
        billing.credit_ledger.refund(task_id=task_id)
    except Exception:
        logger.exception("退费失败, task_id=%s", task_id)
        # 不阻塞主流程, 写 warning 触发人工巡检
```

`refund` 内部用 `refunded_at IS NULL` 防重放，可安全多次调用。

---

## 5. 前端设计

### 5.1 路由 + 侧栏

`BillNote_frontend/src/App.tsx` 新增三个 Route：
- `/upgrade` → `UpgradePage`（蓝色主题）
- `/billing` → `BillingPage`（teal 主题）
- `/referral` → `ReferralPage`（teal 主题）

`BillNote_frontend/src/pages/Index.tsx` 的 `NAV_ITEMS` 数组新增：
- 升级 Pro（icon: `Zap`，路径 `/upgrade`）
- 账单与额度（icon: `ReceiptText`，路径 `/billing`）
- 我的推荐码（icon: `Gift`，路径 `/referral`）

侧栏底部用户卡片：从 `userStore` 拉 `users.credits` 实时显示（与 `/api/credit/balance` 对接）。

### 5.2 视觉主题

**`/upgrade` 页面专属配色**（覆盖 CSS 变量到一个 `.theme-pro` scope 内）：
- 主色 `#2563eb`（blue-600）+ 渐变 `linear-gradient(135deg, #1d4ed8, #3b82f6)`
- 卡片选中态：`border-blue-500 shadow-blue-500/20`
- 「最受欢迎」徽章：橘色 `#f97316`（与截图一致）
- 顶部「BILINOTE PRO」品牌字使用 blue gradient text

**`/billing` `/referral` 与其他页面**：完全沿用现有 teal `#167a6e` 主题，与 ProfilePage 视觉一致。

**推荐码页橙色点缀**：右侧「奖励规则」卡片的「Pro 邀请加成 +100 电力」字段用橙色 `#f97316` 高亮，与截图一致；其他元素仍 teal。

实现方式：`<div className="theme-pro">` 包裹 UpgradePage 内容，配套 CSS：

```css
.theme-pro {
  --primary: #2563eb;
  --primary-foreground: #ffffff;
  --ring: #1d4ed8;
}
.theme-pro .gradient-cta {
  background: linear-gradient(135deg, #1d4ed8, #3b82f6);
}
```

### 5.3 新页面

#### `pages/UpgradePage/index.tsx`

布局严格对齐图一~图五：

- 顶部居中 brand chip：`BILINOTE PRO`（蓝色渐变）
- 标题：选择适合您的方案
- 副标题：全平台视频转笔记 · 支持 GPT-4o / Claude / Gemini · 一键导出 PDF / Word / 图片 / PPT
- 右上角促销 chip（条件渲染，当前用户未消费过任何 SUBSCRIPTION）：`🎉 新人首单 · 年度会员首期立省 ¥31`
- Tabs：`电力充值` / `会员订阅`（默认选中后者，对齐截图）

**电力充值 Tab**（图一图二）：
- 3 列卡片 grid。每张卡片：图标⚡ + credits 数字 + 套餐名 + 单价文案 + 描述 + 「∞ 电力永久有效」+ CTA「立即购买 ¥X.X」
- 中间卡片：蓝色边框 + 「最受欢迎」橘色 ribbon
- 点击 CTA → 调 `/api/order/recharge` → 打开 `PayDialog`

**会员订阅 Tab**（图三图四图五）：
- 3 列方案卡片。每张：
  - 顶部 badge（如年度的「推荐 · 立省 17%」橘色）
  - 原价（line-through）→ 首单价（如「¥9.9/月」）
  - 新人首单 chip + 续费价文字（如「续费 ¥19.9/月」）
  - ⚡ 月发数 + 描述
  - 「按时长阶梯计费」（小字说明）
  - 权益列表（4-5 条）
  - CTA「立即订阅 ¥X」
  - 「开通即得 N 电力」副文案
- **底部「会员独享」区块**（图四，3 列 × 3 行 grid 共 9 项）：更强模型 / 更高效率 / 多格式导出 / 优先生成 / 批量转笔记 / 合集融合 / 合集分享+ZIP / 电力永久有效 / 专属服务

**底部 FAQ**（图二，双列 6 题）：
- 一篇笔记消耗多少电力？— 按视频时长 × 模型档位扣电（典型：30 分钟 GPT-4o ≈ 150 电力）
- 为什么开「视频理解」更贵？— 视频理解模型按图像帧调用，单价更高
- 为什么长视频贵这么多？— 长视频转录 + 总结都按分钟数线性增长
- 可以上传超过 6 小时的视频吗？— 支持，但建议分段以提升稳定性
- 电力会过期吗？— **不会。充值或订阅获得的电力永久有效，不设过期时间。**
- 订阅和充值有什么区别？— 充值一次性买电力；订阅每月固定发放
- 支付失败怎么办？— 重新下单或联系客服
- 可以退款吗？— **电力到账后不支持退款**

**底部 banner**：所有支付通过支付宝官方渠道处理，不存储您的支付信息。电力到账后不支持退款，请按需购买。

> 截图里所有「积分」文案，UI 实现时全部替换为「电力」+ ⚡ 图标。

#### `pages/UpgradePage/PayDialog.tsx`

打开时已传入 `order_no, mock_qrcode_token, amount_cents`。渲染：
- 顶部金额大字（如「¥29.00」）
- 支付方式 tab：支付宝（蓝色） / 微信支付（绿色）— 视觉切换，都走 mock
- 中间二维码图（用 `qrcode.react` 生成，内容 `bilinote-mock://order/{order_no}`，hover 显示「测试模式 · 点击模拟支付」）
- 「我已支付」按钮 → POST `/api/order/mock_pay` → 成功 toast「支付成功，电力已到账」+ 关闭 + 刷新余额 + 刷新订阅状态
- 「取消订单」按钮 → 关闭 dialog（订单保持 PENDING，24h 后定时任务清理）
- 边距、圆角、按钮位置参考 shadcn Dialog 默认样式

#### `pages/BillingPage/index.tsx`（自由设计，teal 风格）

参考 ProfilePage 视觉语言：
- **顶部余额卡片**：teal 渐变背景，左侧大字显示当前电力余额 ⚡N，右侧两个 CTA「去充值」「升级会员」
- **当前订阅 chip**（如「年度会员 · 还剩 287 天」）
- Tabs：`电力流水` / `订单记录`
  - 流水 tab：表格列 `时间 / 类型(badge) / 变动(±N⚡) / 余额 / 备注`
  - 订单 tab：表格列 `订单号 / 时间 / 类型 / 金额 / 状态(badge) / 操作`（PENDING 订单可「重新支付」打开 PayDialog）
- 分页：每页 20 条，自行实现 pagination（参考 `FeedbackPage` 已有的）
- 表格使用自定义 `<DataTable />`（项目 shadcn 没有 table 原语，新加 `components/ui/data-table.tsx`）

#### `pages/ReferralPage/index.tsx`

布局严格对齐图六：

- 顶部标题：我的推荐码
- 副标题：复制邀请链接发给朋友，好友注册后双方都会获得电力奖励。
- **主区域两栏**（左侧 2/3 + 右侧 1/3）：
  - 左侧主卡片（teal 渐变背景）：
    - 顶部「专属邀请」橘色 ribbon + 复制按钮
    - 「分享 BiliNote Pro，一起获得更多 AI Credits」大标题
    - 副文：好友通过你的链接注册后，**好友获得 200 电力**，**你获得 20 电力返利**。
    - 邀请码大字 monospace 显示：`BNREF-XXXXXX`
    - 邀请链接 readonly input + 复制按钮（`https://bilinote.app/register?invite=XXXXXX`）
    - 提示「微信、朋友圈、微博、社群都可以直接发送这个链接。」
    - 底部统计：N 人 已邀请 · M 电力 累计获得
  - 右侧「奖励规则」卡片：
    - 好友注册获得：⚡200
    - 普通注册奖励：⚡100
    - **Pro 邀请加成**：⚡+100（橙色高亮）
    - 你的返利：⚡20/人
- **下方两栏**：
  - 左侧：邀请记录列表（表格：`被推荐人脱敏 / 我的返利 / 注册时间 / 是否首订阅`），分页
  - 右侧：分享建议（3 条小字 tips）：
    1. 优先复制邀请链接，好友点开后会自动带上邀请码。
    2. 可以附上一句说明：注册即可多拿 100 电力。
    3. 邀请记录按注册时间更新，复制链接不会消耗次数。

#### `pages/AuthPage/index.tsx`（改造）

注册 Tab 表单加可选「邀请码」字段。URL queryparam `?invite=XXXXXX` 自动填充并 readonly（手动改的话允许，但默认锁定）。

### 5.4 改造 `pages/HomePage/components/NoteForm.tsx`

- 用户填 URL + 选模型后，前端 debounce 350ms 调 `/api/credit/pricing/preview`，按钮上显示「⚡预计消耗 N 电力」
- 余额 < N 时按钮变灰 + inline 提示「余额不足」+ 二级 CTA「去充值」（跳 `/upgrade`）
- 提交时 400/402 弹 toast 引导充值

### 5.5 术语统一

**全局 UI 用「电力」替代「积分」**：
- 截图里所有「积分」文字 → 实现时改写为「电力」
- 卡片、对话框、流水、提示、FAQ 全部统一
- 数字旁边永远配 ⚡ icon（lucide `Zap`，金色 `#f59e0b`）
- 邀请链接 share message 也写「电力」

---

## 6. 数据库迁移策略

新表的 DDL 落 `backend/sql/billing_init.sql`（一次性可执行，含建表 + seed），生产环境 DBA 用此文件。

`users` 表改造分两阶段：

**阶段 1（不停服可上线）** — `backend/app/db/migrations/billing_2026_06_30_phase1.py`：
1. `ALTER TABLE users ADD COLUMN credits INT NOT NULL DEFAULT 0 COMMENT '当前电力余额, 永不过期'`
2. `ALTER TABLE users ADD COLUMN referral_code VARCHAR(16) NULL`
3. `ALTER TABLE users ADD COLUMN referred_by_user_id INT NULL`
4. `ALTER TABLE users ADD COLUMN active_subscription_id BIGINT NULL`
5. `UPDATE users SET credits = total_points`（数据复制，老用户 100 → 100）
6. 给所有现有用户生成 referral_code（Python 循环，唯一性冲突重试）
7. 给所有现有用户写一条 `credit_transactions(type='REGISTER_GRANT', amount=100, balance_after=100, note='历史用户初始电力')` 流水（审计补全）
8. `ALTER TABLE users ADD UNIQUE INDEX idx_referral_code (referral_code)`
9. 该阶段后，应用代码读写 `credits`；`total_points` 字段保留双写期。

**阶段 2（稳定 1 周后清理）** — `phase2.py`：
- 检查 `/api/profile`、`/api/tasks`、ProfilePage 已迁移完成
- `ALTER TABLE users DROP COLUMN total_points`
- 同步 `models/users.py` 删除该列定义

`init_db.py` 同步：将所有新模型 import 进去；新部署环境 `Base.metadata.create_all` 一次性建好。

迁移前置：`mysqldump bilinote users > backup_users_2026_06_30.sql`（人工执行）。

---

## 7. 安全 / 财务红线

| 风险 | 防护机制 |
|---|---|
| 并发扣费 / 双扣 | 所有写操作进入 `credit_ledger` 即 `SELECT users FOR UPDATE`，事务内完成 |
| Mock 支付伪造 | 客户端调 mock_pay 必须传后端首次返回的 `mock_qrcode_token`；token 一次性，订单 PAID 后清空；同时校验 `order.user_id == current_user.id` |
| 订单重复支付 | mock_pay 内 `if order.status != 'PENDING': raise`；事务内行锁防 race |
| 首单价被刷 | `is_first_subscription(user_id, plan_id)` 查 subscriptions 历史（含所有状态），存在即非首单；且 `activate_subscription_from_order` 步骤 5 会取消同用户其他 PENDING 订阅订单，防"多开订单连付首单价"攻击 |
| 订阅升级覆盖语义 | 同一用户同时只能有一个 ACTIVE 订阅；新订阅激活时旧订阅 set EXPIRED（已发放电力不清退）；前端在切换订阅 plan 时需明确提示「升级 / 切换会立即结束当前订阅剩余周期」 |
| 推荐返点被刷 | `referral_rewards (invitee_user_id, reward_type) UNIQUE`；应用层先 SELECT 后 INSERT，DB 兜底；自邀（A 注册填 A 的码）应用层拦截 |
| 注册赠送被刷 | 注册流程 `bind_referrer_and_pay_register_reward` 完全在注册事务内；DB 唯一约束防同一 invitee 拿两次注册返点 |
| 月度发放重发 / 漏发 | `subscriptions.grant_count` + `last_grant_at` 双重幂等；定时任务异常重试只跑 `next_grant_at<=now AND grant_count<上限` 的订阅 |
| 任务失败漏退款 | `_update_status(FAILED)` 是唯一退款入口；CONSUME 行 `refunded_at` 防重放；退款失败仍写 warning 日志触发人工巡检 |
| 用户隔离失守 | 所有 DAO 函数签名首参强制 `user_id`，WHERE 强制；新增装饰器 `@with_user_isolation` 防漏写 |
| 老数据迁移 | 阶段 1 双写 + 7 天观察期 → 阶段 2 删旧列；前置 `mysqldump` 备份 |
| 提现 / 法币提款攻击面 | 本系统**只入不出**：电力不可兑回法币，不可转赠给其他账户。彻底规避 PCI-DSS / 反洗钱合规面 |

测试要求（`backend/tests/billing/`）：
- `test_consume_insufficient.py` — 余额不足拒绝
- `test_consume_concurrent.py` — 并发 10 个请求只有一个 succeed，其他 raise InsufficientCredit
- `test_refund_idempotent.py` — 退费两次只生效一次
- `test_first_subscription_pricing.py` — 同一 plan 第二次买走续费价
- `test_register_referral_reward.py` — 注册返点幂等 + 自邀拦截 + 错误邀请码不阻塞注册
- `test_first_subscription_referral.py` — 邀请人在被邀请人首订阅时拿 100，第二次订阅不再拿
- `test_monthly_grant_idempotent.py` — 月度发放函数跑两次结果一致；grant_count 上限生效
- `test_pricing_calc.py` — 边界（0 秒 / 1.1 分钟 / 未知模型 → 兜底）
- `test_user_isolation.py` — 用 A 的 token 访问 B 的订单返 403/404

---

## 8. Scope 边界（明确不做的）

- **真实支付接入**：结构预留但本期不接入支付宝/微信
- **后台管理界面**：充值套餐、会员方案、模型计费率全靠 SQL 改值；不开发 admin UI
- **退款（管理员主动）**：MVP 不开放，订单状态机预留
- **企业账户 / 团队共享余额**：单用户隔离
- **国际化 / 多币种**：仅 RMB（cents 整数）
- **i18n**：本期仍是硬编码中文（与现有页面风格一致）
- **充值小程序 / 移动端**：仅 web + tauri 桌面端
- **「会员独享」高级功能**（多格式导出、批量转笔记、合集融合等）：UI 上显示作为营销点，但**功能本期不实现**，需要单独 spec
- **Pro/Pro+ 等级体系**：本期会员按时长分档（月/季/年），没有 tier 概念
- **使用次数限制 / 并发任务数限制**：会员页面 UI 写「同时处理 3 个并发任务」，但本期任务队列不强制此限制

---

## 9. 验收清单

- [ ] 老用户登录后能看到 100 credits + referral_code 已生成 + `credit_transactions` 表有「历史用户初始电力」流水
- [ ] 新注册用户默认 100 credits（通过 ledger 入账）
- [ ] 注册时填邀请码 → 自动落 referred_by_user_id + 邀请人 +20 + 被邀请人 +200（额外，叠加 100 注册赠送 = 300）
- [ ] 视频生成前能预览电力消耗；提交后扣费写流水；任务失败自动退费
- [ ] 充值 ¥29 标准包 → credits +350
- [ ] 订阅月度会员 ¥9.9 首单 → 当即 +1000 credits，subscription end_at = +30d
- [ ] 同用户再买月度 → 价格 ¥19.9（续费价）
- [ ] 被邀请人首订阅成功 → 邀请人额外 +100（FIRST_SUB_INVITER 流水）
- [ ] 被邀请人第二次订阅 → 邀请人不再加成
- [ ] 季度会员订阅 → 立即 +800，30 天后定时任务发第二期 +800，60 天后第三期 +800
- [ ] 账单页能看到所有流水和订单；推荐码页能看到累计返点 + 邀请记录
- [ ] 升级 Pro 页是蓝色主题；账单、推荐码页是 teal 主题
- [ ] UI 所有「积分」字眼都被替换为「电力」
- [ ] 单元测试覆盖所有「财务红线」表中场景，CI 全绿
- [ ] 用户 A 无法访问用户 B 的订单 / 流水 / 返点 / 余额

---

## 10. 已知待办（仅 §5.3 BillingPage / PayDialog 的精细 UI 留作开发期间用 design-taste-frontend 技能补图）

无截图的两个区域，按本 spec §5.3 描述自由设计：
- BillingPage 顶部余额卡片 + Tabs + 表格
- PayDialog 二维码弹窗（金额、二维码、支付方式 tabs、CTA 按钮）

实现阶段以 `design-taste-frontend` 技能产出最终视觉。
