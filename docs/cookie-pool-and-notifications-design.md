# Cookie 池 + 系统通知 设计文档

> 状态：✅ 设计稿（待评审）
> 范围：把「按用户配置 cookie」改成「平台级 Cookie 池」；把现有的 `feedbacks` 表升级为统一的「系统通知中心」

---

## 0. 背景与目标

**问题**
- 当前 cookie 按用户配置，存在两个痛点：(1) 同一平台多个 cookie 不能共享；(2) 失效后没有轮转机制
- `feedbacks` 表只承载「用户主动反馈」，缺少「系统异常」和「cookie 失效」的统一通知通道
- 管理员需要手动查看每个用户的 cookie，不能批量管理

**目标**
1. 平台级 cookie 池（多 cookie 加权随机抽取 + 失败自动降权 + 失效自动隔离）
2. 统一的系统通知（cookie 失效 / 池耗尽 / 用户反馈 / 未来扩展）
3. 加密存储 + 管理员后台可视化管理

---

## 1. 数据模型 + 迁移

### 1.1 新增 `platform_cookies` 表

```sql
CREATE TABLE platform_cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform VARCHAR(32) NOT NULL,        -- 'bilibili' | 'youtube' | 'douyin' | 'kuaishou'
  name VARCHAR(64) NOT NULL,            -- 内部别名，如 "B站-主账号"
  cookie_value_encrypted TEXT NOT NULL, -- Fernet 加密的 cookie 字符串
  remark TEXT,                          -- 管理员备注
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_marked_invalid INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 100,  -- 加权随机抽取权重
  failure_count INTEGER NOT NULL DEFAULT 0,    -- 连续失败计数
  success_count INTEGER NOT NULL DEFAULT 0,    -- 总成功次数
  usage_count INTEGER NOT NULL DEFAULT 0,      -- 总使用次数
  last_used_at DATETIME,
  last_failure_at DATETIME,
  configured_by INTEGER,                -- 创建者 admin user_id
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_platform_cookies_platform_status
  ON platform_cookies(platform, is_enabled, is_marked_invalid);
```

### 1.2 新增 `notifications` 表

```sql
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category VARCHAR(64) NOT NULL,         -- 'cookie_failure' | 'pool_exhausted' | 'user_feedback'
  severity VARCHAR(16) NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'error'
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  source_type VARCHAR(64),              -- 'platform_cookie' | 'task' | 'user'
  source_id VARCHAR(128),               -- 原表 ID（字符串）
  platform VARCHAR(32),                 -- 关联平台（cookie 失效场景用）
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
    -- 'pending' | 'handled' | 'closed' | 'ignored'
  dedup_key VARCHAR(255) NOT NULL,      -- = f'{category}:{source_type}:{source_id}'
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  handled_by INTEGER,
  handled_at DATETIME,
  handler_note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uniq_notifications_dedup ON notifications(dedup_key);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_category ON notifications(category);
```

### 1.3 加密存储

- `COOKIE_ENCRYPT_KEY` 写入 `.env`（Fernet base64 key）
- 启动时若 key 缺失 → 自动生成 + 写入
- 缺失 .env 的密钥 → 拒绝启动
- 入库前 encrypt / 出库后 decrypt（在 DAO 层做，前端永远不接触密文）

### 1.4 数据迁移

- `migrate_cookies_to_pool.py`：把 `user_cookies` 数据迁移到 `platform_cookies`（加密），`user_id → configured_by`. 2026-07-10 之后 `user_cookies` 表本身已下线, 脚本变 noop, 重跑不会出错.
- `migrate_feedbacks_to_notifications.py`：把 `feedbacks` 数据迁移到 `notifications`，`category='user_feedback'`
- 启动时自动检测迁移状态，未迁移则打印 WARN

### 1.5 修改现有表

- `feedbacks` 表保留，应用层只读；新数据走 `notifications`
- 旧 `CookieConfigManager` 保留并行 1 个版本（feature flag 切换）

---

## 2. 服务层

### 2.1 CookiePoolManager（单例，运行时内存索引）

```python
class CookiePoolManager:
    def __init__(self):
        self._cache: dict[str, list[CookieEntry]] = {}
        self._loaded_at: float = 0
        self._lock = threading.RLock()
        self._reload_ttl_seconds = 600

    def _ensure_cache(self, platform: str): ...
    def pick(self, platform: str) -> PickResult: ...
    def report_success(self, cookie_id: int): ...
    def report_failure(self, cookie_id: int, error_code: Optional[str] = None) -> CookieFailureResult: ...
    def is_platform_exhausted(self, platform: str) -> bool: ...
    def reload(self): ...
```

**关键不变量**：
- 抽取时永远跳过 `is_marked_invalid=1` 或 `is_enabled=0`
- `report_failure` 是**幂等**的，多次调用只更新，不重复发通知（60s 去重窗口由 NotificationService 负责）
- `report_failure` 后由调用方决定是否 `pick()` 下一个 cookie（库不管自动重试策略）

### 2.2 CookieFailureDetector

```python
class CookieFailureDetector:
    @staticmethod
    def is_cookie_failure(error_msg: str, http_status: Optional[int] = None) -> bool:
        """
        判定依据（任一匹配即视为 cookie 问题）:
        - HTTP 412 / 403 / 401
        - 错误文本含 'Sign in' / 'login required' / 'cookie' / '登录' / '认证'
        - 错误文本含 'Unable to download JSON metadata'
        """
        ...
```

### 2.3 NotificationService

```python
class NotificationService:
    @staticmethod
    def publish(
        *, category, title, content,
        severity="warning", source_type=None, source_id=None, platform=None,
        dedup_window_seconds=60
    ) -> PublishResult:
        """
        行为:
        1) 生成 dedup_key = f'{category}:{source_type}:{source_id}'
        2) 查 last_seen_at，若在窗口内 → 更新 last_seen_at 并返回 'merged'
        3) 否则创建/更新一条 notifications 记录
        """
        ...

    @staticmethod
    def list(*, status=None, category=None, platform=None, page=1, page_size=20) -> tuple[list, int]: ...
    @staticmethod
    def update_status(*, notification_id, status, handler_note, handled_by) -> bool: ...
    @staticmethod
    def count_by_status() -> dict: ...
```

**关键不变量**：
- `publish` 是**幂等的**（同 dedup_key 同窗口只增加 last_seen_at，不创建新行）
- 通知**永久只读**（不允许物理删除；管理员可以「忽略」或「已处理」状态流转）
- 处理状态变化：**重启后保留**（DB 持久化）

---

## 3. API 与集成点

### 3.1 改动现有 API

| 接口 | 改动 |
|------|------|
| `GET /get_downloader_cookie/{platform}` | **删除** |
| `POST /update_downloader_cookie` | **删除** |

替换为 `/api/admin/cookies` 系列。

### 3.2 Downloader 集成（采用策略 A：保留旧类，内部委托）

```python
# 之前: CookieConfigManager(user_id=user.id).get('bilibili')
# 之后: CookiePoolManager().pick('bilibili')
```

旧 `CookieConfigManager` 保留，内部委托新池；downloaders 一行 import 改动。

下载器上下文管理器 API：

```python
with cookie_pool.use_cookie('bilibili') as ctx:
    try:
        # download with ctx.cookie_str / ctx.cookie_path
        ctx.report_success()
    except Exception as e:
        if CookieFailureDetector.is_cookie_failure(str(e)):
            ctx.report_failure(error=str(e))
```

### 3.3 NoteGenerator 失败透传

收到「cookie 池耗尽」信号时，返回 `code=POOL_EXHAUSTED, platform='bilibili'`，前端弹提示。

### 3.4 新增管理员 API

#### Cookie 池管理 `/api/admin/cookies`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/cookies` | 分页列表（按平台/状态过滤）；返回时解密 |
| POST | `/api/admin/cookies` | 新增 |
| POST | `/api/admin/cookies/import` | 批量导入 |
| PATCH | `/api/admin/cookies/{id}` | 更新 name/remark/is_enabled/weight |
| DELETE | `/api/admin/cookies/{id}` | 物理删除 |
| POST | `/api/admin/cookies/{id}/reset` | 重置状态 |
| POST | `/api/admin/cookies/reload` | 通知池立即重载 |
| GET | `/api/admin/cookies/summary` | 平台可用/失效概览 |

#### 通知管理 `/api/admin/notifications`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/notifications` | 分页列表（按 status/category/platform 过滤） |
| GET | `/api/admin/notifications/summary` | 状态计数 |
| GET | `/api/admin/notifications/{id}` | 详情 |
| PATCH | `/api/admin/notifications/{id}` | 更新状态/处理备注 |
| GET | `/api/admin/notifications/unread_count` | 未读数（顶栏 badge） |

**关键点**：
- 所有接口要求 `Depends(get_current_admin)`
- 通知**不允许物理删除**
- 「未读」= `status='pending'`

### 3.5 前端改动

#### 改动现有页面
| 页面 | 改动 |
|------|------|
| `pages/SettingPage/Downloader.tsx` | 改造：4 平台选项 → cookie 池概览 + 进入「Cookie 池管理」 |
| `pages/SettingPage/components/menuBar.tsx` | 加 `notifications` 菜单项（带 badge） |
| `pages/SettingPage/Menu.tsx` | 同样新增 |

#### 新增页面
| 页面 | 路由 |
|------|------|
| `pages/SettingPage/CookiePool.tsx` | `/settings/download/pool?platform=...` |
| `pages/SettingPage/Notifications.tsx` | `/settings/notifications` |

#### 服务/状态
| 文件 | 改动 |
|------|------|
| `services/admin.ts` | 加 `cookiesApi`、`notificationsApi` |
| `store/notificationStore/index.ts` | 未读数 + 定时拉取 |
| `store/cookiePoolStore/index.ts` | 池概览状态 |
| `layouts/RootLayout.tsx` | 顶栏通知图标 + badge |

### 3.6 配置 `.env`

新增：
```
COOKIE_ENCRYPT_KEY=<Fernet 生成>  # 启动时若不存在自动生成并写入 .env
```

---

## 4. 测试与验收

### 4.1 测试分层
- **单元测试**：DAO、Service、加密/解密（pytest）
- **集成测试**：API 端点、下载器集成、池管理（pytest + httpx + 临时 DB）
- **E2E**（可选）：Playwright

### 4.2 后端关键测试用例

#### DAO
- `PlatformCookieDAO.create` 入库后密文存储
- `PlatformCookieDAO.list_filter(platform='bilibili', include_invalid=False)` 只返回未失效
- `PlatformCookieDAO.increment_usage(id)` 计数 +1，last_used_at 更新
- `NotificationDAO.find_active_dedup(category, source_type, source_id, within=60)` 60s 内返回同一条

#### Service
- `CookieEncryption` 往返一致；错 key 抛 InvalidToken
- `CookiePoolManager.pick` 加权（高 weight 命中率更高）
- `CookiePoolManager.pick` 全失效 → `PickResult(status='empty')`
- `CookiePoolManager.report_failure` 第 3 次失败 → `is_marked_invalid=1` + publish notification
- `CookiePoolManager.report_failure` 第 1 次失败 → 只更新计数，不 publish
- `CookieFailureDetector` B 站 412/403/login → True；YouTube 404 → False
- `NotificationService.publish` 同 dedup_key 60s 内 2 次 → 第 2 次 `state='merged'`
- `NotificationService.publish` 120s 后再次 → `state='created'`
- `NotificationService.publish` 不同 source_id → 各自一条

#### API
- `POST /api/admin/cookies` 无 token → 401
- `POST /api/admin/cookies` 非 admin → 403
- `POST /api/admin/cookies/import` 50 条 → 200, count=50
- `GET /api/admin/cookies?platform=bilibili` → 列表含明文 cookie
- `POST /api/admin/cookies/{id}/reset` → 失效标记清除
- `GET /api/admin/notifications?status=pending` → 只返回 pending
- `PATCH /api/admin/notifications/{id}` → 状态更新
- `DELETE /api/admin/notifications/{id}` → 405

#### 下载器集成
- mock 池返回 A，download 成功 → A usage_count++
- mock 池返回 A，download 抛 412 → A failure_count++ + publish notification
- mock 池返回 A 失败后 pick 返回 B，B 成功 → A 标记失效 + B success++
- mock 池空 → downloader 抛 `CookiePoolExhausted(platform)`

### 4.3 验收清单（DoD）

**Cookie 池管理**
- [ ] 管理员能新增/批量导入/编辑/启用/重置/删除平台 cookie
- [ ] 列表返回的 cookie 明文展示（管理员视图）
- [ ] 启用/禁用立即生效（接口 reload 通知池）
- [ ] 删除是物理删除

**下载流程**
- [ ] 用户在下载器页面看不到 cookie 明文
- [ ] 旧接口（GET/POST `/get_downloader_cookie`）返回 404/410
- [ ] 单 cookie 连续失败 3 次自动标记失效，发布通知
- [ ] 池被标记失效后下载器自动尝试下一个 cookie
- [ ] 平台池全部失效时，下载返回 `POOL_EXHAUSTED` 错误码

**通知**
- [ ] 同一 cookie 60s 内多次失败只产生 1 条通知
- [ ] 同 cookie 60s 后再次失败重新激活（last_seen_at 更新）
- [ ] 通知永远不被物理删除
- [ ] 管理员能改状态：pending → handled / closed / ignored
- [ ] 顶栏 badge 正确显示未读数

**加密 & 安全**
- [ ] `cookie_value_encrypted` 在 DB 是密文
- [ ] `.env` 没有 `COOKIE_ENCRYPT_KEY` 时首次启动自动生成并写入
- [ ] 旧的 `user_cookies` 数据已迁移且不再被读写 (**2026-07-10: user_cookies 表已 DROP 下线, 可勾掉**)

**数据迁移**
- [ ] 迁移脚本可重入（重复执行不抛错）
- [ ] 迁移后旧表保留只读

### 4.4 风险与回滚

| 风险 | 缓解 |
|------|------|
| 迁移期间现网用户 cookie 丢失 | 旧表保留只读；首次启动前自动备份 DB |
| 池切换瞬间下载失败率高 | 旧 `CookieConfigManager` 并行运行 1 个版本（开关切换）；新池默认开启 |
| 加密 key 丢失 | 启动时缺失即拒绝启动 |
| 通知爆炸（抖动 cookie） | dedup 60s；连续失败需阈值才发布 |

### 4.5 实施顺序

1. 加表 + 迁移脚本（无破坏）
2. 加 DAO + 加密 + Service
3. 加管理员 API（先不发邮件通知）
4. 替换 downloader 调用（用 feature flag 切换）
5. 加通知服务 + 失败上报联通
6. 加前端管理 UI（池 + 通知）
7. 旧接口下线（404/410）
8. 端到端跑通验证
9. 跑全量测试 + 上线