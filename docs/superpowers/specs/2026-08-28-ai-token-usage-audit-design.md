# AI Token 使用审计与成本运营中心设计

**日期：** 2026-08-28  
**状态：** 已获用户确认，进入开发

## 1. 目标

为 NoteFlow 建立统一的 AI 调用审计链路，覆盖所有直接或间接调用大模型的功能，并在现有管理员后台中提供 Token、模型、Key、用户、业务场景和成本的可观察能力。

必须满足：

- 每次模型调用都能关联用户、业务场景、资源、请求链路、Provider、模型和脱敏后的 Key 指纹。
- 记录输入 Token、输出 Token、总 Token、缓存 Token、推理 Token、延迟、重试、流式状态、错误和成本。
- 请求/响应内容可用于管理员排查，但不得记录完整 API Key；日志内容采用可配置策略并支持脱敏/摘要。
- 成本按调用发生时的价格快照计算，后续修改价格配置不影响历史账单。
- 覆盖工作台问答、知识库问答、产品助手、视频笔记、笔记合并、闪记卡、内容审核和模型连接测试。
- 管理员从现有后台进入“AI Token 运营”节点；节点首页有紧凑概览，点击后进入应用内全屏管理页面。
- 普通用户不能访问运营接口；管理员看到的 Key 仅限别名、Provider、模型和末尾指纹。

不在本期范围内：把内部 Token 统计直接替换现有“电力”扣费规则；对历史上没有 Token 数据的旧调用伪造精确 Token；记录完整 API 密钥或绕过后台权限导出日志。

## 2. 现有系统接入点

当前系统使用 FastAPI、SQLAlchemy、SQLite/MySQL 兼容数据库、React 19、React Router 和现有 SettingPage 管理布局。管理员接口统一使用 get_current_admin，前端后台入口位于 /settings/*。

统一记录器必须接入以下调用类别：

| 场景编码 | 业务功能 | 当前调用位置 | 记录要求 |
| --- | --- | --- | --- |
| workbench_chat | 工作台笔记问答 | chat_service.py、chat.py | 保存会话/任务关联、流式完成结果、工具轮次和最终 Token |
| knowledge_base_chat | 知识库问答 | knowledge_base_service.py、knowledge_base.py | 保存 conversation/message 关联和最终回答 Token |
| product_assistant | 产品助手“小流” | product_assistant_service.py、assistant.py | 传递真实用户 ID，不再丢弃当前用户 |
| note_generation | 视频笔记生成 | note.py、app/gpt/* | 每个 chunk、合并、重试都可追踪，主任务可汇总 |
| note_merge | 笔记合并 | note_collection.py、llm_helper.py | 记录用户、集合/笔记资源和价格 |
| flashcard_generation | 闪记卡生成 | flashcard.py、llm_helper.py | 记录用户、卡片集资源和 Token |
| content_moderation | 内容/笔记风格审核 | content_moderation_service.py | 记录触发来源、审核模型和成功/失败 |
| model_test | Provider/模型连接测试 | provider.py、Provider 测试方法 | 记录管理员、模型、Key 指纹、测试结果和极小请求 |
| model_direct | 其他直接 completion 调用 | deepseek_gpt.py、qwen_gpt.py 等 | 迁移到记录器或由兼容适配层补齐 |

llm_helper.simple_completion 与 UniversalGPT 是优先收口的公共调用层；流式聊天和带工具调用的 RAG 逻辑使用同一记录器的异步/流式 API。

## 3. 数据模型

### 3.1 ai_usage_logs

一行代表一次供应商请求尝试。重试产生新行并通过 parent_log_id/trace_id 关联，便于区分“最终业务调用一次”和“底层请求多次”。

核心字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT/INTEGER PK | 日志主键 |
| request_id | VARCHAR(64) unique | 单次供应商请求唯一标识 |
| trace_id | VARCHAR(64) index | 一次业务 AI 操作的链路标识 |
| parent_log_id | BIGINT nullable | 重试、工具轮次或 chunk 的父日志 |
| user_id | INTEGER nullable index | 发起用户；系统级调用允许为空 |
| user_snapshot | VARCHAR(160) nullable | 写入时的脱敏用户名/邮箱快照 |
| scene | VARCHAR(48) index | 业务场景编码 |
| operation | VARCHAR(80) | 具体动作，例如 generate_summary |
| resource_type | VARCHAR(48) nullable | video_task、conversation、flashcard_set 等 |
| resource_id | VARCHAR(128) nullable | 业务资源 ID |
| provider_id | INTEGER nullable | 当前 Provider ID |
| provider_name | VARCHAR(120) | 调用时 Provider 名称快照 |
| model_id | INTEGER nullable | 当前模型 ID |
| model_name | VARCHAR(160) | 调用时模型名称快照 |
| key_alias | VARCHAR(120) nullable | Key 配置别名或来源标识 |
| key_fingerprint | CHAR(64) nullable | API Key SHA-256 指纹，不存完整 Key |
| key_masked | VARCHAR(32) nullable | 例如 sk-...8F2A，仅用于展示 |
| request_mode | VARCHAR(16) | sync、stream、tool |
| attempt_no | INTEGER | 该 trace 的尝试序号，从 1 开始 |
| status | VARCHAR(20) index | started、success、failed、cancelled、timeout |
| error_type | VARCHAR(80) nullable | 稳定错误分类 |
| error_message | TEXT nullable | 截断并脱敏后的错误 |
| started_at | DATETIME index | 请求开始时间 |
| completed_at | DATETIME nullable | 请求结束时间 |
| latency_ms | INTEGER nullable | 服务端实际耗时 |
| input_tokens | BIGINT nullable | 输入 Token |
| output_tokens | BIGINT nullable | 输出 Token |
| cached_input_tokens | BIGINT nullable | 缓存输入 Token |
| reasoning_tokens | BIGINT nullable | 推理 Token |
| total_tokens | BIGINT nullable | 供应商总数；无供应商值时由已知字段求和 |
| token_source | VARCHAR(20) | provider、estimated、unavailable |
| input_price_per_million | DECIMAL(18,8) nullable | 价格快照 |
| output_price_per_million | DECIMAL(18,8) nullable | 价格快照 |
| currency | CHAR(3) | 默认 CNY |
| estimated_cost | DECIMAL(18,8) nullable | 输入/输出按快照计算的成本 |
| prompt_content | TEXT nullable | 按记录策略保存的请求内容 |
| response_content | TEXT nullable | 按记录策略保存的最终响应或流式拼接内容 |
| prompt_sha256 | CHAR(64) nullable | 请求摘要，内容关闭时仍可去重 |
| response_sha256 | CHAR(64) nullable | 响应摘要 |
| metadata_json | TEXT nullable | JSON，包含参数、工具轮次、供应商 request ID 等非敏感元信息 |
| created_at | DATETIME index | 日志写入时间 |

索引：started_at+status、user_id+started_at、scene+started_at、model_name+started_at、key_fingerprint+started_at、trace_id、request_id unique。明细接口按 started_at DESC、id DESC 分页，不允许无条件全表读取。

### 3.2 ai_model_pricing

维护价格配置并支持历史快照：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | BIGINT/INTEGER PK | 价格规则 ID |
| provider_id | INTEGER nullable | Provider 维度匹配 |
| provider_name | VARCHAR(120) | Provider 快照/匹配名 |
| model_name | VARCHAR(160) | 模型名，支持通配匹配但精确名优先 |
| input_price_per_million | DECIMAL(18,8) | 输入价格 |
| output_price_per_million | DECIMAL(18,8) | 输出价格 |
| currency | CHAR(3) | 货币 |
| effective_from | DATETIME | 生效时间 |
| effective_to | DATETIME nullable | 失效时间 |
| is_active | BOOLEAN | 是否可选用 |
| note | VARCHAR(500) nullable | 管理员备注 |
| created_by | INTEGER nullable | 配置管理员 |
| created_at / updated_at | DATETIME | 审计时间 |

价格匹配顺序为：Provider+模型精确匹配、模型精确匹配、Provider 默认、系统默认；无匹配时成本为 NULL 并在后台显示“未配置价格”，不能默认为零。写入日志时复制价格字段，不依赖后续 join 计算历史成本。

### 3.3 内容保存和隐私

默认记录请求/响应摘要及截断内容，不保存完整超长视频全文。可通过系统配置选择 metadata_only、redacted_excerpt、full 三档；full 仅管理员可查且默认关闭。记录前对 API Key、Bearer Token、Cookie、手机号、邮箱等敏感模式做替换；响应和 prompt 最大长度受服务端限制。日志详情接口再次执行脱敏，错误堆栈不返回客户端。

## 4. 统一采集层

新增 app/services/ai_usage_service.py，提供以下稳定接口：

~~~python
class AIUsageContext(TypedDict, total=False):
    user_id: int | None
    user_snapshot: str | None
    scene: str
    operation: str
    resource_type: str | None
    resource_id: str | None
    trace_id: str
    provider_id: int | None
    provider_name: str
    model_id: int | None
    model_name: str
    key_alias: str | None
    key_fingerprint: str | None
    key_masked: str | None
~~~

~~~python
def record_completion(
    context: AIUsageContext,
    request_messages: list[dict],
    call: Callable[[], Any],
) -> Any

async def record_stream_completion(
    context: AIUsageContext,
    request_messages: list[dict],
    stream_call: Callable[[], AsyncIterator[Any]],
) -> AsyncIterator[Any]
~~~

实现规则：

1. 调用开始立即写入 started 行，若数据库写入失败不得阻断用户的 AI 请求，但必须写应用错误日志并保留内存降级计数。
2. 统一从供应商响应的 usage 读取 Token；字段缺失时按明确标记设置 unavailable，只有在可解释的 tokenizer 估算成功时才设置 estimated。
3. 同步、流式、工具调用都在结束或异常时更新状态、延迟、Token、成本和响应摘要。
4. 流式响应实时透传给原调用方，结束时用拼接的安全响应内容补全日志；客户端断开标记为 cancelled。
5. 重试每次有独立 request_id 和 attempt_no，共享 trace_id，最终业务统计按 trace 去重，底层请求统计另列。
6. 工具调用记录为同一 trace 下的子日志，工具本身不产生模型 Token 时不写虚假 Token。
7. 记录层不能重复扣现有电力；现有电力扣费和 AI 成本日志通过 trace_id/related task 关联。
8. 适配层保留供应商原始 request ID、finish reason、是否流式等信息，不把完整 messages 写进 metadata。

## 5. 后台 API

新增 backend/app/routers/admin_ai_usage.py，所有接口依赖 get_current_admin，响应继续使用 ResponseWrapper。

- GET /api/admin/ai-usage/overview：KPI、时间范围和全局筛选。
- GET /api/admin/ai-usage/trend：按小时/日返回 input/output/total token、调用量、成本、失败量。
- GET /api/admin/ai-usage/by-user：用户排行、调用量、Token、成本、失败率，分页。
- GET /api/admin/ai-usage/by-model：Provider、模型、Key 指纹聚合。
- GET /api/admin/ai-usage/by-scene：业务场景聚合。
- GET /api/admin/ai-usage/logs：分页明细，支持 start_date/end_date/user_id/scene/provider_id/model_name/key_fingerprint/status/keyword。
- GET /api/admin/ai-usage/logs/{id}：单条脱敏详情，包含重试和同 trace 子调用。
- GET /api/admin/ai-usage/export：同样的过滤条件导出 CSV；限制最大时间范围和最大行数。
- GET /api/admin/ai-usage/pricing：价格规则列表。
- POST /api/admin/ai-usage/pricing：新增价格规则并校验时间区间、价格非负。
- PATCH /api/admin/ai-usage/pricing/{id}：停用或调整未来价格，不修改历史日志快照。

日期范围默认最近 7 天，最大 367 天；分页最大 100；所有聚合查询必须使用时间条件。接口只返回脱敏 Key 信息，导出同样脱敏。

## 6. 前端后台节点

复用 SettingLayout 和现有 Menu：

- 管理员菜单增加 AI Token 运营，路由为 /settings/ai-usage。
- 设置首页/后台概览增加紧凑卡片：今日 Token、今日成本、调用次数、失败率；加载失败显示重试按钮。
- /settings/ai-usage 使用全屏内容区，提供筛选栏、五项 KPI、Token 趋势折线图、输入/输出柱状图、用户/模型/场景排行和最近调用表。
- 点击表格行打开右侧详情抽屉，展示请求链路、Token、成本价格快照、Key 指纹、错误和重试树；敏感内容依后端策略显示。
- 筛选条件写入 URL search params，刷新和返回可恢复；表格分页、导出和价格管理与筛选状态一致。
- 使用项目现有图表依赖；若现有依赖不提供折线/柱状图，则新增轻量 SVG 图表组件，不引入重量级图表库。
- 兼容桌面 Tauri 的 HashRouter；不新开外部窗口，使用应用内全屏路由保持鉴权和返回栈。

## 7. 数据库迁移和兼容

新增模型导入到 backend/app/db/models/__init__.py 和 init_db.py 的 metadata 加载路径，增加幂等迁移脚本，创建表和索引。SQLite 与 MySQL 均使用现有 SQLAlchemy 类型；Decimal 字段需要按项目现有数据库驱动验证。旧日志不存在时页面展示空数据，不阻塞启动。历史 KbMessage、VideoTask 和现有聊天状态不回填虚假 Token；新请求从上线时开始完整采集。

启动时迁移只做结构变更，不扫描大表；迁移失败必须明确报错，不能静默启动成半结构状态。日志保留策略默认 180 天，可后续增加归档/删除任务；本期不物理删除用户业务数据。

## 8. 测试与验收

开发严格采用 TDD，每个功能先写失败测试再写实现。至少覆盖：

- 价格匹配优先级、时间区间和成本计算精度。
- Key 指纹稳定、日志中无完整 Key、敏感模式脱敏。
- 同步成功/失败、流式完成/中断、工具轮次、重试 attempt 和 trace 去重。
- usage 缺失时的 unavailable 状态，估算 Token 的明确标记。
- 每个业务场景传递正确 user ID/resource ID；产品助手不再丢失用户。
- 管理员接口鉴权、日期边界、分页、筛选、聚合结果和导出脱敏。
- 迁移幂等、SQLite 初始化和已存在旧数据库兼容。
- 前端菜单仅管理员可见、路由守卫、加载/空数据/错误状态、图表数据渲染和详情抽屉。

上线前执行三轮检查：

1. **单元与接口轮：** 后端新增测试、相关旧测试、API 权限和数据库迁移测试。
2. **构建与链路轮：** 前端 lint/build，后端完整 pytest，逐个触发主要 AI 场景确认日志写入、Token 和成本。
3. **审计与回归轮：** 检查所有 chat.completions.create 直接调用是否已收口，检查日志敏感字段、统计去重、重试/流式边界、未登录/普通用户权限和 git diff，确认不修改用户已有未相关变更。

验收标准是：管理员能从后台小窗口进入全屏节点，按用户/场景/模型/Key/时间筛选并看到准确 Token 与成本；每个列出的 AI 场景至少产生一条可追踪日志；无完整 API Key 进入数据库、接口响应或导出文件；既有 AI 功能和电力扣费行为不回归。

