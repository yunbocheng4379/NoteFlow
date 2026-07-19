-- ============================================================================
-- 电力 (Credit) 计费与会员订阅系统 - 初始化 SQL
-- ============================================================================
-- 目标库: noteflow (MySQL 8.x)
-- 引擎: InnoDB (支持行级锁 + 事务)
-- 编码: utf8mb4
--
-- 执行顺序:
--   1) 先跑 users 表 ALTER (一次性, 升级现有 users 表)
--   2) 再跑各新表 CREATE
--   3) 最后跑 Seed 数据
--
-- 重要:
--   * 所有金额相关表的字段必有 COMMENT, 便于 DBA 审阅与回溯
--   * 执行时必须传 --default-character-set=utf8mb4, 否则中文 COMMENT / seed
--     会被 CLI 默认字符集当作 latin1 解读, 存进 DB 后双重编码乱码.
--     推荐命令: mysql --default-character-set=utf8mb4 -u<user> -p<db> < billing_init.sql
--     或用 MySQL Workbench 等 GUI 客户端确保 utf8mb4 连接.
--   * 脚本内部同时 SET NAMES utf8mb4 强制会话字符集, 作为双重保险.
-- ============================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ----------------------------------------------------------------------------
-- 1) users 表升级 (新增电力 / 推荐码 / 订阅相关字段)
-- ----------------------------------------------------------------------------
-- 新增 credits 字段作为当前电力余额 (永不过期), 默认 0 (新用户由注册逻辑通过 ledger 入账 100)
ALTER TABLE users
  ADD COLUMN credits INT NOT NULL DEFAULT 0
    COMMENT '当前电力余额 (永不过期). 充值/会员/推荐/退费均累加, 生成笔记时扣减';

-- 邀请码 (6 位 base32, 注册时生成, 全局唯一)
ALTER TABLE users
  ADD COLUMN referral_code VARCHAR(16) NULL
    COMMENT '用户专属邀请码 (6 位 base32 大写, 全局唯一). 注册时生成, 不可修改';

-- 邀请人 (注册时填写他人邀请码后绑定, 不可修改)
ALTER TABLE users
  ADD COLUMN referred_by_user_id INT NULL
    COMMENT '邀请人 user_id. 注册时填写邀请码后绑定, 不可修改; 用于推荐返点查询';

-- 当前生效订阅 ID
ALTER TABLE users
  ADD COLUMN active_subscription_id BIGINT NULL
    COMMENT '当前生效会员订阅 ID. NULL = 免费用户; 引用 subscriptions(id)';

-- 邀请码全局唯一索引
ALTER TABLE users
  ADD UNIQUE INDEX uk_users_referral_code (referral_code);

-- 外键: referred_by_user_id -> users(id) (NULL 允许; 不级联删除, 避免邀请人注销导致历史链断裂)
ALTER TABLE users
  ADD CONSTRAINT fk_users_referred_by FOREIGN KEY (referred_by_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 注: total_points / used_points 字段保留 (双写期), 待 phase2 删除
--     total_points 通过 migration 脚本回填到 credits

-- ----------------------------------------------------------------------------
-- 2) 模型计费率配置表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_pricing (
    id              INT PRIMARY KEY AUTO_INCREMENT      COMMENT '主键',
    model_name      VARCHAR(128) NOT NULL UNIQUE        COMMENT '模型名称, 与 VideoTask.model_name 一致; __default__ 为兜底',
    rate_per_minute INT NOT NULL                        COMMENT '每分钟消耗电力数 (整数)',
    is_active       TINYINT NOT NULL DEFAULT 1          COMMENT '是否启用: 1=启用, 0=停用',
    is_default      TINYINT NOT NULL DEFAULT 0          COMMENT '是否兜底: 1=未匹配 model_name 时使用 (应用层保证全表至多一条)',
    description     VARCHAR(255) NULL                   COMMENT '描述, 展示用',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                                   COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP       COMMENT '更新时间',
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型计费率配置表 (按分钟单价)';

-- ----------------------------------------------------------------------------
-- 3) 电力流水 / 账本 (核心审计表, 永久保留, 只 INSERT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_transactions (
    id                       BIGINT PRIMARY KEY AUTO_INCREMENT                              COMMENT '流水主键',
    user_id                  INT NOT NULL                                                   COMMENT '用户 ID, 即被记账的用户',
    type                     ENUM(
                                'RECHARGE',           -- 充值到账
                                'CONSUME',            -- 生成笔记消耗
                                'REFUND',             -- 笔记失败退费
                                'MONTHLY_GRANT',      -- 会员月度发放
                                'REGISTER_GRANT',     -- 新用户注册赠送 100
                                'REGISTER_INVITEE',   -- 被邀请人注册奖励 200
                                'REGISTER_INVITER',   -- 邀请人注册奖励 20
                                'FIRST_SUB_INVITER',  -- 邀请人在被邀请人首订阅时奖励 100
                                'ADMIN_ADJUST'        -- 管理员手动调整
                             ) NOT NULL                                                     COMMENT '流水类型',
    amount                   INT NOT NULL                                                   COMMENT '变动量, 正=加电, 负=扣电',
    balance_after            INT NOT NULL                                                   COMMENT '本次操作后 users.credits 余额 (审计快照)',
    related_task_id          VARCHAR(64) NULL                                               COMMENT '关联 video_tasks.task_id (CONSUME/REFUND 必填)',
    related_order_id         BIGINT NULL                                                    COMMENT '关联 orders.id (RECHARGE/MONTHLY_GRANT/FIRST_SUB_INVITER)',
    related_subscription_id  BIGINT NULL                                                    COMMENT '关联 subscriptions.id (MONTHLY_GRANT)',
    related_referral_id      BIGINT NULL                                                    COMMENT '关联 referral_rewards.id (REGISTER_INVITEE/INVITER, FIRST_SUB_INVITER)',
    refunded_at              DATETIME NULL                                                  COMMENT '仅 type=CONSUME 行使用: 被退费时间; NULL=未退费, 用于防重放',
    note                     VARCHAR(255) NULL                                              COMMENT '备注文本',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                    COMMENT '创建时间',
    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_user_type    (user_id, type),
    INDEX idx_task         (related_task_id),
    INDEX idx_order        (related_order_id),
    CONSTRAINT fk_ct_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='电力流水/账本 (永久保留, 仅 INSERT, refunded_at 例外)';

-- ----------------------------------------------------------------------------
-- 4) 充值套餐表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recharge_packages (
    id               INT PRIMARY KEY AUTO_INCREMENT                                        COMMENT '主键',
    code             VARCHAR(32) NOT NULL UNIQUE                                           COMMENT '套餐编码, 程序内引用, 如 PKG_BASIC',
    name             VARCHAR(64) NOT NULL                                                  COMMENT '展示名称, 如 "入门包"',
    price_cents      INT NOT NULL                                                          COMMENT '价格 (分), 1 元 = 100 分',
    credits          INT NOT NULL                                                          COMMENT '充值获得的电力数',
    unit_price_text  VARCHAR(32) NULL                                                      COMMENT '展示用单价文案, 如 "¥0.099/电力"',
    sort_order       INT NOT NULL DEFAULT 0                                                COMMENT '展示排序 (升序)',
    badge            VARCHAR(32) NULL                                                      COMMENT '徽章文案, 如 "最受欢迎"',
    is_active        TINYINT NOT NULL DEFAULT 1                                            COMMENT '是否上架: 1/0',
    description      VARCHAR(255) NULL                                                     COMMENT '描述, 如 "≈5 篇 30 分钟视频"',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                           COMMENT '创建时间',
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='充值套餐定义表';

-- ----------------------------------------------------------------------------
-- 5) 会员订阅方案表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
    id                    INT PRIMARY KEY AUTO_INCREMENT                                        COMMENT '主键',
    code                  VARCHAR(32) NOT NULL UNIQUE                                           COMMENT '方案编码, 如 SUB_MONTHLY',
    name                  VARCHAR(64) NOT NULL                                                  COMMENT '展示名称, 如 "月度会员"',
    duration_days         INT NOT NULL                                                          COMMENT '订阅时长 (天), 30/90/365',
    monthly_credits       INT NOT NULL                                                          COMMENT '每月发放电力数',
    first_price_cents     INT NOT NULL                                                          COMMENT '首单价 (分), 用户首次订阅此 plan 适用',
    renewal_price_cents   INT NOT NULL                                                          COMMENT '续费价 (分), 用户再次订阅此 plan 适用',
    original_price_cents  INT NULL                                                              COMMENT '展示用原价 (分), 用于划线显示',
    sort_order            INT NOT NULL DEFAULT 0                                                COMMENT '展示排序',
    badge                 VARCHAR(32) NULL                                                      COMMENT '徽章文案, 如 "推荐 · 立省 17%"',
    is_active             TINYINT NOT NULL DEFAULT 1                                            COMMENT '是否上架: 1/0',
    description           TEXT NULL                                                             COMMENT '权益描述, 支持 markdown 或 JSON 列表',
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                           COMMENT '创建时间',
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员订阅方案表 (按订阅时长分档)';

-- ----------------------------------------------------------------------------
-- 6) 订单表 (充值 + 订阅)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                     BIGINT PRIMARY KEY AUTO_INCREMENT                              COMMENT '主键',
    order_no               VARCHAR(32) NOT NULL UNIQUE                                    COMMENT '订单号, BN + yyyymmdd + 12位随机',
    user_id                INT NOT NULL                                                   COMMENT '下单用户 ID',
    kind                   ENUM('RECHARGE','SUBSCRIPTION') NOT NULL                       COMMENT '订单类型: RECHARGE=充值, SUBSCRIPTION=订阅',
    package_id             INT NULL                                                       COMMENT 'kind=RECHARGE 时引用 recharge_packages.id',
    plan_id                INT NULL                                                       COMMENT 'kind=SUBSCRIPTION 时引用 subscription_plans.id',
    is_first_subscription  TINYINT NOT NULL DEFAULT 0                                     COMMENT '创单时是否享受首单价 (仅 SUBSCRIPTION 有意义)',
    amount_cents           INT NOT NULL                                                   COMMENT '下单时锁定的金额 (分)',
    credits_amount         INT NOT NULL                                                   COMMENT '下单时锁定的电力数 (订阅订单为本期月发放量)',
    status                 ENUM('PENDING','PAID','CANCELLED','REFUNDED')
                                                NOT NULL DEFAULT 'PENDING'                COMMENT '订单状态',
    pay_method             ENUM('MOCK_ALIPAY','MOCK_WECHAT','ALIPAY','WECHAT') NULL       COMMENT '支付方式: MOCK_ 前缀=mock 通道',
    mock_qrcode_token      VARCHAR(64) NULL                                               COMMENT '一次性二维码 token; PAID 后清空',
    paid_at                DATETIME NULL                                                  COMMENT '支付完成时间',
    cancelled_at           DATETIME NULL                                                  COMMENT '取消时间',
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                    COMMENT '创建时间',
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_status       (status),
    CONSTRAINT fk_orders_user    FOREIGN KEY (user_id)    REFERENCES users (id)              ON DELETE CASCADE,
    CONSTRAINT fk_orders_package FOREIGN KEY (package_id) REFERENCES recharge_packages (id),
    CONSTRAINT fk_orders_plan    FOREIGN KEY (plan_id)    REFERENCES subscription_plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表 (充值 + 订阅)';

-- ----------------------------------------------------------------------------
-- 7) 用户订阅记录 (一次成功支付 = 一行 ACTIVE)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT                                     COMMENT '主键',
    user_id         INT NOT NULL                                                          COMMENT '订阅用户 ID',
    plan_id         INT NOT NULL                                                          COMMENT '订阅方案 ID',
    order_id        BIGINT NOT NULL                                                       COMMENT '激活该订阅的订单 ID',
    start_at        DATETIME NOT NULL                                                     COMMENT '订阅开始时间',
    end_at          DATETIME NOT NULL                                                     COMMENT '订阅结束时间 (start_at + plan.duration_days)',
    status          ENUM('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE'        COMMENT '订阅状态',
    last_grant_at   DATETIME NULL                                                         COMMENT '最近一次月度发放时间',
    next_grant_at   DATETIME NULL                                                         COMMENT '下次预定发放时间',
    grant_count     INT NOT NULL DEFAULT 0                                                COMMENT '已发放次数, 不超过 ceil(duration_days/30)',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                           COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_status  (user_id, status),
    INDEX idx_next_grant   (next_grant_at, status),
    CONSTRAINT fk_subs_user  FOREIGN KEY (user_id)  REFERENCES users (id)              ON DELETE CASCADE,
    CONSTRAINT fk_subs_plan  FOREIGN KEY (plan_id)  REFERENCES subscription_plans (id),
    CONSTRAINT fk_subs_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户订阅记录表';

-- ----------------------------------------------------------------------------
-- 8) 推荐返点记录 (两段触发: REGISTER / FIRST_SUBSCRIPTION)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_rewards (
    id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY                             COMMENT '主键',
    inviter_user_id   INT NOT NULL                                                        COMMENT '邀请人 user_id',
    invitee_user_id   INT NOT NULL                                                        COMMENT '被邀请人 user_id',
    reward_type       ENUM('REGISTER','FIRST_SUBSCRIPTION') NOT NULL                      COMMENT '奖励类型: REGISTER=注册触发, FIRST_SUBSCRIPTION=首订阅触发',
    inviter_credits   INT NOT NULL                                                        COMMENT '本次发给邀请人的电力 (REGISTER=20, FIRST_SUBSCRIPTION=100)',
    invitee_credits   INT NOT NULL DEFAULT 0                                              COMMENT '本次发给被邀请人的电力 (REGISTER=200, FIRST_SUBSCRIPTION=0)',
    trigger_order_id  BIGINT NULL                                                         COMMENT 'reward_type=FIRST_SUBSCRIPTION 时关联的订阅订单 ID',
    status            ENUM('PAID') NOT NULL DEFAULT 'PAID'                                COMMENT '状态, MVP 始终 PAID (预留扩展)',
    paid_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP                         COMMENT '到账时间',
    UNIQUE KEY uk_invitee_type (invitee_user_id, reward_type)                             /* 同一 invitee 每种奖励类型仅一次, DB 兜底防刷 */,
    INDEX idx_inviter (inviter_user_id, paid_at DESC),
    CONSTRAINT fk_ref_inviter FOREIGN KEY (inviter_user_id) REFERENCES users  (id),
    CONSTRAINT fk_ref_invitee FOREIGN KEY (invitee_user_id) REFERENCES users  (id),
    CONSTRAINT fk_ref_order   FOREIGN KEY (trigger_order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推荐奖励记录表 (注册触发 + 首订阅触发, 同 invitee 同类型唯一)';

-- ----------------------------------------------------------------------------
-- 9) users.active_subscription_id 外键 (subscriptions 表创建后再补)
-- ----------------------------------------------------------------------------
ALTER TABLE users
  ADD CONSTRAINT fk_users_active_subscription FOREIGN KEY (active_subscription_id)
    REFERENCES subscriptions (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Seed 数据
-- ============================================================================

-- 模型计费率
INSERT INTO credit_pricing (model_name, rate_per_minute, is_active, is_default, description) VALUES
  ('gpt-4o',          5,  1, 0, 'OpenAI GPT-4o'),
  ('gpt-4o-mini',     1,  1, 0, 'OpenAI GPT-4o mini'),
  ('claude-opus',     10, 1, 0, 'Anthropic Claude Opus (顶级模型)'),
  ('claude-sonnet',   5,  1, 0, 'Anthropic Claude Sonnet'),
  ('claude-haiku',    1,  1, 0, 'Anthropic Claude Haiku'),
  ('deepseek-v3',     1,  1, 0, 'DeepSeek V3'),
  ('gemini-2.0-pro',  5,  1, 0, 'Google Gemini 2.0 Pro'),
  ('__default__',     3,  1, 1, '未匹配模型时的兜底单价');

-- 充值套餐 (与截图严格对齐)
INSERT INTO recharge_packages (code, name, price_cents, credits, unit_price_text, sort_order, badge, is_active, description) VALUES
  ('PKG_BASIC',    '入门包', 990,  100,  '¥0.099/电力', 1, NULL,         1, '≈5 篇 30 分钟视频'),
  ('PKG_STANDARD', '标准包', 2900, 350,  '¥0.083/电力', 2, '最受欢迎',   1, '≈17 篇 30 分钟视频'),
  ('PKG_PRO',      '专业包', 9900, 1500, '¥0.066/电力', 3, NULL,         1, '≈75 篇 30 分钟视频');

-- 会员订阅方案 (与截图严格对齐)
INSERT INTO subscription_plans (code, name, duration_days, monthly_credits, first_price_cents, renewal_price_cents, original_price_cents, sort_order, badge, is_active, description) VALUES
  ('SUB_MONTHLY',   '月度会员', 30,  1000, 990,   1990,  2900,  1, NULL,            1, '约50篇30分钟视频/月; 按时长阶梯计费'),
  ('SUB_QUARTERLY', '季度会员', 90,  800,  3900,  5900,  7800,  2, NULL,            1, '约40篇30分钟视频/月; 按时长阶梯计费'),
  ('SUB_YEARLY',    '年度会员', 365, 2000, 16800, 19900, 28800, 3, '推荐 · 立省17%', 1, '约100篇30分钟视频/月; 按时长阶梯计费');

-- ============================================================================
-- 完成
-- ============================================================================
