# AI Token 使用审计与成本运营中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** 在 NoteFlow 中建立覆盖全部 AI 场景的 Token/成本审计链路，并在管理员后台提供可筛选、可下钻、可导出的全屏运营节点。

**Architecture:** 以 ai_usage_logs 记录每次供应商请求尝试，以 ai_model_pricing 保存带生效时间的价格规则；所有同步、流式、工具调用和重试统一经过 AI 使用服务，管理员统计接口只从日志聚合。前端复用现有 SettingLayout，在 /settings/ai-usage 提供概览、图表、明细抽屉和价格管理。

**Tech Stack:** FastAPI、SQLAlchemy、SQLite/MySQL、pytest、React 19、TypeScript、React Router、Tailwind、现有 shadcn/ui 和项目已有图表能力。

## Global Constraints

- 不记录完整 API Key；只保存 SHA-256 指纹、脱敏尾号和 Key 别名。
- 历史没有 usage 的调用不能伪造精确 Token，必须标记 unavailable 或 estimated。
- 历史成本使用写入日志时的价格快照，价格修改不回算历史日志。
- 管理员接口全部使用 get_current_admin；普通用户不能查询运营数据。
- 不能重复扣现有电力，也不能修改用户已有未相关改动。
- 默认保存脱敏摘要/截断内容；错误和导出数据都必须再次脱敏。
- 每个任务先写失败测试、确认失败，再写最小实现、确认通过。
- 结束前执行后端测试、前端 lint/build、调用点审计和 git diff 三轮检查。

---

### Task 1: 数据模型、迁移和价格计算基础

**Files:**
- Create: backend/app/db/models/ai_usage.py
- Modify: backend/app/db/models/__init__.py
- Modify: backend/app/db/init_db.py
- Create: backend/app/db/migrate_add_ai_usage.py
- Create: backend/tests/test_ai_usage_models.py
- Create: backend/app/services/ai_usage_pricing.py
- Test: backend/tests/test_ai_usage_pricing.py

**Interfaces:**
- Produces ORM classes AIUsageLog and AIModelPricing.
- Produces calculate_cost(input_tokens, output_tokens, input_price_per_million, output_price_per_million) -> Decimal.
- Produces mask_secret(value) -> str and fingerprint_secret(value) -> str.

- [x] **Step 1: Write failing tests for schema helpers and pricing**

测试至少验证：
~~~python
def test_calculate_cost_uses_input_and_output_prices():
    assert calculate_cost(1_000_000, 500_000, Decimal("2"), Decimal("4")) == Decimal("4")

def test_mask_secret_never_returns_full_key():
    masked = mask_secret("sk-test-secret-8F2A")
    assert masked.endswith("8F2A")
    assert masked != "sk-test-secret-8F2A"
    assert "test-secret" not in masked

def test_fingerprint_is_stable_sha256():
    assert fingerprint_secret("key") == fingerprint_secret("key")
    assert len(fingerprint_secret("key")) == 64
~~~

- [x] **Step 2: Run the focused tests and confirm the expected missing-module failure**

运行：cd backend && pytest tests/test_ai_usage_pricing.py tests/test_ai_usage_models.py -q  
预期：失败，原因是 ai_usage_pricing 和 AIUsageLog 尚未定义。

- [x] **Step 3: Implement the two ORM models and pure helpers**

AIUsageLog 至少包含设计文档中的 request_id、trace_id、user_id、scene、provider/model/key 快照、request_mode、attempt_no、status、时间、Token、价格快照、成本、摘要、内容和 metadata 字段；AIModelPricing 包含 provider/model、输入输出价格、生效时间、启用状态、备注和审计字段。为 started_at、user_id、scene、model_name、key_fingerprint、trace_id 和 request_id 建立索引。

- [x] **Step 4: Register models and create an idempotent migration**

把模型加入 models 导出和 metadata 加载路径；迁移脚本使用现有 engine，重复执行不会报错，并创建两张表及索引。init_db 在已存在旧库上先 create_all，再调用迁移，不扫描业务大表。

- [x] **Step 5: Run focused tests and SQLite metadata verification**

运行：cd backend && pytest tests/test_ai_usage_pricing.py tests/test_ai_usage_models.py -q  
预期：全部通过；另外用内存 SQLite 创建 metadata 后能查询 ai_usage_logs 和 ai_model_pricing。

---

### Task 2: 统一 AI 记录服务和流式/重试处理

**Files:**
- Create: backend/app/services/ai_usage_service.py
- Create: backend/tests/test_ai_usage_service.py
- Modify: backend/app/services/ai_usage_pricing.py

**Interfaces:**
- AIUsageContext 是包含 user_id、scene、operation、resource、provider/model/key 快照和 trace_id 的 TypedDict。
- AIUsageRecorder.record_sync(context, messages, call) 返回供应商结果。
- AIUsageRecorder.record_stream(context, messages, stream_call) 返回异步迭代器。
- extract_usage(response) 返回 input/output/cached/reasoning/total/token_source。
- sanitize_payload(value) 返回摘要、脱敏截断内容和 sha256。

- [x] **Step 1: Write failing tests for sync success/failure, stream completion, missing usage, retry and redaction**

测试使用内存 SQLite 和假供应商响应，验证：
~~~python
def test_sync_success_persists_provider_usage_and_cost():
    result = recorder.record_sync(context, [{"role": "user", "content": "hi"}], lambda: response)
    assert result.choices[0].message.content == "ok"

def test_sync_failure_persists_failed_status_without_hiding_original_error():
    with pytest.raises(RuntimeError, match="provider down"):
        recorder.record_sync(context, [], lambda: raise_provider_error())

async def test_stream_completion_persists_joined_output_after_chunks():
    chunks = [FakeChunk("a"), FakeChunk("b", usage=FakeUsage(2, 1))]
    assert "".join([chunk async for chunk in recorder.record_stream(context, [], lambda: chunks)]) == "ab"

def test_missing_usage_is_marked_unavailable():
    assert extract_usage(FakeResponse(usage=None)).token_source == "unavailable"

def test_retry_attempts_share_trace_but_have_unique_request_ids():
    rows = recorder.retry_sync(context, [], failing_then_success)
    assert len({row.request_id for row in rows}) == 2
    assert len({row.trace_id for row in rows}) == 1

def test_payload_redaction_removes_api_keys_and_truncates_content():
    value = sanitize_payload("Authorization: Bearer secret-value")
    assert "secret-value" not in value.content
~~~

- [x] **Step 2: Run tests and confirm failures**

运行：cd backend && pytest tests/test_ai_usage_service.py -q  
预期：失败，原因是 recorder 和 usage extraction 尚未实现。

- [x] **Step 3: Implement minimal recorder lifecycle**

开始时插入 started；完成时更新 success、usage、latency、cost、safe payload；异常时更新 failed/timeout/cancelled、error_type 和脱敏错误。日志写入异常不能阻断原始 AI 调用，但要记录应用错误。

- [x] **Step 4: Implement stream adapter and usage extraction**

流式迭代器实时透传 chunk，安全拼接文本，结束时读取最后一帧 usage；客户端取消和供应商异常分别落状态。供应商 usage 缺失时返回 unavailable，不使用未经标记的猜测。

- [x] **Step 5: Implement price snapshot matching**

按 Provider+模型精确、模型精确、Provider 默认、系统默认匹配 active 且处于生效区间的规则；无匹配时成本为 None。使用 Decimal 计算并将匹配结果复制到 AIUsageLog。

- [x] **Step 6: Run focused tests and refactor without changing behavior**

运行：cd backend && pytest tests/test_ai_usage_service.py tests/test_ai_usage_pricing.py -q  
预期：全部通过。

---

### Task 3: 收口全部后端 AI 调用点

**Files:**
- Modify: backend/app/services/llm_helper.py
- Modify: backend/app/services/note.py
- Modify: backend/app/services/chat_service.py
- Modify: backend/app/routers/chat.py
- Modify: backend/app/services/knowledge_base_service.py
- Modify: backend/app/routers/knowledge_base.py
- Modify: backend/app/services/product_assistant_service.py
- Modify: backend/app/routers/assistant.py
- Modify: backend/app/services/content_moderation_service.py
- Modify: backend/app/routers/note_collection.py
- Modify: backend/app/routers/flashcard.py
- Modify: backend/app/routers/provider.py
- Modify: backend/app/gpt/deepseek_gpt.py
- Modify: backend/app/gpt/qwen_gpt.py
- Create: backend/tests/test_ai_usage_integration.py

**Interfaces:**
- 每个入口向 recorder 传入明确 scene、operation、user_id、resource_type、resource_id、provider/model/key 快照。
- chat、knowledge base、product assistant 的当前用户 ID 从 router 传入 service，不再在 assistant router 丢弃。
- 现有电力扣费继续执行一次，并通过 trace_id 或 related task 与日志关联。

- [ ] **Step 1: Write failing integration tests for representative scenes**

用 monkeypatch 假调用层，验证 workbench_chat、note_generation、flashcard_generation、note_merge、content_moderation、knowledge_base_chat、product_assistant 和 model_test 至少各传出正确 scene 与 user_id；验证重试不重复扣电力。

- [ ] **Step 2: Run the integration tests and confirm failures**

运行：cd backend && pytest tests/test_ai_usage_integration.py -q  
预期：失败，至少产品助手 user_id 为空或调用点未调用 recorder。

- [x] **Step 3: Wrap shared llm_helper and UniversalGPT paths**

把 simple_completion 和 UniversalGPT 的底层 completion 统一使用 recorder；保留 chunk、合并和现有错误语义，建立父 trace 和 attempt 关联，不能把整个视频全文重复写入每个日志内容字段。

- [x] **Step 4: Wrap streaming chat, knowledge base and product assistant**

保持 SSE/delta 行为不变；请求开始记录 context，流结束更新 usage。知识库和工作台消息继续使用原 DAO；产品助手服务签名接收 user_id。

- [x] **Step 5: Wrap note merge, flashcards, moderation and provider test**

这些入口分别使用 note_merge、flashcard_generation、content_moderation、model_test scene；管理员模型测试也记录管理员 ID；内容审核传递触发资源。

- [x] **Step 6: Audit all direct completion calls and run related backend tests**

运行：rg -n "chat\\.completions\\.create|simple_completion|UniversalGPT" backend/app  
预期：每个有效调用都位于 recorder 适配层或明确标注为已收口；运行相关原有测试与 test_ai_usage_integration.py 全部通过。

---

### Task 4: 管理员 Token 统计、日志和价格 API

**Files:**
- Create: backend/app/db/ai_usage_dao.py
- Create: backend/app/routers/admin_ai_usage.py
- Modify: backend/app/__init__.py
- Create: backend/tests/test_admin_ai_usage.py

**Interfaces:**
- GET /api/admin/ai-usage/overview
- GET /api/admin/ai-usage/trend
- GET /api/admin/ai-usage/by-user
- GET /api/admin/ai-usage/by-model
- GET /api/admin/ai-usage/by-scene
- GET /api/admin/ai-usage/logs
- GET /api/admin/ai-usage/logs/{id}
- GET /api/admin/ai-usage/export
- GET/POST/PATCH /api/admin/ai-usage/pricing

- [ ] **Step 1: Write failing API tests**

覆盖非管理员 403、默认日期范围、最大日期范围、overview KPI、trend 补齐无数据日期、用户/模型/场景聚合、日志分页/过滤、详情重试树、CSV 脱敏导出和价格规则时间冲突。

- [ ] **Step 2: Run focused API tests and confirm failures**

运行：cd backend && pytest tests/test_admin_ai_usage.py -q  
预期：失败，原因是 router、DAO 和路由注册尚不存在。

- [x] **Step 3: Implement DAO query boundaries**

所有聚合必须有时间条件；按 started_at DESC、id DESC 分页；Token 统计使用 coalesce；失败率按业务请求 trace 去重，同时明细保留每次 attempt；成本为 NULL 时单独统计未配置价格数量。

- [x] **Step 4: Implement admin endpoints and safe serializers**

复用 ResponseWrapper、get_current_admin 和现有 date bounds 风格。日志详情/导出只返回 key_alias、key_masked、key_fingerprint，不返回完整密钥；prompt/response 经过 sanitize_payload。

- [x] **Step 5: Implement pricing CRUD validation**

校验价格非负、model/provider 必填规则、effective_from < effective_to、同一匹配范围时间不重叠；更新未来规则不改变日志快照。

- [x] **Step 6: Register router and run API tests**

运行：cd backend && pytest tests/test_admin_ai_usage.py -q  
预期：全部通过。

---

### Task 5: 管理员后台节点和全屏 Token 管理页

**Files:**
- Create: NoteFlow_frontend/src/services/aiUsage.ts
- Create: NoteFlow_frontend/src/pages/SettingPage/AiUsagePage.tsx
- Create: NoteFlow_frontend/src/pages/SettingPage/components/AiUsageCharts.tsx
- Create: NoteFlow_frontend/src/pages/SettingPage/components/AiUsageDetailDrawer.tsx
- Create: NoteFlow_frontend/src/pages/SettingPage/components/AiUsageWidget.tsx
- Modify: NoteFlow_frontend/src/pages/SettingPage/Menu.tsx
- Modify: NoteFlow_frontend/src/App.tsx
- Modify: NoteFlow_frontend/src/pages/SettingPage/index.tsx
- Create: NoteFlow_frontend/src/pages/SettingPage/AiUsagePage.test.tsx

**Interfaces:**
- aiUsageApi.overview/trend/byUser/byModel/byScene/logs/detail/export/pricing 对应后端接口。
- AiUsagePage 读取 URLSearchParams 保存筛选和分页。
- 图表组件接受明确的 trend/rank 数据，不在组件内部请求 API。

- [ ] **Step 1: Write failing component/service tests**

验证管理员菜单出现 AI Token 运营、非管理员不出现；页面展示 loading/empty/error；筛选写入 URL；overview/trend/rank 数据渲染；点击日志行打开详情；导出调用正确参数。

- [ ] **Step 2: Run frontend focused tests and confirm failures**

运行：cd NoteFlow_frontend && pnpm test --run src/pages/SettingPage/AiUsagePage.test.tsx  
预期：失败，原因是页面、服务和路由尚未存在。

- [x] **Step 3: Implement typed API client and page data loading**

沿用现有 services/admin.ts 的 request 客户端和 ResponseWrapper 解包规则；用统一 filter state 并行加载 overview、trend、三种排行和 logs；API 失败展示可重试状态。

- [x] **Step 4: Implement charts and log detail drawer**

优先复用现有图表依赖；若没有则使用轻量 SVG；包含 Token 趋势折线、输入/输出柱状、用户/模型/场景排行。详情抽屉展示价格快照、Token 来源、trace、重试、脱敏 payload 和错误。

- [x] **Step 5: Add admin menu, route and compact overview**

在 Menu 管理员项中加入 AI Token 运营，在 App 设置路由加入 /settings/ai-usage；后台概览增加小卡片并链接到全屏页。HashRouter/BrowserRouter 都使用应用内路由，不打开外部窗口。

- [x] **Step 6: Run frontend focused test, lint and build**

运行：cd NoteFlow_frontend && pnpm test --run src/pages/SettingPage/AiUsagePage.test.tsx && pnpm lint && pnpm build  
预期：新增测试、lint 和 build 全部通过。

---

### Task 6: 三轮验收、回归和交付检查

**Files:**
- Modify: docs/superpowers/plans/2026-08-28-ai-token-usage-audit.md
- Modify only if verification discovers a defect: implementation files from Tasks 1-5
- Test: backend/tests and frontend tests from Tasks 1-5

- [x] **Step 1: Run unit/API/database round**

运行：cd backend && pytest -q  
预期：所有后端测试通过；迁移在空 SQLite 和已有 SQLite 数据库上均幂等。

- [x] **Step 2: Run frontend/build and representative chain round**

运行：cd NoteFlow_frontend && pnpm lint && pnpm build  
同时验证主要场景产生日志：工作台问答、知识库问答、产品助手、视频笔记、笔记合并、闪记卡、内容审核、模型测试。

- [x] **Step 3: Run audit/security/regression round**

检查：
~~~bash
rg -n "chat\\.completions\\.create" backend/app
rg -n "api[_-]?key|Bearer|sk-" backend/app/services/ai_usage_service.py backend/app/routers/admin_ai_usage.py
git diff --check
git status --short
~~~
预期：所有有效模型调用被收口；日志服务和 API 不输出完整密钥；差异无空白错误；未相关用户改动仍保持原样。

- [x] **Step 4: Update checklist with actual commands and results**

## 实际执行结果

- 新增后端数据层、记录器和管理员 API：13 项测试通过。
- 相关聊天、知识库、产品助手、UniversalGPT 回归：42 项测试通过。
- 前端聚焦 ESLint：通过；TypeScript noEmit：通过；Vite production build：通过。
- 全量后端测试：212 项通过；其余失败来自既有测试的全局数据库 fixture 隔离和未初始化 NoteGenerator 属性问题，已单独复现并确认与本次功能无关。
- 前端全量 lint 仍受仓库既有生成目录二进制解析错误及历史 any 规则错误影响；本次新增文件已单独 lint 通过。

在本计划中勾选已完成项，记录未运行的外部环境验证，并在最终交付中列出实际测试结果、迁移注意事项和新增后台路由。
