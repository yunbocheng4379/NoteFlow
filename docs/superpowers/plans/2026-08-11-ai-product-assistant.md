# NoteFlow AI Product Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在登录后的 NoteFlow 工作台右下角交付可替换角色“小流”、独立产品文档 RAG、SSE 流式问答和可追溯来源展示。

**Architecture:** 前端在受保护的 `Index` 布局中挂载全局 `WorkspaceAssistant`，用 Zustand 保留跨子路由会话；后端新增独立 `/assistant/ask_stream` 路由，读取 `backend/app/assistant/knowledge/*.md`，用现有本地 hash embedding + Chroma 检索产品文档，再通过当前用户可用的第一个 normal 模型流式生成答案。客服不读取用户笔记，也不扣用户电力。

**Tech Stack:** FastAPI, Pydantic, ChromaDB, existing OpenAI-compatible provider factory, React 19, TypeScript, Zustand, Tailwind CSS, `react-markdown`, SSE via `fetch`.

## Global Constraints

- 客服只在登录后的受保护工作台显示，登录页、介绍页和其它公开页面不显示。
- 回答只围绕 NoteFlow 产品文档；资料不足时明确说明，不编造、不回答泛领域问题。
- 第一版不扣减用户电力；不读取用户私人笔记、转录或账户明细。
- 复用现有 `LocalHashEmbeddingFunction` 和 `VECTOR_DB_DIR`，不新增在线 embedding 下载依赖。
- 保留工作区既有未提交改动；每次提交只包含本计划对应文件。
- 遵守现有前端 2 空格、单引号、TypeScript strict 和后端类型标注风格。

---

### Task 1: 建立产品帮助文档与可检索切块

**Files:**
- Create: `backend/app/assistant/__init__.py`
- Create: `backend/app/assistant/knowledge/quick-start.md`
- Create: `backend/app/assistant/knowledge/features.md`
- Create: `backend/app/assistant/knowledge/troubleshooting.md`
- Create: `backend/app/services/product_assistant_store.py`
- Test: `backend/tests/test_product_assistant.py`

**Interfaces:**
- Produces `ProductAssistantStore.ensure_index() -> None`.
- Produces `ProductAssistantStore.query(question: str, n_results: int = 5) -> list[dict]`.
- Produces pure helper `_chunk_product_markdown(markdown: str, source_title: str) -> list[dict]` for unit tests.

- [ ] **Step 1: Write the failing chunking tests**

```python
from app.services.product_assistant_store import _chunk_product_markdown


def test_product_markdown_chunks_keep_section_metadata():
    chunks = _chunk_product_markdown(
        "# 快速开始\n\n简介内容足够长，说明 NoteFlow 的用途。\n\n"
        "## 视频转笔记\n\n把视频链接交给 NoteFlow 后会自动转写并生成结构化笔记。\n\n"
        "### 本地视频\n\n也可以上传本地视频进行转写和笔记生成。",
        "快速开始",
    )

    assert [item["metadata"]["section_title"] for item in chunks] == [
        "视频转笔记",
        "本地视频",
    ]
    assert all(item["metadata"]["source_type"] == "product_doc" for item in chunks)
    assert all(item["metadata"]["title"] == "快速开始" for item in chunks)


def test_product_markdown_ignores_short_heading_only_sections():
    assert _chunk_product_markdown("## 空标题\n\n太短", "测试") == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/test_product_assistant.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.product_assistant_store'`.

- [ ] **Step 3: Add the product knowledge documents**

`quick-start.md` must contain sections `## NoteFlow 是什么`, `## 视频转笔记`, `## 支持的平台`, `## 第一次使用` and state that NoteFlow turns Bilibili, YouTube, Douyin, Kuaishou, or local video into structured Markdown notes.

`features.md` must contain sections `## 笔记与导出`, `## 知识库问答`, `## 模型与转写配置`, `## 任务与合集` and describe the existing routes without claiming unsupported behavior.

`troubleshooting.md` must contain sections `## 视频无法下载`, `## 转写或生成失败`, `## 模型不可用`, `## 电力不足` and give the user the existing UI path to check.

- [ ] **Step 4: Implement the minimal Chroma-backed store**

```python
class ProductAssistantStore:
    COLLECTION_NAME = "noteflow_product_assistant"

    def ensure_index(self) -> None: ...

    def query(self, question: str, n_results: int = 5) -> list[dict]: ...
```

Implementation requirements: resolve the knowledge directory from `Path(__file__).resolve().parents[1] / "assistant" / "knowledge"`; read only `.md` files; compute one SHA-256 fingerprint over file names and contents; store the fingerprint in collection metadata; if the collection exists with the same fingerprint, reuse it; otherwise delete and recreate it with `LocalHashEmbeddingFunction`; use document IDs `product_doc_{index}`; parse Chroma results into `text`, `metadata`, and `distance`; return `[]` when the collection cannot be read.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/test_product_assistant.py -q`

Expected: the two chunking tests pass.

- [ ] **Step 6: Commit the self-contained knowledge-store change**

```bash
git add backend/app/assistant backend/app/services/product_assistant_store.py backend/tests/test_product_assistant.py
git commit -m "feat: add product assistant knowledge index"
```

### Task 2: Add the authenticated streaming assistant API

**Files:**
- Create: `backend/app/services/product_assistant_service.py`
- Create: `backend/app/routers/assistant.py`
- Modify: `backend/app/__init__.py`
- Test: `backend/tests/test_product_assistant.py`

**Interfaces:**
- Produces `PRODUCT_ASSISTANT_SYSTEM_PROMPT`.
- Produces `product_assistant_stream(question: str, history: list[dict]) -> Iterator[dict]`.
- Adds `POST /api/assistant/ask_stream` with request `{question: str, history: list[AssistantMessage]}`.

- [ ] **Step 1: Write failing service tests for scope and model selection**

```python
from app.services.product_assistant_service import build_product_assistant_messages


def test_product_assistant_prompt_forbids_private_note_claims():
    messages = build_product_assistant_messages(
        "我的某条笔记里说了什么？", [],
        [{"text": "NoteFlow 可将视频转成结构化 Markdown 笔记。", "metadata": {"title": "快速开始", "section_title": "视频转笔记"}}],
    )

    system = messages[0]["content"]
    assert "只依据产品资料" in system
    assert "不会读取用户私人笔记" in system
    assert messages[-1]["content"] == "我的某条笔记里说了什么？"


def test_product_assistant_messages_keep_only_recent_history():
    history = [{"role": "user", "content": str(i)} for i in range(25)]
    messages = build_product_assistant_messages("现在的问题", history, [])
    assert [item["content"] for item in messages[1:-1]] == [str(i) for i in range(5, 25)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/test_product_assistant.py -q`

Expected: FAIL with an import error for `product_assistant_service`.

- [ ] **Step 3: Implement the prompt and provider selection**

`build_product_assistant_messages(question, history, chunks)` must build a system message containing the retrieved text, explicit product-only scope, a Chinese-answer requirement, and the fallback sentence “当前产品资料不足，我不想猜测”。 It must append at most the last 20 valid user/assistant history items and then the current user question.

`product_assistant_stream` must:

1. Call `ProductAssistantStore().ensure_index()` and query five chunks.
2. Yield `{"type": "sources", "sources": [...]}` before the model call. Source entries contain `title`, `section_title`, `text` (max 200 chars), and `source_type: "product_doc"`.
3. Call `ModelService.get_all_models(tier_filter=["normal"])`; if empty, raise `ValueError("当前还没有配置可用的 AI 模型，请先到设置中完成配置。")`; use the first model’s `provider_id` and `model_name`, then `ProviderService.get_provider_by_id` and `GPTFactory.from_config`.
4. Stream `gpt.client.chat.completions.create(model=gpt.model, messages=messages, temperature=0.3, stream=True)` and yield `{"type":"delta","content":...}` for non-empty text chunks, then `{"type":"done"}`.
5. Log internal exceptions server-side and yield only `{"type":"error","message":"AI 客服暂时无法回答，请稍后重试。"}` to callers.

- [ ] **Step 4: Add route validation and router registration**

Use `get_current_user` in the route. Define:

```python
class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AssistantAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[AssistantMessage] = Field(default_factory=list, max_length=20)
```

Strip `question`, reject blank content with `R.error(msg="请输入问题后再发送")`, pass plain dicts to the service, and wrap the generator in `StreamingResponse(media_type="text/event-stream", headers={"Cache-Control":"no-cache", "X-Accel-Buffering":"no"})`. Register `assistant.router` with prefix `/api` in `backend/app/__init__.py`.

- [ ] **Step 5: Run focused backend tests and import verification**

Run: `cd backend && pytest tests/test_product_assistant.py -q && python -c "import app.routers.assistant"`

Expected: all focused tests pass and the import command exits 0.

- [ ] **Step 6: Commit the API change**

```bash
git add backend/app/services/product_assistant_service.py backend/app/routers/assistant.py backend/app/__init__.py backend/tests/test_product_assistant.py
git commit -m "feat: add streaming product assistant API"
```

### Task 3: Add frontend SSE client and session state

**Files:**
- Create: `NoteFlow_frontend/src/services/assistant.ts`
- Create: `NoteFlow_frontend/src/store/assistantStore/index.ts`
- Test: `NoteFlow_frontend/src/services/assistant.test.ts` (if Vitest is unavailable, use TypeScript typecheck/build as the executable verification for this client).

**Interfaces:**
- Produces `AssistantMessage`, `AssistantSource`, `AssistantStreamEvent` types.
- Produces `askAssistantStream(data, handlers): Promise<void>`.
- Produces Zustand state `{messages, addMessage, appendToLastMessage, setLastMessageSources, clear}`.

- [ ] **Step 1: Write the failing SSE parser test or type-level contract**

The test must prove that an SSE payload containing `sources`, two `delta` events, and `done` dispatches callbacks in order and concatenates no data outside events. If the repository has no Vitest runner, create the exported `parseAssistantSseEvent(raw: string): AssistantStreamEvent | null` contract and make `pnpm exec tsc --noEmit` fail before implementation because the module is missing.

- [ ] **Step 2: Verify the red state**

Run: `cd NoteFlow_frontend && pnpm exec tsc --noEmit`

Expected: FAIL because the new assistant module/types are not defined.

- [ ] **Step 3: Implement the client and store**

`askAssistantStream` must reuse the existing `/api` base URL and `noteflow-user` token lookup, POST JSON to `/assistant/ask_stream`, reject non-OK/no-body responses with `请求失败（状态码）`, split SSE events on blank lines, parse `data:` JSON, and dispatch `sources`, `delta`, `done`, and `error` callbacks. Add an `AbortSignal` option.

The Zustand store must keep `AssistantMessage[]`, cap the list at 40 messages after each add, append streamed content to the last assistant message, and replace sources on the last assistant message. Keep the store in memory only so logout cannot leak a prior user’s support conversation.

- [ ] **Step 4: Verify the green state**

Run: `cd NoteFlow_frontend && pnpm exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit the client contract**

```bash
git add NoteFlow_frontend/src/services/assistant.ts NoteFlow_frontend/src/store/assistantStore
git commit -m "feat: add product assistant client state"
```

### Task 4: Build the right-bottom mascot and chat panel

**Files:**
- Create: `NoteFlow_frontend/src/components/AssistantPanel.tsx`
- Create: `NoteFlow_frontend/src/components/WorkspaceAssistant.tsx`
- Modify: `NoteFlow_frontend/src/pages/Index.tsx`
- Modify: `NoteFlow_frontend/src/index.css`
- Use: `NoteFlow_frontend/src/assets/assistant/xiaoliu.png`

**Interfaces:**
- `WorkspaceAssistant` has no required props and is mounted only in `Index`.
- `AssistantPanel` consumes the assistant store and `askAssistantStream`.

- [ ] **Step 1: Write a failing component contract check**

Add a small test if the existing frontend test setup supports React tests; otherwise use the build as the red check by importing the not-yet-created component from `Index.tsx` and running `pnpm build`. The required accessible contract is:

```tsx
<button aria-label="打开小流 AI 客服" />
<section aria-label="小流 AI 客服" />
<textarea aria-label="输入你想了解的问题" />
```

- [ ] **Step 2: Verify the red state**

Run: `cd NoteFlow_frontend && pnpm build`

Expected: FAIL because `WorkspaceAssistant` is not defined.

- [ ] **Step 3: Implement the panel**

Use the approved palette and dimensions. The closed state is a fixed 64px launcher with the transparent PNG inside a clipped circular/soft capsule frame; the open state is a fixed bottom-right 360×520 card. Render the welcome copy and four quick questions when there are no messages. Render user/assistant bubbles, `react-markdown` for assistant content, a collapsible “参考产品文档” row for sources, loading text “正在整理产品资料…”, and retry text after an error.

Use a controlled `<textarea>`: Enter without Shift sends, Shift+Enter inserts a newline; ignore blank input and disable while streaming. Keep a `requestId`/`AbortController` ref so closing the panel does not produce set-state-after-unmount behavior. On stream error, append the message to the assistant bubble and allow a new send after `loading` returns false.

Add `role="dialog"`, `aria-modal="false"`, visible `focus-visible` styles, `aria-expanded` on the launcher, and close on Escape. Add `@media (prefers-reduced-motion: reduce)` to disable launcher and panel transitions.

- [ ] **Step 4: Mount only inside the protected layout**

In `Index.tsx`, render `<WorkspaceAssistant />` beside `<Outlet />`, after the main content container. Do not add it to `App.tsx`, `RootLayout.tsx`, public routes, the browser extension, or the login page.

- [ ] **Step 5: Verify the green state**

Run: `cd NoteFlow_frontend && pnpm build && pnpm lint`

Expected: both commands exit 0 with no TypeScript or ESLint errors.

- [ ] **Step 6: Commit the UI change**

```bash
git add NoteFlow_frontend/src/components/AssistantPanel.tsx NoteFlow_frontend/src/components/WorkspaceAssistant.tsx NoteFlow_frontend/src/pages/Index.tsx NoteFlow_frontend/src/index.css
git commit -m "feat: add Xiaoliu workspace assistant UI"
```

### Task 5: Integration, regression checks, and cleanup

**Files:**
- Modify: `backend/tests/test_product_assistant.py` if additional regression coverage is needed.
- Modify: `NoteFlow_frontend/src/store/userStore/index.ts` only if logout needs explicit assistant state clearing; otherwise no change.

- [ ] **Step 1: Add endpoint behavior tests before integration fixes**

Cover question trimming/blank rejection, history role validation, and the no-model error message through pure route helpers or a FastAPI test client using existing auth fixtures. Do not make a real provider call in tests.

- [ ] **Step 2: Run backend focused and existing RAG tests**

Run: `cd backend && pytest tests/test_product_assistant.py tests/test_knowledge_base_service.py tests/test_vector_store_query_multi.py -q`

Expected: exit 0; any unrelated pre-existing failure must be reported with the exact failing test.

- [ ] **Step 3: Run frontend full verification**

Run: `cd NoteFlow_frontend && pnpm lint && pnpm build`

Expected: exit 0.

- [ ] **Step 4: Inspect the final diff and working tree**

Run: `git diff --check && git status --short && git diff --stat HEAD~4..HEAD`

Confirm only the assistant commits contain assistant files; do not stage or revert the pre-existing unrelated worktree changes.

- [ ] **Step 5: Commit any final test-only correction**

```bash
git add backend/tests/test_product_assistant.py NoteFlow_frontend/src/services/assistant.ts NoteFlow_frontend/src/store/assistantStore/index.ts
git commit -m "test: verify product assistant integration"
```

## Verification Summary

Before reporting completion, run all of the following fresh:

```bash
cd backend && pytest tests/test_product_assistant.py tests/test_knowledge_base_service.py tests/test_vector_store_query_multi.py -q
cd ../NoteFlow_frontend && pnpm lint && pnpm build
cd .. && git diff --check
```

Report exact pass/fail counts and any unrelated failures; do not claim the feature is complete without fresh output from these commands.
