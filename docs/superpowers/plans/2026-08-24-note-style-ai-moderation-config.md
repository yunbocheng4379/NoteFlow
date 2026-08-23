# 笔记风格 AI 初筛模型配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员从现有模型配置中选择笔记风格安全检测模型，并将 AI 初筛结果提供给人工审核员。

**Architecture:** 新增系统级键值配置保存供应商和模型名称；内容审核服务读取该配置并复用现有 `ProviderService -> ModelConfig -> GPTFactory` 调用链。用户提交后 AI 只生成风险分析，审核状态仍由 `NoteStyleModerationService` 的人工操作接口决定；管理员在模型配置页选择模型，在审核详情页查看结果。

**Tech Stack:** FastAPI、SQLAlchemy、SQLite/MySQL、现有 OpenAI-compatible GPTFactory、React 19、TypeScript、Vite、Tailwind。

## Global Constraints

- 不新增第二套 API Key 或供应商配置；必须复用 `providers` 和 `models` 表。
- AI 结果不能自动改变人工审核状态；AI 未配置或失败时必须继续进入人工审核。
- API Key 不得通过配置查询接口返回。
- 不覆盖工作区中已有的用户改动；只修改本功能所需文件。
- 测试完成后删除临时测试代码和临时 Markdown；正式设计文档与实施计划保留。

---

### Task 1: 系统级安全检测模型配置持久化

**Files:**
- Create: `backend/app/db/models/system_settings.py`
- Create: `backend/app/db/system_settings_dao.py`
- Modify: `backend/app/db/models/__init__.py`
- Modify: `backend/app/db/init_db.py`
- Test: `backend/tests/test_note_style_ai_config.py`

**Interfaces:**
- `system_settings_dao.get_value(key: str) -> str | None`
- `system_settings_dao.set_value(key: str, value: str, updated_by: int | None) -> None`
- `system_settings_dao.get_note_style_moderation_model() -> dict | None`
- `system_settings_dao.set_note_style_moderation_model(provider_id: str, model_name: str, updated_by: int) -> dict`

- [ ] **Step 1: Write the failing test**

```python
def test_note_style_moderation_model_round_trip(db_session, monkeypatch):
    monkeypatch.setattr(system_settings_dao, "SessionLocal", lambda: db_session)
    assert system_settings_dao.get_note_style_moderation_model() is None
    saved = system_settings_dao.set_note_style_moderation_model("provider-a", "model-a", 7)
    assert saved == {"provider_id": "provider-a", "model_name": "model-a"}
    assert system_settings_dao.get_note_style_moderation_model() == saved
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_note_style_ai_config.py::test_note_style_moderation_model_round_trip -q`

Expected: FAIL because the system settings model and DAO do not exist.

- [ ] **Step 3: Write minimal implementation**

Create an `app_settings` table with `key` as the primary key, a text `value`, `updated_by`, and `updated_at`. Store the selected model as JSON under the key `note_style_moderation_model`; load and validate JSON before returning it. Import the model before `Base.metadata.create_all` so new installations create the table.

- [ ] **Step 4: Run test to verify it passes**

Run the same pytest command and expect one passing test.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models/system_settings.py backend/app/db/system_settings_dao.py backend/app/db/models/__init__.py backend/app/db/init_db.py backend/tests/test_note_style_ai_config.py
git commit -m "feat: persist note style moderation model setting"
```

### Task 2: 管理员配置 API 和复用模型的 AI 初筛服务

**Files:**
- Create: `backend/app/routers/admin_content_moderation.py`
- Modify: `backend/app/__init__.py`
- Modify: `backend/app/services/content_moderation_service.py`
- Modify: `backend/app/services/llm_helper.py`
- Modify: `backend/app/db/models/note_style_versions.py`
- Modify: `backend/app/db/models/note_style_reviews.py`
- Modify: `backend/app/db/note_style_dao.py`
- Modify: `backend/app/services/note_style_moderation_service.py`
- Modify: `backend/app/db/init_db.py`
- Modify: `backend/init.sql`
- Test: `backend/tests/test_content_moderation_service.py`

**Interfaces:**
- `GET /api/admin/content_moderation/config` returns `{configured, selected, models}` without API keys.
- `PUT /api/admin/content_moderation/config` accepts `{provider_id: str, model_name: str}` and validates enabled provider/model.
- `ContentModerationService.screen(...) -> dict` returns normalized `status`, `risk_level`, `categories`, `summary`, `recommendations`, `provider`, and `model_name`.

- [ ] **Step 1: Write the failing tests**

Cover three independent behaviors:

```python
def test_screen_uses_selected_model_and_normalizes_json(monkeypatch):
    monkeypatch.setattr(system_settings_dao, "get_note_style_moderation_model", lambda: {
        "provider_id": "provider-a", "model_name": "model-a"
    })
    monkeypatch.setattr(llm_helper, "simple_completion", lambda **kwargs: '{"status":"risk","risk_level":"high","categories":["sexual"],"summary":"存在风险","recommendations":["删除相关内容"]}')
    result = ContentModerationService.screen(name="x", description="y", prompt="z")
    assert result["status"] == "risk"
    assert result["recommendations"] == ["删除相关内容"]

def test_screen_without_model_keeps_manual_review(monkeypatch):
    monkeypatch.setattr(system_settings_dao, "get_note_style_moderation_model", lambda: None)
    result = ContentModerationService.screen(name="x", description=None, prompt="z")
    assert result["status"] == "not_configured"

def test_screen_failure_does_not_auto_pass(monkeypatch):
    monkeypatch.setattr(system_settings_dao, "get_note_style_moderation_model", lambda: {"provider_id":"p", "model_name":"m"})
    monkeypatch.setattr(llm_helper, "simple_completion", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("timeout")))
    result = ContentModerationService.screen(name="x", description=None, prompt="z")
    assert result["status"] == "failed"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_content_moderation_service.py -q`

Expected: FAIL because the service still reads only `CONTENT_MODERATION_ENDPOINT` and does not return recommendations.

- [ ] **Step 3: Write minimal implementation**

Add `recommendations` and selected model metadata to version/review snapshots. Update `simple_completion` to accept an optional `temperature` and keep the existing call signature compatible. Build a strict Chinese JSON moderation prompt, call the selected existing model, strip Markdown code fences, parse JSON, normalize list/string fields, and return `failed` on API or parse errors. Keep the local rule short-circuit as a high-risk result. Update note-style submit persistence and review records to store recommendations, and add idempotent migration columns for existing databases.

- [ ] **Step 4: Add and run API/config tests**

Test that a disabled provider or unknown model returns HTTP 400, a valid selection hides API keys, and a non-admin receives HTTP 403. Run: `cd backend && python -m pytest tests/test_note_style_ai_config.py tests/test_content_moderation_service.py -q`.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/init.sql backend/tests/test_note_style_ai_config.py backend/tests/test_content_moderation_service.py
git commit -m "feat: add configurable ai moderation screening"
```

### Task 3: 模型配置页增加安全检测模型选择器

**Files:**
- Create: `NoteFlow_frontend/src/services/content_moderation.ts`
- Create: `NoteFlow_frontend/src/components/Form/modelForm/ContentModerationConfig.tsx`
- Modify: `NoteFlow_frontend/src/pages/SettingPage/Model.tsx`
- Test: `NoteFlow_frontend/src/components/Form/modelForm/ContentModerationConfig.test.tsx`

**Interfaces:**
- `contentModerationApi.getConfig()` loads available models and selected model.
- `contentModerationApi.updateConfig(providerId, modelName)` saves the selection.

- [ ] **Step 1: Write the failing component test**

Render the card with a mocked API response, assert the selected provider/model appear, change the model, click save, and assert the update API receives the new pair. Also assert the unconfigured state displays “未配置”。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd NoteFlow_frontend && pnpm vitest run src/components/Form/modelForm/ContentModerationConfig.test.tsx`

Expected: FAIL because the API module and component do not exist.

- [ ] **Step 3: Write minimal implementation**

Add a compact card beneath the provider list in the model configuration page. Group options by provider, show the current model and an “未配置” state, disable save while loading, and show success/error toast messages. Do not expose provider API keys.

- [ ] **Step 4: Run frontend test and type check**

Run: `cd NoteFlow_frontend && pnpm vitest run src/components/Form/modelForm/ContentModerationConfig.test.tsx && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add NoteFlow_frontend/src/services/content_moderation.ts NoteFlow_frontend/src/components/Form/modelForm/ContentModerationConfig.tsx NoteFlow_frontend/src/pages/SettingPage/Model.tsx NoteFlow_frontend/src/components/Form/modelForm/ContentModerationConfig.test.tsx
git commit -m "feat: add moderation model selector"
```

### Task 4: 管理员审核详情展示完整 AI 建议

**Files:**
- Modify: `NoteFlow_frontend/src/services/note_style_moderation.ts`
- Modify: `NoteFlow_frontend/src/pages/SettingPage/NoteStyleModeration.tsx`
- Test: `NoteFlow_frontend/src/pages/SettingPage/NoteStyleModeration.test.tsx`

**Interfaces:**
- The moderation detail uses `ai_categories`, `ai_summary`, and `ai_recommendations` returned by the backend.

- [ ] **Step 1: Write the failing test**

Assert that a selected pending style renders “AI 初筛建议”, risk categories, summary, and each recommendation, while a `not_configured` result renders “未配置安全检测模型，请人工审核”。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd NoteFlow_frontend && pnpm vitest run src/pages/SettingPage/NoteStyleModeration.test.tsx`

Expected: FAIL because recommendations are not part of the type or detail panel.

- [ ] **Step 3: Write minimal implementation**

Add the field to the TypeScript interface, parse category/recommendation values when they arrive as JSON strings, and render human-readable labels in the existing dialog without adding any automatic approve/reject button.

- [ ] **Step 4: Run test and build**

Run: `cd NoteFlow_frontend && pnpm vitest run src/pages/SettingPage/NoteStyleModeration.test.tsx && pnpm build`.

- [ ] **Step 5: Commit**

```bash
git add NoteFlow_frontend/src/services/note_style_moderation.ts NoteFlow_frontend/src/pages/SettingPage/NoteStyleModeration.tsx NoteFlow_frontend/src/pages/SettingPage/NoteStyleModeration.test.tsx
git commit -m "feat: show ai moderation recommendations"
```

### Task 5: 集成回归、三轮完整测试与清理

**Files:**
- Modify only files proven necessary by failing tests.
- Delete: temporary test scripts and temporary Markdown files created during implementation.

- [ ] **Step 1: Run complete backend test cycle**

Run: `cd backend && python -m pytest -q`.

- [ ] **Step 2: Run complete frontend verification**

Run: `cd NoteFlow_frontend && pnpm exec tsc --noEmit && pnpm build`.

- [ ] **Step 3: Run three independent end-to-end moderation flows**

1. Configure model → submit safe style → verify AI `passed` result → manually approve → verify public listing.
2. Configure model → submit risky style → verify AI `risk` result and recommendations → manually reject → verify user notification and no public listing.
3. Remove/disable model configuration → submit style → verify `not_configured` or `failed` → verify item remains pending and can be manually approved/rejected.

- [ ] **Step 4: Run hygiene checks**

Run: `git diff --check` and `rg --files -g '*test*' -g '*.md'` to identify only intentional tests and formal documentation. Remove only temporary files created for this task; retain formal spec/plan and project documentation.

- [ ] **Step 5: Review final diff**

Run: `git status --short` and `git diff --stat`; confirm unrelated pre-existing changes remain untouched and no API key is present in frontend responses.

