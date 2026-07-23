-- NoteFlow MySQL 初始化脚本
-- 使用方式：mysql -u root -p noteflow < init.sql
-- 或在 Docker 中：docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < init.sql
--
-- 本文件为一次性建表脚本，面向全新 (空库) 部署；不是幂等迁移脚本。
-- 覆盖当前线上/本地实际存在的全部 19 张表 (以本地库结构为准，已核对 SQLAlchemy 模型)，
-- 并统一所有表的 collation 为 utf8mb4_unicode_ci (原 7 张计费相关表曾因 billing_init.sql
-- 未显式声明 COLLATE 而被 MySQL 8 默认落到 utf8mb4_0900_ai_ci，此处已统一修正)。
--
-- 已有数据库 (非空库) 不要直接执行本文件：
--   * 已存在同名表时，CREATE TABLE IF NOT EXISTS 会静默跳过，不会补齐新增列，
--     旧库请继续使用 backend/app/db/migrate_*.py 中对应的迁移脚本升级。

SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS noteflow DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE noteflow;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '用户 ID，主键，自增',
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录用户名，全局唯一，最长 64 字符',
  `email` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮箱地址，全局唯一，用于注册/找回密码',
  `hashed_password` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'bcrypt 哈希后的密码，禁止明文存储',
  `avatar` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像图片 URL，可为空',
  `is_active` int NOT NULL DEFAULT '1' COMMENT '账号激活状态：1=正常，0=已停用/封禁',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近更新时间，每次修改自动刷新',
  `last_login_at` datetime DEFAULT NULL,
  `total_points` int NOT NULL DEFAULT '100',
  `used_points` int NOT NULL DEFAULT '0',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `credits` int NOT NULL DEFAULT '0' COMMENT '当前电力余额 (永不过期). 充值/会员/推荐/退费均累加, 生成笔记时扣减',
  `referral_code` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户专属邀请码 (6 位 base32 大写, 全局唯一). 注册时生成, 不可修改',
  `referred_by_user_id` int DEFAULT NULL COMMENT '邀请人 user_id. 注册时填写邀请码后绑定, 不可修改; 用于推荐返点查询',
  `active_subscription_id` bigint DEFAULT NULL COMMENT '当前生效会员订阅 ID. NULL = 免费用户; 引用 subscriptions(id)',
  `is_admin` tinyint NOT NULL DEFAULT '0',
  `email_notify_enabled` tinyint NOT NULL DEFAULT '1',
  `system_announce_enabled` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_users_username` (`username`),
  UNIQUE KEY `ix_users_email` (`email`),
  UNIQUE KEY `uk_users_referral_code` (`referral_code`),
  KEY `fk_users_referred_by` (`referred_by_user_id`),
  KEY `fk_users_active_subscription` (`active_subscription_id`),
  CONSTRAINT `fk_users_active_subscription` FOREIGN KEY (`active_subscription_id`) REFERENCES `subscriptions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_referred_by` FOREIGN KEY (`referred_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `providers` (
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商唯一标识，UUID 字符串，由业务层生成',
  `user_id` int DEFAULT NULL COMMENT '配置/最近编辑该供应商的管理员 id，仅用于追溯，不参与查询过滤',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商显示名称，如 OpenAI、DeepSeek',
  `logo` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '供应商 Logo 图片路径或 URL',
  `type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商类型/接口协议，如 openai、anthropic，决定调用哪个 SDK 适配器',
  `api_key` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'API 密钥，前端读取时会脱敏处理（只显示末 4 位）',
  `base_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'API 基础地址，支持自定义代理或私有部署地址',
  `enabled` int NOT NULL DEFAULT '1' COMMENT '启用状态：1=启用，0=停用；停用后该供应商下的模型不可选',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `ix_providers_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `models` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '模型记录 ID，主键，自增',
  `user_id` int DEFAULT NULL COMMENT '创建人 id',
  `provider_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联的供应商 ID，对应 providers.id',
  `model_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型名称，如 gpt-4o、deepseek-chat，直接传给 API 的 model 参数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `tier` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  PRIMARY KEY (`id`),
  KEY `ix_models_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `video_tasks` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录 ID，主键，自增',
  `user_id` int DEFAULT NULL COMMENT '发起任务的用户 ID；NULL 表示未登录/匿名任务',
  `video_id` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视频唯一标识，通常为平台视频 ID（如 BV 号、YouTube video_id）或本地文件路径',
  `platform` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视频来源平台，用于选择对应下载器：bilibili、youtube、douyin、kuaishou、local',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务唯一标识，UUID 字符串，前端凭此轮询 /task_status/{task_id}',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '任务创建时间',
  `batch_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '批量任务分组 ID；由 /generate_notes_batch 统一生成，单个任务为 NULL',
  `video_url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始视频链接',
  `model_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生成笔记使用的模型名称',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT '任务状态：PENDING/DOWNLOADING/TRANSCRIBING/GENERATING/SUCCESS/FAILED',
  `credits_used` int NOT NULL DEFAULT '20' COMMENT '本次任务消耗的电力,默认 20',
  `completed_at` datetime DEFAULT NULL COMMENT '任务完成时间（SUCCESS 或 FAILED 时写入）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `task_id` (`task_id`),
  KEY `ix_video_tasks_user_id` (`user_id`),
  KEY `ix_video_tasks_batch_id` (`batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_transcriber_configs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录 ID，主键，自增',
  `user_id` int NOT NULL COMMENT '所属用户 ID，关联 users.id；UNIQUE 确保每用户只有一份配置',
  `transcriber_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'fast-whisper' COMMENT '转写引擎类型：fast-whisper（本地 CPU/GPU）、mlx-whisper（Apple Silicon 加速）、bcut（B站 AI 字幕 API，免费但仅中文）、kuaishou（快手字幕 API）、groq（Groq 云端 Whisper，需 API Key）',
  `whisper_model_size` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tiny' COMMENT 'Whisper 模型尺寸，仅 fast-whisper / mlx-whisper 生效；可选：tiny、base、small、medium、large-v2、large-v3；模型越大精度越高，但需要更多内存和时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '配置创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_user_transcriber_configs_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_styles` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录 ID，主键，自增',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '风格显示名称，如 精简、学术，最长 50 字',
  `value` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '风格唯一标识键，英文下划线命名，如 minimal、xiaohongshu；传给 LLM 时用于查找对应 prompt，创建后不可修改',
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '风格简介，对用户展示，可为空，最长 200 字',
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '注入到 LLM 提示词中的风格指令，描述具体的输出格式和语气要求',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '来源类型：system=系统内置（随版本预置，不可删除）；user=用户自定义',
  `user_id` int DEFAULT NULL COMMENT '创建该风格的用户 ID；source=system 时为 NULL',
  `is_public` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否公开到广场：1=所有用户可见并使用，0=仅创建者可见',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近更新时间',
  `icon` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '图标 key，对应前端预置图标集的键名；为空时前端使用首字母头像兜底展示',
  PRIMARY KEY (`id`),
  KEY `ix_note_styles_user_id` (`user_id`),
  KEY `ix_note_styles_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platforms` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键 ID',
  `platform_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台唯一标识, 对应 downloader 的 platform 参数',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '前端展示名称，如 ''YouTube'', ''哔哩哔哩''',
  `icon_url` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台图标 URL',
  `proxy_url` text COLLATE utf8mb4_unicode_ci COMMENT '该平台专属代理地址；空/None 则使用全局代理',
  `is_enabled` int NOT NULL COMMENT '是否启用. 0=禁用, 1=启用',
  `sort_order` int NOT NULL COMMENT '管理后台列表排序，数字越小越靠前',
  `created_at` datetime DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_id` (`platform_id`),
  KEY `ix_platforms_platform_id` (`platform_id`),
  KEY `ix_platforms_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_cookies` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键 ID, 自增',
  `platform` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台标识, 取值: bilibili / youtube / douyin / kuaishou',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '管理后台可见的内部别名, 例如 ''B站-主账号''',
  `cookie_value_encrypted` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Fernet 加密后的 cookie 字符串 (Netscape 格式); 前端永远不接触密文',
  `remark` text COLLATE utf8mb4_unicode_ci COMMENT '管理员备注, 例如 ''2026-03 导入, 高画质视频可用''',
  `cohort` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'default',
  `reserved_for_tier` text COLLATE utf8mb4_unicode_ci COMMENT 'JSON 列表, 限定哪些 user tier 可用. 空/None=全部 tier. 例: ''["vip", "admin"]'' 仅 VIP/管理员能用.',
  `max_concurrent_uses` int NOT NULL DEFAULT '0',
  `in_use_count` int NOT NULL DEFAULT '0',
  `is_enabled` int NOT NULL COMMENT '是否启用. 0=禁用, 1=启用. 禁用后 pick 跳过',
  `is_marked_invalid` int NOT NULL COMMENT '自动失效标记. 1=自动判定失效, pick 跳过. 仅管理员可手动 reset',
  `weight` int NOT NULL COMMENT '加权随机抽取权重, 范围 1~1000',
  `failure_count` int NOT NULL COMMENT '连续失败计数. 归零条件: 一次成功 / 管理员重置',
  `success_count` int NOT NULL COMMENT '总成功次数, 仅累加不回退',
  `usage_count` int NOT NULL COMMENT '总使用次数 (成功+失败), 用于排查热度',
  `last_used_at` datetime DEFAULT NULL COMMENT '最近一次被 pick 并尝试使用的时间',
  `last_failure_at` datetime DEFAULT NULL COMMENT '最近一次失败的时间',
  `configured_by` int DEFAULT NULL COMMENT '录入者的 admin user_id, 可为空表示系统导入',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间, 任一字段修改自动刷新',
  PRIMARY KEY (`id`),
  KEY `ix_platform_cookies_platform_status` (`platform`,`is_enabled`,`is_marked_invalid`),
  KEY `ix_platform_cookies_cohort` (`cohort`),
  KEY `ix_platform_cookies_platform_status_cohort` (`platform`,`is_enabled`,`is_marked_invalid`,`cohort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_shares` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联的任务 ID',
  `share_token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分享凭证，UUID 去掉连字符',
  `is_active` tinyint(1) NOT NULL COMMENT 'True=分享开启，False=已关闭',
  `view_count` int NOT NULL COMMENT '无需登录访问次数',
  `created_at` datetime DEFAULT (now()),
  `updated_at` datetime DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_note_shares_share_token` (`share_token`),
  UNIQUE KEY `ix_note_shares_task_id` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_collections` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '合集 ID，主键，自增',
  `user_id` int NOT NULL COMMENT '创建者用户 ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '合集名称',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '合集描述，可为空',
  `cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '合集封面图片 URL，可为空，前端为空时展示默认文件夹图标',
  `created_at` datetime DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime DEFAULT (now()) COMMENT '最近更新时间（含笔记增删）',
  PRIMARY KEY (`id`),
  KEY `ix_note_collections_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_collection_items` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '关联记录 ID，主键，自增',
  `collection_id` int NOT NULL COMMENT '关联的合集 ID，对应 note_collections.id',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联的笔记任务 ID，对应 video_tasks.task_id',
  `created_at` datetime DEFAULT (now()) COMMENT '加入合集时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_collection_task` (`collection_id`,`task_id`),
  KEY `ix_note_collection_items_collection_id` (`collection_id`),
  KEY `ix_note_collection_items_task_id` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `collection_shares` (
  `id` int NOT NULL AUTO_INCREMENT,
  `collection_id` int NOT NULL COMMENT '关联的合集 ID，对应 note_collections.id',
  `user_id` int NOT NULL COMMENT '合集所有者用户 ID',
  `share_token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分享凭证，UUID 去掉连字符',
  `is_active` tinyint(1) NOT NULL COMMENT 'True=分享开启，False=已关闭',
  `view_count` int NOT NULL COMMENT '无需登录访问次数',
  `created_at` datetime DEFAULT (now()),
  `updated_at` datetime DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_collection_shares_share_token` (`share_token`),
  UNIQUE KEY `ix_collection_shares_collection_id` (`collection_id`),
  KEY `ix_collection_shares_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flashcard_sets` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '卡组 ID，主键，自增',
  `user_id` int NOT NULL COMMENT '创建者用户 ID',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '源笔记 task_id，对应 video_tasks.task_id',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '卡组标题，默认取自源笔记标题',
  `custom_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '用户自定义出题要求，可为空',
  `card_count` int NOT NULL COMMENT '生成的卡片数量',
  `provider_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生成时使用的模型提供者 ID',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生成时使用的模型名称',
  `created_at` datetime DEFAULT (now()) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `ix_flashcard_sets_user_id` (`user_id`),
  KEY `ix_flashcard_sets_task_id` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flashcards` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '卡片 ID，主键，自增',
  `set_id` int NOT NULL COMMENT '所属卡组 ID，对应 flashcard_sets.id',
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '卡片问题',
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '卡片答案',
  `order_index` int NOT NULL COMMENT '卡片顺序，从 0 开始',
  PRIMARY KEY (`id`),
  KEY `ix_flashcards_set_id` (`set_id`),
  CONSTRAINT `flashcards_ibfk_1` FOREIGN KEY (`set_id`) REFERENCES `flashcard_sets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `feedbacks` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '反馈 ID',
  `user_id` int DEFAULT NULL COMMENT '提交者用户 ID；账号被删时置 NULL 以保留反馈历史',
  `category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '反馈分类：bug/feature/ui/perf/other',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '一句话标题，可选',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '详细描述',
  `contact` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系方式（邮箱/微信），可选',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '处理状态：pending=未处理 processing=处理中 done=已完成 stalled=已停滞',
  `admin_note` text COLLATE utf8mb4_unicode_ci COMMENT '处理人备注 / 内部跟进说明',
  `handled_by` int DEFAULT NULL COMMENT '最近一次更新状态的处理人 user_id',
  `handled_at` datetime DEFAULT NULL COMMENT '最近一次状态变更时间',
  `created_at` datetime DEFAULT (now()) COMMENT '提交时间',
  `updated_at` datetime DEFAULT (now()) COMMENT '最后更新时间',
  PRIMARY KEY (`id`),
  KEY `handled_by` (`handled_by`),
  KEY `ix_feedbacks_status_created_at` (`status`,`created_at`),
  KEY `ix_feedbacks_user_id` (`user_id`),
  KEY `ix_feedbacks_status` (`status`),
  CONSTRAINT `feedbacks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `feedbacks_ibfk_2` FOREIGN KEY (`handled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键 ID, 自增',
  `category` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通知分类: cookie_failure / pool_exhausted / user_feedback',
  `severity` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '严重等级: info / warning / error',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '一句话标题, 列表显示',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '详细描述, 详情面板展开',
  `source_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源类型: platform_cookie / task / user_feedback',
  `source_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源记录 ID, 字符串形式保留扩展性 (例如 ''12'' 或 ''task-abc'')',
  `platform` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联平台 (cookie 失效类专用), 便于按平台过滤',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '处理状态: pending / handled / closed / ignored',
  `dedup_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '去重 key = ''{category}:{source_type}:{source_id}''',
  `first_seen_at` datetime NOT NULL DEFAULT (now()) COMMENT '首次发现时间, 永不变动',
  `last_seen_at` datetime NOT NULL DEFAULT (now()) COMMENT '最近一次发现时间, 每次 publish 命中都更新',
  `occurrence_count` int NOT NULL COMMENT '窗口内累计触发次数, 用于面板展示''继续发生 N 次''',
  `handled_by` int DEFAULT NULL COMMENT '标记处理的管理员 user_id, pending 状态时为 NULL',
  `handled_at` datetime DEFAULT NULL COMMENT '最近一次状态变更时间',
  `handler_note` text COLLATE utf8mb4_unicode_ci COMMENT '处理备注 / 跟进说明, 由管理员填写',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间, 任一字段修改自动刷新',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notifications_dedup_key` (`dedup_key`),
  KEY `ix_notifications_category` (`category`),
  KEY `ix_notifications_status_last_seen` (`status`,`last_seen_at`),
  KEY `ix_notifications_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `update_logs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键 ID, 自增',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '更新日志标题',
  `version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '可选版本号, 例如 v1.2.0',
  `summary` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '一句话简介, 用于顶部通知条',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '完整内容, Markdown',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending / active / ended',
  `published_at` datetime DEFAULT NULL COMMENT '进入 active 状态的时间',
  `ended_at` datetime DEFAULT NULL COMMENT '进入 ended 状态的时间',
  `created_by` int DEFAULT NULL COMMENT '创建该日志的管理员 user_id',
  `published_by` int DEFAULT NULL COMMENT '发布该日志的管理员 user_id',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `active_marker` tinyint GENERATED ALWAYS AS ((case when (`status` = _utf8mb4'active') then 1 else NULL end)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_update_logs_active` (`active_marker`),
  KEY `ix_update_logs_status_published` (`status`,`published_at`),
  KEY `ix_update_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='更新日志: pending=未通知 (仅管理员可见), active=通知中 (顶部横幅 + 用户页), ended=已结束 (仅用户页)';

CREATE TABLE IF NOT EXISTS `credit_pricing` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `model_name` varchar(128) NOT NULL COMMENT '模型名称, 与 VideoTask.model_name 一致; __default__ 为兜底',
  `rate_per_minute` int NOT NULL COMMENT '每分钟消耗电力数 (整数)',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用: 1=启用, 0=停用',
  `is_default` tinyint NOT NULL DEFAULT '0' COMMENT '是否兜底: 1=未匹配 model_name 时使用 (应用层保证全表至多一条)',
  `description` varchar(255) DEFAULT NULL COMMENT '描述, 展示用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `model_name` (`model_name`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模型计费率配置表 (按分钟单价)';

CREATE TABLE IF NOT EXISTS `recharge_packages` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(32) NOT NULL COMMENT '套餐编码, 程序内引用, 如 PKG_BASIC',
  `name` varchar(64) NOT NULL COMMENT '展示名称, 如 "入门包"',
  `price_cents` int NOT NULL COMMENT '价格 (分), 1 元 = 100 分',
  `credits` int NOT NULL COMMENT '充值获得的电力数',
  `unit_price_text` varchar(32) DEFAULT NULL COMMENT '展示用单价文案, 如 "¥0.099/电力"',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '展示排序 (升序)',
  `badge` varchar(32) DEFAULT NULL COMMENT '徽章文案, 如 "最受欢迎"',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '是否上架: 1/0',
  `description` varchar(255) DEFAULT NULL COMMENT '描述, 如 "≈5 篇 30 分钟视频"',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_active_sort` (`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='充值套餐定义表';

CREATE TABLE IF NOT EXISTS `subscription_plans` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(32) NOT NULL COMMENT '方案编码, 如 SUB_MONTHLY',
  `name` varchar(64) NOT NULL COMMENT '展示名称, 如 "月度会员"',
  `duration_days` int NOT NULL COMMENT '订阅时长 (天), 30/90/365',
  `monthly_credits` int NOT NULL COMMENT '每月发放电力数',
  `first_price_cents` int NOT NULL COMMENT '首单价 (分), 用户首次订阅此 plan 适用',
  `renewal_price_cents` int NOT NULL COMMENT '续费价 (分), 用户再次订阅此 plan 适用',
  `original_price_cents` int DEFAULT NULL COMMENT '展示用原价 (分), 用于划线显示',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '展示排序',
  `badge` varchar(32) DEFAULT NULL COMMENT '徽章文案, 如 "推荐 · 立省 17%"',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '是否上架: 1/0',
  `description` text COMMENT '权益描述, 支持 markdown 或 JSON 列表',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_active_sort` (`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会员订阅方案表 (按订阅时长分档)';

CREATE TABLE IF NOT EXISTS `credit_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '流水主键',
  `user_id` int NOT NULL COMMENT '用户 ID, 即被记账的用户',
  `type` enum('RECHARGE','CONSUME','REFUND','MONTHLY_GRANT','REGISTER_GRANT','REGISTER_INVITEE','REGISTER_INVITER','FIRST_SUB_INVITER','ADMIN_ADJUST') NOT NULL COMMENT '流水类型',
  `amount` int NOT NULL COMMENT '变动量, 正=加电, 负=扣电',
  `balance_after` int NOT NULL COMMENT '本次操作后 users.credits 余额 (审计快照)',
  `related_task_id` varchar(64) DEFAULT NULL COMMENT '关联 video_tasks.task_id (CONSUME/REFUND 必填)',
  `related_order_id` bigint DEFAULT NULL COMMENT '关联 orders.id (RECHARGE/MONTHLY_GRANT/FIRST_SUB_INVITER)',
  `related_subscription_id` bigint DEFAULT NULL COMMENT '关联 subscriptions.id (MONTHLY_GRANT)',
  `related_referral_id` bigint DEFAULT NULL COMMENT '关联 referral_rewards.id (REGISTER_INVITEE/INVITER, FIRST_SUB_INVITER)',
  `refunded_at` datetime DEFAULT NULL COMMENT '仅 type=CONSUME 行使用: 被退费时间; NULL=未退费, 用于防重放',
  `note` varchar(255) DEFAULT NULL COMMENT '备注文本',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_user_type` (`user_id`,`type`),
  KEY `idx_task` (`related_task_id`),
  KEY `idx_order` (`related_order_id`),
  CONSTRAINT `fk_ct_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电力流水/账本 (永久保留, 仅 INSERT, refunded_at 例外)';

CREATE TABLE IF NOT EXISTS `orders` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_no` varchar(32) NOT NULL COMMENT '订单号, BN + yyyymmdd + 12位随机',
  `user_id` int NOT NULL COMMENT '下单用户 ID',
  `kind` enum('RECHARGE','SUBSCRIPTION') NOT NULL COMMENT '订单类型: RECHARGE=充值, SUBSCRIPTION=订阅',
  `package_id` int DEFAULT NULL COMMENT 'kind=RECHARGE 时引用 recharge_packages.id',
  `plan_id` int DEFAULT NULL COMMENT 'kind=SUBSCRIPTION 时引用 subscription_plans.id',
  `is_first_subscription` tinyint NOT NULL DEFAULT '0' COMMENT '创单时是否享受首单价 (仅 SUBSCRIPTION 有意义)',
  `amount_cents` int NOT NULL COMMENT '下单时锁定的金额 (分)',
  `credits_amount` int NOT NULL COMMENT '下单时锁定的电力数 (订阅订单为本期月发放量)',
  `status` enum('PENDING','PAID','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING' COMMENT '订单状态',
  `pay_method` enum('MOCK_ALIPAY','MOCK_WECHAT','ALIPAY','WECHAT') DEFAULT NULL COMMENT '支付方式: MOCK_ 前缀=mock 通道',
  `mock_qrcode_token` varchar(64) DEFAULT NULL COMMENT '一次性二维码 token; PAID 后清空',
  `paid_at` datetime DEFAULT NULL COMMENT '支付完成时间',
  `cancelled_at` datetime DEFAULT NULL COMMENT '取消时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_no` (`order_no`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_status` (`status`),
  KEY `fk_orders_package` (`package_id`),
  KEY `fk_orders_plan` (`plan_id`),
  CONSTRAINT `fk_orders_package` FOREIGN KEY (`package_id`) REFERENCES `recharge_packages` (`id`),
  CONSTRAINT `fk_orders_plan` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans` (`id`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表 (充值 + 订阅)';

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` int NOT NULL COMMENT '订阅用户 ID',
  `plan_id` int NOT NULL COMMENT '订阅方案 ID',
  `order_id` bigint NOT NULL COMMENT '激活该订阅的订单 ID',
  `start_at` datetime NOT NULL COMMENT '订阅开始时间',
  `end_at` datetime NOT NULL COMMENT '订阅结束时间 (start_at + plan.duration_days)',
  `status` enum('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '订阅状态',
  `last_grant_at` datetime DEFAULT NULL COMMENT '最近一次月度发放时间',
  `next_grant_at` datetime DEFAULT NULL COMMENT '下次预定发放时间',
  `grant_count` int NOT NULL DEFAULT '0' COMMENT '已发放次数, 不超过 ceil(duration_days/30)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_next_grant` (`next_grant_at`,`status`),
  KEY `fk_subs_plan` (`plan_id`),
  KEY `fk_subs_order` (`order_id`),
  CONSTRAINT `fk_subs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`),
  CONSTRAINT `fk_subs_plan` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans` (`id`),
  CONSTRAINT `fk_subs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户订阅记录表';

CREATE TABLE IF NOT EXISTS `referral_rewards` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `inviter_user_id` int NOT NULL COMMENT '邀请人 user_id',
  `invitee_user_id` int NOT NULL COMMENT '被邀请人 user_id',
  `reward_type` enum('REGISTER','FIRST_SUBSCRIPTION') NOT NULL COMMENT '奖励类型: REGISTER=注册触发, FIRST_SUBSCRIPTION=首订阅触发',
  `inviter_credits` int NOT NULL COMMENT '本次发给邀请人的电力 (REGISTER=20, FIRST_SUBSCRIPTION=100)',
  `invitee_credits` int NOT NULL DEFAULT '0' COMMENT '本次发给被邀请人的电力 (REGISTER=200, FIRST_SUBSCRIPTION=0)',
  `trigger_order_id` bigint DEFAULT NULL COMMENT 'reward_type=FIRST_SUBSCRIPTION 时关联的订阅订单 ID',
  `status` enum('PAID') NOT NULL DEFAULT 'PAID' COMMENT '状态, MVP 始终 PAID (预留扩展)',
  `paid_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '到账时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitee_type` (`invitee_user_id`,`reward_type`),
  KEY `idx_inviter` (`inviter_user_id`,`paid_at` DESC),
  KEY `fk_ref_order` (`trigger_order_id`),
  CONSTRAINT `fk_ref_invitee` FOREIGN KEY (`invitee_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_ref_inviter` FOREIGN KEY (`inviter_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_ref_order` FOREIGN KEY (`trigger_order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='推荐奖励记录表 (注册触发 + 首订阅触发, 同 invitee 同类型唯一)';

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

SET FOREIGN_KEY_CHECKS = 1;
