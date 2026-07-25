# 知识库跨笔记 AI 问答 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pro-only "知识库" (Knowledge Base) feature that lets a user ask AI questions across all their own notes, with model selection, streamed answers (SSE), an optional streamed "深度思考" reasoning trace, and multi-conversation history — without modifying the existing single-note `/chat/*` Q&A system.

**Architecture:** A new, parallel backend subsystem (`app/services/knowledge_base_service.py`, `app/routers/knowledge_base.py` at `/kb`, `app/db/kb_dao.py`) reuses `VectorStoreManager` (via a new `query_multi` cross-collection method), `GPTFactory`/`ProviderService`/`ModelConfig`, and the project's SQLAlchemy-model + `migrate_add_xxx.py` + `sql/migrate_add_xxx.sql` three-artifact DB convention. A new persisted `kb_index_status` table replaces the in-memory `_index_status` dict in `routers/chat.py` (shared by both `/chat/*` and `/kb/*`). A new `models.supports_reasoning` column, set via an admin toggle mirroring the existing `tier` toggle, gates the deep-thinking UI per model. Frontend adds `pages/KnowledgeBasePage/`, `store/knowledgeBaseStore/`, `services/knowledgeBase.ts`, a sidebar nav entry, and an App.tsx route — all following existing patterns (`ChatPanel.tsx`'s SSE/Bubble.List usage, `CollectionPage`'s list+dialog pattern, `Form.tsx`'s Pro-badge/tier-toggle styling).

**Tech Stack:** FastAPI + SQLAlchemy + MySQL (backend), ChromaDB `PersistentClient` (vector store), openai SDK 1.70.0 `stream=True` completions, React 19 + Zustand + `@ant-design/x` (`Bubble`/`Sender`) + `react-markdown`/`remark-gfm`/`remark-math`/`rehype-katex` (frontend). Backend runs under `/opt/anaconda3/bin/python3`; tests via `pytest` against the real local MySQL DB (`noteflow` schema, reachable at `127.0.0.1:3306`, confirmed 24 existing tables, no `kb_*` tables yet).

## Global Constraints

- Do NOT modify `app/services/chat_service.py`, `app/services/chat_tools.py`, or the existing single-note `/chat/ask` / `/chat/ask_stream` request/response contracts — the KB feature is fully parallel.
- The one approved exception: `routers/chat.py`'s in-memory `_index_status` dict must be replaced with reads/writes to the new persisted `kb_index_status` table (approved as an incidental fix, same PR).
- All new DB schema changes ship as three artifacts: SQLAlchemy model (imported into `app/db/init_db.py`) + `app/db/migrate_add_xxx.py` (idempotent, `SHOW COLUMNS`/`information_schema` guarded) + `sql/migrate_add_xxx.sql` (raw SQL, `USE noteflow;`, `CREATE TABLE IF NOT EXISTS ... ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).
- Every `migrate_add_xxx.py` script MUST actually be executed against the local MySQL DB as part of its task (via `/opt/anaconda3/bin/python3 -m app.db.migrate_add_xxx` from `backend/`), not just written — per explicit user instruction.
- `/kb/*` endpoints all require `get_current_user`; `/kb/ask_stream` additionally requires Pro (`user.active_subscription_id` not null) via a new `_require_pro` helper, mirroring `app/routers/model.py`'s `_tier_filter_for`.
- Reasoning/deep-thinking parameters (`reasoning_content` read, `extra_body={"enable_thinking": True}`) are only ever sent/read when `enable_thinking=True` in the request AND the resolved model has `supports_reasoning=1` in the DB — never speculatively.
- Context sent to the LLM per turn: last 20 `kb_messages` rows' `content` only, never `reasoning_content`.
- No Function Calling / tool calling in the KB flow (pure RAG) — this differs deliberately from `chat_service.py`'s tool-calling loop.
- No timestamp-jump citation UI, no collection/subset retrieval filtering — both explicitly out of scope per the approved spec.
- Frontend: no new test framework — verification is `npx tsc --noEmit`, `pnpm build`, `pnpm lint` only (confirmed no vitest/jest exists in `NoteFlow_frontend`).
- Backend commands run from `backend/` using `/opt/anaconda3/bin/python3` (confirmed working interpreter with openai/fastapi/sqlalchemy/pytest/chromadb installed); frontend commands run from `NoteFlow_frontend/` using `pnpm`.

---

## Task 1: `kb_index_status` table + persist `routers/chat.py`'s index status

**Files:**
- Create: `backend/app/db/models/kb_index_status.py`
- Create: `backend/app/db/kb_index_status_dao.py`
- Create: `backend/app/db/migrate_add_kb_index_status.py`
- Create: `backend/sql/migrate_add_kb_index_status.sql`
- Modify: `backend/app/db/init_db.py:5` (add import)
- Modify: `backend/app/routers/chat.py` (replace `_index_status` dict with DAO calls)
- Test: `backend/tests/test_kb_index_status_dao.py`

**Interfaces:**
- Consumes: `app.db.engine.get_db`, `app.db.engine.Base` (existing).
- Produces (for later tasks): `app.db.kb_index_status_dao.get_status(task_id: str) -> Optional[str]`, `set_status(task_id: str, status: str) -> None`, `get_statuses(task_ids: list[str]) -> dict[str, str]` (task_id → status, only rows that exist).

- [ ] **Step 1: Write the model**

`backend/app/db/models/kb_index_status.py`:
```python
from sqlalchemy import Column, String, DateTime, func

from app.db.engine import Base


class KbIndexStatus(Base):
    """笔记向量索引状态（持久化），供 /chat/* 与 /kb/* 共用，替代原先进程内 dict"""
    __tablename__ = "kb_index_status"

    task_id = Column(String(64), primary_key=True, comment="对应 video_tasks.task_id")
    status = Column(String(16), nullable=False, comment="索引状态：indexing / indexed / failed")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近状态变更时间")
```

- [ ] **Step 2: Write the DAO**

`backend/app/db/kb_index_status_dao.py`:
```python
from typing import Optional

from app.db.engine import get_db
from app.db.models.kb_index_status import KbIndexStatus
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_status(task_id: str) -> Optional[str]:
    db = next(get_db())
    try:
        row = db.query(KbIndexStatus).filter_by(task_id=task_id).first()
        return row.status if row else None
    finally:
        db.close()


def set_status(task_id: str, status: str) -> None:
    db = next(get_db())
    try:
        row = db.query(KbIndexStatus).filter_by(task_id=task_id).first()
        if row:
            row.status = status
        else:
            db.add(KbIndexStatus(task_id=task_id, status=status))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"set_status (kb_index_status) failed: task_id={task_id}, {e}")
    finally:
        db.close()


def get_statuses(task_ids: list[str]) -> dict:
    if not task_ids:
        return {}
    db = next(get_db())
    try:
        rows = db.query(KbIndexStatus).filter(KbIndexStatus.task_id.in_(task_ids)).all()
        return {r.task_id: r.status for r in rows}
    finally:
        db.close()
```

- [ ] **Step 3: Write the migration script**

`backend/app/db/migrate_add_kb_index_status.py`:
```python
"""
迁移：创建 kb_index_status 表（笔记向量索引状态，持久化）。

说明
----
- 替代 routers/chat.py 中原先的进程内 dict `_index_status`（重启即丢失）。
- /chat/* 与 /kb/* 共用同一份索引状态。
- 完整字段说明见 ``app/db/models/kb_index_status.py``。

用法:
    python -m app.db.migrate_add_kb_index_status

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db()（Base.metadata.create_all 已包含该表）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE = """
CREATE TABLE IF NOT EXISTS kb_index_status (
  task_id     VARCHAR(64) NOT NULL                                COMMENT '对应 video_tasks.task_id',
  status      VARCHAR(16) NOT NULL                                COMMENT '索引状态：indexing / indexed / failed',
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近状态变更时间',
  PRIMARY KEY (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :t"
        ),
        {"t": table_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _table_exists(conn, "kb_index_status"):
            conn.execute(text(SQL_CREATE))
            print("  created table: kb_index_status")
        else:
            print("  skipped (exists): kb_index_status table")

    print("Migration done.")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: Write the raw SQL counterpart**

`backend/sql/migrate_add_kb_index_status.sql`:
```sql
-- =============================================================================
-- NoteFlow 知识库索引状态表迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_kb_index_status.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_kb_index_status.sql
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS kb_index_status (
  task_id     VARCHAR(64) NOT NULL                                COMMENT '对应 video_tasks.task_id',
  status      VARCHAR(16) NOT NULL                                COMMENT '索引状态：indexing / indexed / failed',
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近状态变更时间',
  PRIMARY KEY (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 5: Register the model in `init_db.py`**

In `backend/app/db/init_db.py`, add after line 4 (`from app.db.models.video_tasks import VideoTask`):
```python
from app.db.models.kb_index_status import KbIndexStatus
```

- [ ] **Step 6: Run the migration against the local DB**

```bash
cd backend
/opt/anaconda3/bin/python3 -m app.db.migrate_add_kb_index_status
```
Expected output: `created table: kb_index_status` then `Migration done.` (confirms it actually ran against the local MySQL `noteflow` schema, not just written to disk).

- [ ] **Step 7: Write the DAO test**

`backend/tests/test_kb_index_status_dao.py`:
```python
"""kb_index_status_dao.py 集成测试 - 走真实 DB"""
import uuid

import app.db.init_db  # noqa: F401
from app.db.kb_index_status_dao import get_status, set_status, get_statuses


def test_set_and_get_status():
    task_id = f"test-{uuid.uuid4().hex[:8]}"
    assert get_status(task_id) is None

    set_status(task_id, "indexing")
    assert get_status(task_id) == "indexing"

    set_status(task_id, "indexed")
    assert get_status(task_id) == "indexed"


def test_get_statuses_batch():
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    task_c = f"test-{uuid.uuid4().hex[:8]}"  # never indexed

    set_status(task_a, "indexed")
    set_status(task_b, "failed")

    result = get_statuses([task_a, task_b, task_c])
    assert result == {task_a: "indexed", task_b: "failed"}
```

- [ ] **Step 8: Run the test**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_kb_index_status_dao.py -v
```
Expected: `2 passed`.

- [ ] **Step 9: Replace `routers/chat.py`'s in-memory dict with the DAO**

Replace the full content of `backend/app/routers/chat.py` lines 1-88 (everything up to and including `chat_status`) with:
```python
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.kb_index_status_dao import get_status as get_index_status, set_status as set_index_status
from app.db.models.users import User
from app.db.video_task_dao import get_task_by_task_id
from app.services.chat_service import chat as chat_service, chat_stream as chat_stream_service
from app.services.vector_store import VectorStoreManager
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


class IndexRequest(BaseModel):
    task_id: str


class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    task_id: str
    question: str
    history: list[ChatMessage] = []
    provider_id: str
    model_name: str


def _do_index(task_id: str):
    try:
        set_index_status(task_id, "indexing")
        store = VectorStoreManager()
        store.index_task(task_id)
        set_index_status(task_id, "indexed")
        logger.info(f"索引完成: {task_id}")
    except Exception as e:
        set_index_status(task_id, "failed")
        logger.error(f"索引失败: {task_id}, {e}")


@router.post("/chat/index")
def index_task(data: IndexRequest, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    # 校验 task 归属
    task = get_task_by_task_id(data.task_id)
    if task and task.user_id is not None and task.user_id != current_user.id:
        return R.error(msg="无权访问该任务", code=403)

    if get_index_status(data.task_id) == "indexing":
        return R.success(msg="正在索引中")

    store = VectorStoreManager()
    if store.is_indexed(data.task_id):
        set_index_status(data.task_id, "indexed")
        return R.success(msg="已完成索引")

    set_index_status(data.task_id, "indexing")
    background_tasks.add_task(_do_index, data.task_id)
    return R.success(msg="开始索引")


@router.get("/chat/status")
def chat_status(task_id: str, current_user: User = Depends(get_current_user)):
    try:
        task = get_task_by_task_id(task_id)
        if task and task.user_id is not None and task.user_id != current_user.id:
            return R.error(msg="无权访问该任务", code=403)

        status = get_index_status(task_id)
        if status:
            return R.success(data={"status": status, "indexed": status == "indexed"})

        store = VectorStoreManager()
        indexed = store.is_indexed(task_id)
        if indexed:
            set_index_status(task_id, "indexed")
        return R.success(data={"status": "indexed" if indexed else "idle", "indexed": indexed})
    except Exception as e:
        logger.error(f"查询索引状态失败: {e}")
        return R.success(data={"status": "idle", "indexed": False})
```
The remaining `/chat/ask` and `/chat/ask_stream` endpoints (current lines 90-155) are unchanged — leave them exactly as-is below this block.

- [ ] **Step 10: Manually verify `/chat/*` still works**

```bash
cd backend
/opt/anaconda3/bin/python3 -c "import app.routers.chat" 
```
Expected: no import errors (confirms the rewritten router module is syntactically valid and importable).

- [ ] **Step 11: Commit**

```bash
git add backend/app/db/models/kb_index_status.py backend/app/db/kb_index_status_dao.py backend/app/db/migrate_add_kb_index_status.py backend/sql/migrate_add_kb_index_status.sql backend/app/db/init_db.py backend/app/routers/chat.py backend/tests/test_kb_index_status_dao.py
git commit -m "feat: persist chat index status to kb_index_status table"
```

---

## Task 2: `models.supports_reasoning` column + admin toggle endpoint

**Files:**
- Modify: `backend/app/db/models/models.py` (add column)
- Create: `backend/app/db/migrate_add_model_supports_reasoning.py`
- Create: `backend/sql/migrate_add_model_supports_reasoning.sql`
- Modify: `backend/app/db/model_dao.py` (return + update `supports_reasoning`)
- Modify: `backend/app/services/model.py` (`_format_models`, new `set_model_supports_reasoning`)
- Modify: `backend/app/routers/model.py` (new `POST /models/{model_id}/supports_reasoning` endpoint)
- Modify: `NoteFlow_frontend/src/services/model.ts` (new `updateModelSupportsReasoning`)
- Modify: `NoteFlow_frontend/src/store/modelStore/index.ts` (new `updateModelSupportsReasoning` action, `supports_reasoning` field on `IModelListItem`)
- Modify: `NoteFlow_frontend/src/components/Form/modelForm/Form.tsx` (toggle UI next to the existing tier toggle)
- Test: `backend/tests/test_model_supports_reasoning.py`

**Interfaces:**
- Consumes: `app.db.engine.get_engine`/`get_db` (existing), `Model` SQLAlchemy model (existing, being extended).
- Produces (for later tasks): `Model.supports_reasoning` column (`int`, 0/1); `app.db.model_dao.get_model_by_provider_and_name(...)` and `get_all_models(...)` dicts now include a `"supports_reasoning": bool` key; `app.services.model.ModelService.set_model_supports_reasoning(model_id: int, enabled: bool) -> bool`.

- [ ] **Step 1: Add the column to the model**

In `backend/app/db/models/models.py`, add after the `tier` column:
```python
    supports_reasoning = Column(Integer, nullable=False, default=0, server_default="0",
                                 comment="是否原生支持深度思考(reasoning)：1=支持，0=不支持；仅管理员可勾选")
```
(`Integer` is already imported at the top of this file.)

- [ ] **Step 2: Write the migration script**

`backend/app/db/migrate_add_model_supports_reasoning.py`:
```python
"""
One-time migration: add supports_reasoning column to models table.

- 给 models 表加 supports_reasoning (TINYINT, default 0), 已存在则跳过.
- 取值: 1=该模型原生支持 reasoning/深度思考（如 deepseek-reasoner、Qwen thinking 系列），
        0=不支持。仅管理员在模型管理页勾选。

安全: 可重复运行.

用法:
  python -m app.db.migrate_add_model_supports_reasoning
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.db.engine import get_engine


def run():
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(text("SHOW COLUMNS FROM models"))
        existing = {row[0] for row in result}

        if "supports_reasoning" not in existing:
            conn.execute(text(
                "ALTER TABLE models ADD COLUMN supports_reasoning TINYINT NOT NULL DEFAULT 0"
            ))
            conn.commit()
            print("  added column: supports_reasoning")
        else:
            print("  skipped (exists): supports_reasoning")

    print("Migration done.")


if __name__ == "__main__":
    run()
```

- [ ] **Step 3: Write the raw SQL counterpart**

`backend/sql/migrate_add_model_supports_reasoning.sql`:
```sql
-- =============================================================================
-- NoteFlow 模型深度思考支持标记迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_model_supports_reasoning.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_model_supports_reasoning.sql
-- =============================================================================
USE noteflow;

ALTER TABLE models ADD COLUMN supports_reasoning TINYINT NOT NULL DEFAULT 0
  COMMENT '是否原生支持深度思考(reasoning)：1=支持，0=不支持';
```
(No `IF NOT EXISTS` guard — confirmed against the local MySQL 9.6.0 server that `ADD COLUMN IF NOT EXISTS` raises a syntax error here; this matches the existing raw-SQL files in `sql/`, e.g. `billing_init.sql`, which are one-time manual-execution scripts without idempotency guards. The idempotent path is the Python migration script in Step 2, which the "actually run it" step below uses.)

- [ ] **Step 4: Run the migration against the local DB**

```bash
cd backend
/opt/anaconda3/bin/python3 -m app.db.migrate_add_model_supports_reasoning
```
Expected output: `added column: supports_reasoning` then `Migration done.`

- [ ] **Step 5: Update the DAO to read/write the new column**

In `backend/app/db/model_dao.py`, update `get_model_by_provider_and_name` (add `"supports_reasoning": bool(model.supports_reasoning)` to both returned dicts), `insert_model` (accept `supports_reasoning: int = 0` param, pass through to `Model(...)`, include in returned dict), `get_all_models` (add `"supports_reasoning": bool(m.supports_reasoning)` to the returned dict), and add a new function:
```python
def update_model_supports_reasoning(model_id: int, enabled: bool) -> bool:
    """更新模型是否支持深度思考（仅管理员可调用）"""
    db = next(get_db())
    try:
        model = db.query(Model).filter_by(id=model_id).first()
        if not model:
            return False
        model.supports_reasoning = 1 if enabled else 0
        db.commit()
        return True
    finally:
        db.close()
```

- [ ] **Step 6: Add the service method**

In `backend/app/services/model.py`, update `_format_models` to include `"supports_reasoning": bool(model.get("supports_reasoning", False))`, and add:
```python
    @staticmethod
    def set_model_supports_reasoning(model_id: int, enabled: bool) -> bool:
        from app.db.model_dao import update_model_supports_reasoning
        return update_model_supports_reasoning(model_id, enabled)
```

- [ ] **Step 7: Add the router endpoint**

In `backend/app/routers/model.py`, add after `UpdateModelTierRequest`:
```python
class UpdateModelSupportsReasoningRequest(BaseModel):
    supports_reasoning: bool
```
And after the `update_model_tier` endpoint:
```python
@router.post("/models/{model_id}/supports_reasoning")
def update_model_supports_reasoning(
    model_id: int, data: UpdateModelSupportsReasoningRequest, current_user: User = Depends(get_current_admin)
):
    try:
        success = ModelService.set_model_supports_reasoning(model_id, data.supports_reasoning)
        if not success:
            return R.error("模型不存在或无权修改")
        return R.success(msg="深度思考支持状态已更新")
    except Exception as e:
        logger.error(f"更新模型 {model_id} 深度思考支持状态失败: {e}", exc_info=True)
        return R.error("更新失败，请重试")
```

- [ ] **Step 8: Write the test**

`backend/tests/test_model_supports_reasoning.py`:
```python
"""models.supports_reasoning 列 + set_model_supports_reasoning 集成测试 - 走真实 DB"""
import app.db.init_db  # noqa: F401
from app.db.model_dao import insert_model, get_model_by_provider_and_name
from app.services.model import ModelService


def test_new_model_defaults_supports_reasoning_false():
    model = insert_model(provider_id="deepseek", model_name="test-reasoning-flag-model")
    assert model["supports_reasoning"] is False


def test_set_model_supports_reasoning_true():
    model = insert_model(provider_id="deepseek", model_name="test-reasoning-flag-model-2")
    ok = ModelService.set_model_supports_reasoning(model["id"], True)
    assert ok is True

    refreshed = get_model_by_provider_and_name("deepseek", "test-reasoning-flag-model-2")
    assert refreshed["supports_reasoning"] is True
```

- [ ] **Step 9: Run the test**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_model_supports_reasoning.py -v
```
Expected: `2 passed`.

- [ ] **Step 10: Frontend service function**

In `NoteFlow_frontend/src/services/model.ts`, add after `updateModelTier`:
```typescript
export const updateModelSupportsReasoning = async (
  modelId: number,
  supportsReasoning: boolean,
  opts?: CallOpts,
) => {
  return await request.post(`/models/${modelId}/supports_reasoning`, { supports_reasoning: supportsReasoning }, cfg(opts))
}
```

- [ ] **Step 11: Frontend store action**

In `NoteFlow_frontend/src/store/modelStore/index.ts`:
- Add `supports_reasoning?: boolean` to `IModelListItem` (line 25, next to `tier`).
- Import `updateModelSupportsReasoning` from `@/services/model` (add to the existing import list on line 3-10).
- Add to the `ModelStore` interface: `updateModelSupportsReasoning: (modelId: number, enabled: boolean) => Promise<boolean>`.
- Add to the store implementation, next to `updateModelTier`:
```typescript
    //  更新模型是否支持深度思考
    updateModelSupportsReasoning: async (modelId: number, enabled: boolean) => {
      try {
        const res = await updateModelSupportsReasoning(modelId, enabled)
        return res.code === 0
      } catch (error) {
        console.error('更新深度思考支持状态失败', error)
        return false
      }
    },
```

- [ ] **Step 12: Frontend admin toggle UI**

In `NoteFlow_frontend/src/components/Form/modelForm/Form.tsx`, near the existing tier-toggle button block (around line 357-380, inside the `isPro`/`handleToggleTier` render), add a sibling toggle following the same visual pattern (amber-for-pro-style but using a distinct color, e.g. `bg-indigo-100 text-indigo-700` / `bg-indigo-200 hover:bg-indigo-300`, labeled "支持思考" / not shown at all for non-admins since this is an admin-only capability flag, not a Pro/normal split):
```tsx
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleToggleSupportsReasoning(model)}
                        disabled={reasoningUpdatingId === model.id}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                          model.supports_reasoning
                            ? 'bg-indigo-200 hover:bg-indigo-300 text-indigo-700'
                            : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
                        }`}
                      >
                        {model.supports_reasoning ? '支持思考' : '不支持思考'}
                      </button>
                    )}
```
Add the accompanying state and handler near `tierUpdatingId`/`handleToggleTier` (line 83, 158):
```typescript
  const [reasoningUpdatingId, setReasoningUpdatingId] = useState<string | null>(null)
```
```typescript
  const handleToggleSupportsReasoning = async (model: IEnabledModel) => {
    const next = !model.supports_reasoning
    setReasoningUpdatingId(model.id)
    try {
      const ok = await updateModelSupportsReasoningInStore(Number(model.id), next)
      if (ok) {
        setModels(prev =>
          prev.map(m => (m.id === model.id ? { ...m, supports_reasoning: next } : m)),
        )
      } else {
        toast.error('更新失败，请重试')
      }
    } finally {
      setReasoningUpdatingId(null)
    }
  }
```
(`updateModelSupportsReasoningInStore` is the `useModelStore(state => state.updateModelSupportsReasoning)` selector — add it next to the existing `updateModelTierInStore`-style selector destructuring near the top of the component; `setModels`/`IEnabledModel` already exist for the tier toggle, extend `IEnabledModel` at line 61-62 with `supports_reasoning?: boolean`.)

- [ ] **Step 13: Typecheck**

```bash
cd NoteFlow_frontend
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 14: Commit**

```bash
git add backend/app/db/models/models.py backend/app/db/migrate_add_model_supports_reasoning.py backend/sql/migrate_add_model_supports_reasoning.sql backend/app/db/model_dao.py backend/app/services/model.py backend/app/routers/model.py backend/tests/test_model_supports_reasoning.py NoteFlow_frontend/src/services/model.ts NoteFlow_frontend/src/store/modelStore/index.ts NoteFlow_frontend/src/components/Form/modelForm/Form.tsx
git commit -m "feat: add models.supports_reasoning flag with admin toggle"
```

---

## Task 3: `kb_conversations` / `kb_messages` tables + `kb_dao.py`

**Files:**
- Create: `backend/app/db/models/kb_conversations.py`
- Create: `backend/app/db/kb_dao.py`
- Create: `backend/app/db/migrate_add_kb_conversations.py`
- Create: `backend/sql/migrate_add_kb_conversations.sql`
- Modify: `backend/app/db/init_db.py` (add import)
- Test: `backend/tests/test_kb_dao.py`

**Interfaces:**
- Consumes: `app.db.engine.get_db`/`Base` (existing).
- Produces (for later tasks — exact signatures the service/router layer will call):
  - `create_conversation(user_id: int) -> dict` — `{"id", "title", "provider_id", "model_name", "created_at", "updated_at"}`
  - `list_conversations(user_id: int) -> list[dict]` — same shape, ordered by `updated_at desc`
  - `get_conversation(conversation_id: int, user_id: int) -> Optional[dict]`
  - `delete_conversation(conversation_id: int, user_id: int) -> bool`
  - `update_conversation_meta(conversation_id: int, *, title: Optional[str] = None, provider_id: Optional[str] = None, model_name: Optional[str] = None) -> None`
  - `add_message(conversation_id: int, role: str, content: str, reasoning_content: Optional[str] = None, sources: Optional[list] = None) -> dict` — `{"id", "role", "content", "reasoning_content", "sources", "created_at"}`
  - `list_messages(conversation_id: int, limit: Optional[int] = None) -> list[dict]` — ascending by `created_at`; when `limit` given, returns the **last** `limit` messages still in ascending order
  - `touch_conversation(conversation_id: int) -> None` — bumps `updated_at`

- [ ] **Step 1: Write the models**

`backend/app/db/models/kb_conversations.py`:
```python
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func

from app.db.engine import Base


class KbConversation(Base):
    """知识库会话：用户跨笔记 AI 问答的一次多轮对话"""
    __tablename__ = "kb_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="会话 ID，主键，自增")
    user_id = Column(Integer, nullable=False, index=True, comment="所属用户 ID")
    title = Column(String(200), nullable=True, comment="会话标题，首次提问后取问题前 30 字自动生成")
    provider_id = Column(String(64), nullable=True, comment="该会话最近使用的供应商 ID，用于下次打开默认选中")
    model_name = Column(String(128), nullable=True, comment="该会话最近使用的模型名")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近一次问答时间，用于会话列表排序")


class KbMessage(Base):
    """知识库消息：会话中的单条问答记录"""
    __tablename__ = "kb_messages"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="消息 ID，主键，自增")
    conversation_id = Column(Integer, ForeignKey("kb_conversations.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属会话 ID")
    role = Column(String(16), nullable=False, comment="角色：user / assistant")
    content = Column(Text, nullable=False, comment="最终答案正文（不含思考过程），或用户提问内容")
    reasoning_content = Column(Text, nullable=True, comment="深度思考过程内容，仅 assistant 且开启深度思考时有值")
    sources = Column(Text, nullable=True, comment="JSON 字符串，引用的跨笔记片段列表（含 task_id、笔记标题、片段文本）")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间，决定消息在会话内的顺序")
```

- [ ] **Step 2: Write the migration script**

`backend/app/db/migrate_add_kb_conversations.py`:
```python
"""
迁移：创建 kb_conversations / kb_messages 表（知识库跨笔记 AI 问答）。

说明
----
- kb_conversations: 用户的知识库会话（多会话，带历史列表）。
- kb_messages: 会话内的消息，conversation_id 外键级联删除。
- 完整字段说明见 ``app/db/models/kb_conversations.py``。

用法:
    python -m app.db.migrate_add_kb_conversations

幂等: 重复执行不会报错，已存在的表会跳过。
新库部署可直接走 init_db()（Base.metadata.create_all 已包含这两张表）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text

from app.db.engine import get_engine


SQL_CREATE_CONVERSATIONS = """
CREATE TABLE IF NOT EXISTS kb_conversations (
  id            INT          NOT NULL AUTO_INCREMENT                COMMENT '会话 ID，主键，自增',
  user_id       INT          NOT NULL                                COMMENT '所属用户 ID',
  title         VARCHAR(200) NULL                                    COMMENT '会话标题，首次提问后取问题前 30 字自动生成',
  provider_id   VARCHAR(64)  NULL                                    COMMENT '该会话最近使用的供应商 ID',
  model_name    VARCHAR(128) NULL                                    COMMENT '该会话最近使用的模型名',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近一次问答时间，用于会话列表排序',
  PRIMARY KEY (id),
  KEY ix_kb_conversations_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

SQL_CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS kb_messages (
  id                  INT          NOT NULL AUTO_INCREMENT                COMMENT '消息 ID，主键，自增',
  conversation_id     INT          NOT NULL                                COMMENT '所属会话 ID，对应 kb_conversations.id',
  role                VARCHAR(16)  NOT NULL                                COMMENT '角色：user / assistant',
  content             TEXT         NOT NULL                                COMMENT '最终答案正文，或用户提问内容',
  reasoning_content   TEXT         NULL                                    COMMENT '深度思考过程内容',
  sources             TEXT         NULL                                    COMMENT 'JSON 字符串，引用的跨笔记片段列表',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间，决定消息顺序',
  PRIMARY KEY (id),
  KEY ix_kb_messages_conversation_id (conversation_id),
  CONSTRAINT kb_messages_ibfk_1 FOREIGN KEY (conversation_id) REFERENCES kb_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :t"
        ),
        {"t": table_name},
    ).scalar()
    return bool(row)


def run() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        if not _table_exists(conn, "kb_conversations"):
            conn.execute(text(SQL_CREATE_CONVERSATIONS))
            print("  created table: kb_conversations")
        else:
            print("  skipped (exists): kb_conversations table")

        if not _table_exists(conn, "kb_messages"):
            conn.execute(text(SQL_CREATE_MESSAGES))
            print("  created table: kb_messages")
        else:
            print("  skipped (exists): kb_messages table")

    print("Migration done.")


if __name__ == "__main__":
    run()
```

- [ ] **Step 3: Write the raw SQL counterpart**

`backend/sql/migrate_add_kb_conversations.sql`:
```sql
-- =============================================================================
-- NoteFlow 知识库会话/消息表迁移 (2026-07-26)
-- 用法:
--   mysql -uroot -p noteflow < backend/sql/migrate_add_kb_conversations.sql
-- 或在已经启动的容器里:
--   docker exec -i noteflow-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD noteflow < sql/migrate_add_kb_conversations.sql
-- =============================================================================
USE noteflow;

CREATE TABLE IF NOT EXISTS kb_conversations (
  id            INT          NOT NULL AUTO_INCREMENT                COMMENT '会话 ID，主键，自增',
  user_id       INT          NOT NULL                                COMMENT '所属用户 ID',
  title         VARCHAR(200) NULL                                    COMMENT '会话标题，首次提问后取问题前 30 字自动生成',
  provider_id   VARCHAR(64)  NULL                                    COMMENT '该会话最近使用的供应商 ID',
  model_name    VARCHAR(128) NULL                                    COMMENT '该会话最近使用的模型名',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近一次问答时间，用于会话列表排序',
  PRIMARY KEY (id),
  KEY ix_kb_conversations_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kb_messages (
  id                  INT          NOT NULL AUTO_INCREMENT                COMMENT '消息 ID，主键，自增',
  conversation_id     INT          NOT NULL                                COMMENT '所属会话 ID，对应 kb_conversations.id',
  role                VARCHAR(16)  NOT NULL                                COMMENT '角色：user / assistant',
  content             TEXT         NOT NULL                                COMMENT '最终答案正文，或用户提问内容',
  reasoning_content   TEXT         NULL                                    COMMENT '深度思考过程内容',
  sources             TEXT         NULL                                    COMMENT 'JSON 字符串，引用的跨笔记片段列表',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间，决定消息顺序',
  PRIMARY KEY (id),
  KEY ix_kb_messages_conversation_id (conversation_id),
  CONSTRAINT kb_messages_ibfk_1 FOREIGN KEY (conversation_id) REFERENCES kb_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Register the models in `init_db.py`**

Add after the `KbIndexStatus` import (from Task 1):
```python
from app.db.models.kb_conversations import KbConversation, KbMessage
```

- [ ] **Step 5: Run the migration against the local DB**

```bash
cd backend
/opt/anaconda3/bin/python3 -m app.db.migrate_add_kb_conversations
```
Expected output: `created table: kb_conversations`, `created table: kb_messages`, then `Migration done.`

- [ ] **Step 6: Write `kb_dao.py`**

`backend/app/db/kb_dao.py`:
```python
import json
from datetime import datetime
from typing import Optional, List

from app.db.engine import get_db
from app.db.models.kb_conversations import KbConversation, KbMessage
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _conversation_to_dict(c: KbConversation) -> dict:
    return {
        "id": c.id,
        "title": c.title,
        "provider_id": c.provider_id,
        "model_name": c.model_name,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _message_to_dict(m: KbMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "reasoning_content": m.reasoning_content,
        "sources": json.loads(m.sources) if m.sources else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def create_conversation(user_id: int) -> dict:
    db = next(get_db())
    try:
        c = KbConversation(user_id=user_id)
        db.add(c)
        db.commit()
        db.refresh(c)
        return _conversation_to_dict(c)
    finally:
        db.close()


def list_conversations(user_id: int) -> List[dict]:
    db = next(get_db())
    try:
        rows = (
            db.query(KbConversation)
            .filter_by(user_id=user_id)
            .order_by(KbConversation.updated_at.desc())
            .all()
        )
        return [_conversation_to_dict(c) for c in rows]
    finally:
        db.close()


def get_conversation(conversation_id: int, user_id: int) -> Optional[dict]:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id, user_id=user_id).first()
        return _conversation_to_dict(c) if c else None
    finally:
        db.close()


def delete_conversation(conversation_id: int, user_id: int) -> bool:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id, user_id=user_id).first()
        if not c:
            return False
        db.query(KbMessage).filter_by(conversation_id=conversation_id).delete()
        db.delete(c)
        db.commit()
        return True
    finally:
        db.close()


def update_conversation_meta(
    conversation_id: int,
    *,
    title: Optional[str] = None,
    provider_id: Optional[str] = None,
    model_name: Optional[str] = None,
) -> None:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id).first()
        if not c:
            return
        if title is not None:
            c.title = title
        if provider_id is not None:
            c.provider_id = provider_id
        if model_name is not None:
            c.model_name = model_name
        db.commit()
    finally:
        db.close()


def touch_conversation(conversation_id: int) -> None:
    db = next(get_db())
    try:
        c = db.query(KbConversation).filter_by(id=conversation_id).first()
        if c:
            c.updated_at = datetime.now()
            db.commit()
    finally:
        db.close()


def add_message(
    conversation_id: int,
    role: str,
    content: str,
    reasoning_content: Optional[str] = None,
    sources: Optional[list] = None,
) -> dict:
    db = next(get_db())
    try:
        m = KbMessage(
            conversation_id=conversation_id,
            role=role,
            content=content,
            reasoning_content=reasoning_content,
            sources=json.dumps(sources, ensure_ascii=False) if sources is not None else None,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return _message_to_dict(m)
    finally:
        db.close()


def list_messages(conversation_id: int, limit: Optional[int] = None) -> List[dict]:
    db = next(get_db())
    try:
        q = db.query(KbMessage).filter_by(conversation_id=conversation_id)
        if limit is not None:
            rows = q.order_by(KbMessage.created_at.desc()).limit(limit).all()
            rows = list(reversed(rows))
        else:
            rows = q.order_by(KbMessage.created_at.asc()).all()
        return [_message_to_dict(m) for m in rows]
    finally:
        db.close()
```

- [ ] **Step 7: Write the DAO test**

`backend/tests/test_kb_dao.py`:
```python
"""kb_dao.py 集成测试 - 走真实 DB"""
import app.db.init_db  # noqa: F401
from app.db import kb_dao


def test_create_and_list_conversation():
    conv = kb_dao.create_conversation(user_id=999001)
    assert conv["title"] is None

    conversations = kb_dao.list_conversations(user_id=999001)
    assert any(c["id"] == conv["id"] for c in conversations)

    kb_dao.delete_conversation(conv["id"], user_id=999001)


def test_add_and_list_messages_ordering():
    conv = kb_dao.create_conversation(user_id=999002)
    kb_dao.add_message(conv["id"], "user", "第一条问题")
    kb_dao.add_message(conv["id"], "assistant", "第一条回答", sources=[{"task_id": "abc", "title": "笔记A"}])

    messages = kb_dao.list_messages(conv["id"])
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["sources"] == [{"task_id": "abc", "title": "笔记A"}]

    kb_dao.delete_conversation(conv["id"], user_id=999002)


def test_delete_conversation_cascades_messages():
    conv = kb_dao.create_conversation(user_id=999003)
    kb_dao.add_message(conv["id"], "user", "问题")

    ok = kb_dao.delete_conversation(conv["id"], user_id=999003)
    assert ok is True
    assert kb_dao.get_conversation(conv["id"], user_id=999003) is None
    assert kb_dao.list_messages(conv["id"]) == []


def test_touch_and_update_conversation_meta():
    conv = kb_dao.create_conversation(user_id=999004)
    kb_dao.update_conversation_meta(conv["id"], title="测试标题", provider_id="deepseek", model_name="deepseek-chat")

    fetched = kb_dao.get_conversation(conv["id"], user_id=999004)
    assert fetched["title"] == "测试标题"
    assert fetched["provider_id"] == "deepseek"
    assert fetched["model_name"] == "deepseek-chat"

    kb_dao.delete_conversation(conv["id"], user_id=999004)
```

- [ ] **Step 8: Run the tests**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_kb_dao.py -v
```
Expected: `4 passed`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/db/models/kb_conversations.py backend/app/db/kb_dao.py backend/app/db/migrate_add_kb_conversations.py backend/sql/migrate_add_kb_conversations.sql backend/app/db/init_db.py backend/tests/test_kb_dao.py
git commit -m "feat: add kb_conversations/kb_messages tables and DAO"
```

---

## Task 4: `VectorStoreManager.query_multi` cross-collection retrieval

**Files:**
- Modify: `backend/app/services/vector_store.py` (add method, do not touch existing methods)
- Test: `backend/tests/test_vector_store_query_multi.py`

**Interfaces:**
- Consumes: existing `VectorStoreManager.__init__`, `self._client`, `self._collection_name`, `self._parse_results` (all unchanged).
- Produces (for later tasks): `VectorStoreManager.query_multi(self, task_ids: list[str], query_text: str, per_task_n: int = 4, top_k: int = 8) -> list[dict]` — each returned dict has the same shape as `_parse_results` output (`{"text", "metadata", "distance"}`) plus `metadata["task_id"]` injected so callers can attribute a chunk to its source note.

- [ ] **Step 1: Write the test first**

`backend/tests/test_vector_store_query_multi.py`:
```python
"""VectorStoreManager.query_multi 集成测试 - 走真实 ChromaDB (VECTOR_DB_DIR)"""
import json
import os
import uuid

import pytest

from app.services.vector_store import VectorStoreManager

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def _write_fake_note(task_id: str, title: str, markdown_body: str):
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "markdown": f"## {title}\n\n{markdown_body}",
            "transcript": {"segments": []},
            "audio_meta": {"title": title, "platform": "bilibili"},
        }, f, ensure_ascii=False)
    return path


@pytest.fixture
def two_indexed_tasks():
    store = VectorStoreManager()
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    path_a = _write_fake_note(task_a, "Python 教程", "Python 是一门解释型编程语言，适合初学者入门。")
    path_b = _write_fake_note(task_b, "养猫指南", "猫咪每天需要充足的水和优质猫粮，定期驱虫很重要。")
    store.index_task(task_a)
    store.index_task(task_b)
    yield store, task_a, task_b
    store.delete_index(task_a)
    store.delete_index(task_b)
    os.remove(path_a)
    os.remove(path_b)


def test_query_multi_tags_task_id_and_merges_results(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程语言入门", per_task_n=4, top_k=8)

    assert len(results) > 0
    assert all("task_id" in r["metadata"] for r in results)
    # 至少应命中 task_a（Python 教程）
    assert any(r["metadata"]["task_id"] == task_a for r in results)


def test_query_multi_respects_top_k(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程", per_task_n=4, top_k=2)
    assert len(results) <= 2


def test_query_multi_sorted_by_distance_ascending(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    results = store.query_multi([task_a, task_b], "编程语言", per_task_n=4, top_k=8)
    distances = [r["distance"] for r in results if r["distance"] is not None]
    assert distances == sorted(distances)


def test_query_multi_ignores_unindexed_task_id(two_indexed_tasks):
    store, task_a, task_b = two_indexed_tasks
    fake_task = f"nonexistent-{uuid.uuid4().hex[:8]}"
    # 不应因某个 task_id 没有 collection 而整体报错
    results = store.query_multi([task_a, fake_task], "编程", per_task_n=4, top_k=8)
    assert len(results) > 0
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_vector_store_query_multi.py -v
```
Expected: FAIL with `AttributeError: 'VectorStoreManager' object has no attribute 'query_multi'`.

- [ ] **Step 3: Implement `query_multi`**

In `backend/app/services/vector_store.py`, add this method to `VectorStoreManager`, directly after the existing `query` method (do not modify `query` itself):
```python
    def query_multi(self, task_ids: list[str], query_text: str, per_task_n: int = 4, top_k: int = 8) -> list[dict]:
        """
        对多个 task_id 的 collection 分别检索（每个最多 per_task_n 条，不做来源配额区分），
        合并后按 distance 升序排序，取全局 top_k。每条结果的 metadata 补充 task_id 字段。
        """
        all_chunks = []

        for task_id in task_ids:
            col_name = self._collection_name(task_id)
            try:
                collection = self._client.get_collection(col_name)
            except Exception:
                continue

            try:
                results = collection.query(query_texts=[query_text], n_results=per_task_n)
            except Exception:
                continue

            for chunk in self._parse_results(results):
                chunk["metadata"] = {**chunk["metadata"], "task_id": task_id}
                all_chunks.append(chunk)

        all_chunks.sort(key=lambda c: c["distance"] if c["distance"] is not None else float("inf"))
        return all_chunks[:top_k]
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_vector_store_query_multi.py -v
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/vector_store.py backend/tests/test_vector_store_query_multi.py
git commit -m "feat: add VectorStoreManager.query_multi for cross-note retrieval"
```

---

## Task 5: `video_task_dao.get_task_ids_by_user` helper + note-title lookup helper

**Files:**
- Modify: `backend/app/db/video_task_dao.py` (add function)
- Create: `backend/app/services/kb_note_lookup.py`
- Test: `backend/tests/test_kb_note_lookup.py`

**Interfaces:**
- Produces (for Task 6): `app.db.video_task_dao.get_task_ids_by_user(user_id: int) -> list[str]`; `app.services.kb_note_lookup.load_note_title(task_id: str) -> str` (returns `task_id` itself as fallback if no title found, mirroring `_load_task_summary`'s degrade-gracefully behavior but simplified to title-only since KB sources don't need cover/duration).

- [ ] **Step 1: Add the DAO function**

In `backend/app/db/video_task_dao.py`, add after `get_task_ids_by_batch_id`:
```python
def get_task_ids_by_user(user_id: int) -> list:
    db = next(get_db())
    try:
        rows = db.query(VideoTask).filter_by(user_id=user_id).order_by(VideoTask.created_at.desc()).all()
        return [t.task_id for t in rows]
    except Exception as e:
        logger.error(f"Failed to get task ids by user: {e}")
        return []
    finally:
        db.close()
```

- [ ] **Step 2: Write the note-title lookup helper**

`backend/app/services/kb_note_lookup.py`:
```python
import json
import os

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def load_note_title(task_id: str) -> str:
    """读取笔记标题，用于知识库来源标注；读取失败时降级为 task_id 本身。"""
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                rc = json.load(f)
            title = rc.get("audio_meta", {}).get("title", "")
            if title:
                return title
        except Exception:
            pass
    return task_id
```

- [ ] **Step 3: Write the tests**

`backend/tests/test_kb_note_lookup.py`:
```python
"""kb_note_lookup.py + video_task_dao.get_task_ids_by_user 集成测试 - 走真实 DB/文件系统"""
import json
import os
import uuid

import app.db.init_db  # noqa: F401
from app.db.video_task_dao import insert_video_task, get_task_ids_by_user, delete_task_by_video
from app.services.kb_note_lookup import load_note_title

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def test_get_task_ids_by_user_returns_only_owned_tasks():
    user_id = 999005
    video_id = f"video-{uuid.uuid4().hex[:8]}"
    task_id = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id, platform="bilibili", task_id=task_id, user_id=user_id)

    try:
        task_ids = get_task_ids_by_user(user_id)
        assert task_id in task_ids
    finally:
        delete_task_by_video(video_id, "bilibili", user_id=user_id)


def test_load_note_title_reads_result_file():
    task_id = f"test-{uuid.uuid4().hex[:8]}"
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"audio_meta": {"title": "测试笔记标题"}}, f, ensure_ascii=False)

    try:
        assert load_note_title(task_id) == "测试笔记标题"
    finally:
        os.remove(path)


def test_load_note_title_falls_back_to_task_id_when_missing():
    fake_task_id = f"nonexistent-{uuid.uuid4().hex[:8]}"
    assert load_note_title(fake_task_id) == fake_task_id
```

- [ ] **Step 4: Run the tests**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_kb_note_lookup.py -v
```
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/video_task_dao.py backend/app/services/kb_note_lookup.py backend/tests/test_kb_note_lookup.py
git commit -m "feat: add get_task_ids_by_user and note title lookup helpers"
```

---

## Task 6: `_require_pro` helper + `knowledge_base_service.py` (retrieval + reasoning + streaming)

**Files:**
- Create: `backend/app/services/kb_permissions.py`
- Create: `backend/app/services/knowledge_base_service.py`
- Test: `backend/tests/test_kb_permissions.py`
- Test: `backend/tests/test_knowledge_base_service.py`

**Interfaces:**
- Consumes: `app.db.video_task_dao.get_task_ids_by_user` (Task 5), `app.db.kb_index_status_dao.get_statuses`/`set_status` (Task 1), `app.services.vector_store.VectorStoreManager.query_multi`/`index_task` (Task 4/existing), `app.services.kb_note_lookup.load_note_title` (Task 5), `app.db.kb_dao.add_message`/`list_messages`/`update_conversation_meta`/`touch_conversation` (Task 3), `app.db.model_dao.get_model_by_provider_and_name` (Task 2), `app.services.provider.ProviderService.get_provider_by_id`, `app.gpt.gpt_factory.GPTFactory.from_config`, `app.models.model_config.ModelConfig` (all existing).
- Produces (for Task 7 router):
  - `app.services.kb_permissions.require_pro(user: "User") -> None` (raises `BizException`)
  - `app.services.knowledge_base_service.get_index_coverage(user_id: int) -> dict` — `{"total": int, "indexed": int}`
  - `app.services.knowledge_base_service.ask_stream(conversation_id: int, question: str, provider_id: str, model_name: str, enable_thinking: bool, user_id: int) -> Iterator[dict]` yielding `{"type": "sources"|"reasoning"|"delta"|"done"|"error", ...}` exactly per the spec's SSE event shapes.

- [ ] **Step 1: Write `_require_pro` test first**

`backend/tests/test_kb_permissions.py`:
```python
"""kb_permissions.require_pro 单测 - 用轻量 stub 代替真实 User ORM 对象"""
import pytest

from app.exceptions.biz_exception import BizException
from app.services.kb_permissions import require_pro


class _StubUser:
    def __init__(self, active_subscription_id=None):
        self.active_subscription_id = active_subscription_id


def test_require_pro_passes_for_subscribed_user():
    require_pro(_StubUser(active_subscription_id=42))  # 不应抛异常


def test_require_pro_raises_for_free_user():
    with pytest.raises(BizException) as exc_info:
        require_pro(_StubUser(active_subscription_id=None))
    assert exc_info.value.code == 400601
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_kb_permissions.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.kb_permissions'`.

- [ ] **Step 3: Add the error code and write `kb_permissions.py`**

In `backend/app/utils/status_code.py`, add after the `TICKET_INVALID` line (following the existing verification-code block's numbering convention, using a new `4006xx` range for knowledge-base errors):
```python
    # 知识库相关
    KB_REQUIRES_PRO = 40601      # 知识库为 Pro 会员专属功能
```

`backend/app/services/kb_permissions.py`:
```python
from typing import TYPE_CHECKING

from app.exceptions.biz_exception import BizException
from app.utils.status_code import StatusCode

if TYPE_CHECKING:
    from app.db.models.users import User


def require_pro(user: "User") -> None:
    """知识库为 Pro 会员专属功能；免费用户调用核心问答接口时拒绝。"""
    if not user.active_subscription_id:
        raise BizException(code=StatusCode.KB_REQUIRES_PRO.value, message="知识库为会员功能，请升级 Pro")
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_kb_permissions.py -v
```
Expected: `2 passed`.

- [ ] **Step 5: Write `knowledge_base_service.py`**

`backend/app/services/knowledge_base_service.py`:
```python
import json
from typing import Iterator, Optional

from app.db import kb_dao
from app.db.kb_index_status_dao import get_statuses as get_index_statuses, set_status as set_index_status
from app.db.model_dao import get_model_by_provider_and_name
from app.db.video_task_dao import get_task_ids_by_user
from app.gpt.gpt_factory import GPTFactory
from app.models.model_config import ModelConfig
from app.services.kb_note_lookup import load_note_title
from app.services.provider import ProviderService
from app.services.vector_store import VectorStoreManager
from app.utils.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一个跨笔记知识库问答助手，可以访问用户名下全部视频笔记的内容。

--- 检索到的相关笔记片段 ---
{context}
---

回答要求：
- 基于上方检索到的片段回答问题，明确指出信息来自哪篇笔记（用笔记标题）
- 如果检索内容不足以回答问题，请诚实说明，不要编造
- 请用中文回答，保持简洁准确"""

MAX_HISTORY_MESSAGES = 20


def get_index_coverage(user_id: int) -> dict:
    """返回当前用户笔记的索引覆盖情况：总数与已索引数。"""
    task_ids = get_task_ids_by_user(user_id)
    if not task_ids:
        return {"total": 0, "indexed": 0}
    statuses = get_index_statuses(task_ids)
    indexed = sum(1 for t in task_ids if statuses.get(t) == "indexed")
    return {"total": len(task_ids), "indexed": indexed}


def _get_indexed_task_ids(user_id: int) -> list[str]:
    """已索引的 task_id 子集；未索引的异步补索引，本次不等待。"""
    task_ids = get_task_ids_by_user(user_id)
    if not task_ids:
        return []

    statuses = get_index_statuses(task_ids)
    indexed_ids = [t for t in task_ids if statuses.get(t) == "indexed"]
    unindexed_ids = [t for t in task_ids if statuses.get(t) != "indexed" and statuses.get(t) != "indexing"]

    if unindexed_ids:
        import threading

        def _backfill(ids: list[str]):
            store = VectorStoreManager()
            for tid in ids:
                try:
                    set_index_status(tid, "indexing")
                    store.index_task(tid)
                    set_index_status(tid, "indexed")
                except Exception as e:
                    set_index_status(tid, "failed")
                    logger.error(f"知识库后台补索引失败: task_id={tid}, {e}")

        threading.Thread(target=_backfill, args=(unindexed_ids,), daemon=True).start()

    return indexed_ids


def _build_context_and_sources(chunks: list[dict]) -> tuple[str, list[dict]]:
    parts = []
    sources = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        task_id = meta.get("task_id", "")
        title = load_note_title(task_id) if task_id else ""
        source_type = meta.get("source_type", "unknown")
        label = f"[笔记《{title}》]" if title else "[未知来源]"
        parts.append(f"{label}\n{chunk['text']}")

        source = {"task_id": task_id, "title": title, "text": chunk["text"][:200], "source_type": source_type}
        sources.append(source)
    context = "\n\n".join(parts) if parts else "（未检索到相关内容）"
    return context, sources


def _resolve_reasoning_mode(provider_id: str, model_name: str, enable_thinking: bool) -> Optional[str]:
    """返回 None(不开启)、'native'(DeepSeek 类，无需额外参数) 或 'extra_body'(Qwen 类，需 enable_thinking=True)。"""
    if not enable_thinking:
        return None
    model = get_model_by_provider_and_name(provider_id, model_name)
    if not model or not model.get("supports_reasoning"):
        return None
    if "qwen" in model_name.lower():
        return "extra_body"
    return "native"


def ask_stream(
    conversation_id: int,
    question: str,
    provider_id: str,
    model_name: str,
    enable_thinking: bool,
    user_id: int,
) -> Iterator[dict]:
    """
    知识库流式问答：跨笔记检索 + 可选深度思考 + 流式返回，落库用户问题与最终回答。

    yield 事件字典：
      {"type": "sources", "sources": [...]}
      {"type": "reasoning", "content": "..."}   仅开启深度思考时
      {"type": "delta", "content": "..."}
      {"type": "done", "message_id": 123}
      {"type": "error", "message": "..."}
    """
    kb_dao.add_message(conversation_id, "user", question)

    indexed_task_ids = _get_indexed_task_ids(user_id)

    vector_store = VectorStoreManager()
    chunks = vector_store.query_multi(indexed_task_ids, question, per_task_n=4, top_k=8) if indexed_task_ids else []
    context, sources = _build_context_and_sources(chunks)

    yield {"type": "sources", "sources": sources}

    provider = ProviderService.get_provider_by_id(provider_id)
    if not provider:
        yield {"type": "error", "message": "未找到对应的 AI 供应商，请检查供应商配置"}
        return

    config = ModelConfig(
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        model_name=model_name,
        provider=provider["type"],
        name=provider["name"],
    )
    gpt = GPTFactory.from_config(config)

    history = kb_dao.list_messages(conversation_id, limit=MAX_HISTORY_MESSAGES)
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
    for m in history:
        messages.append({"role": m["role"], "content": m["content"]})

    reasoning_mode = _resolve_reasoning_mode(provider_id, model_name, enable_thinking)

    kwargs = dict(model=gpt.model, messages=messages, temperature=0.7, stream=True)
    if reasoning_mode == "extra_body":
        kwargs["extra_body"] = {"enable_thinking": True}

    logger.info(f"KB ask_stream: conversation_id={conversation_id}, model={model_name}, reasoning_mode={reasoning_mode}")

    try:
        completion = gpt.client.chat.completions.create(**kwargs)
    except Exception as e:
        logger.error(f"KB ask_stream 调用 LLM 失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_chat_error
        yield {"type": "error", "message": translate_chat_error(e)}
        return

    content_parts: list[str] = []
    reasoning_parts: list[str] = []

    try:
        for piece in completion:
            choices = getattr(piece, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta

            if reasoning_mode is not None:
                reasoning_text = getattr(delta, "reasoning_content", None)
                if reasoning_text:
                    reasoning_parts.append(reasoning_text)
                    yield {"type": "reasoning", "content": reasoning_text}

            text = getattr(delta, "content", None)
            if text:
                content_parts.append(text)
                yield {"type": "delta", "content": text}
    except Exception as e:
        logger.error(f"KB ask_stream 流式读取失败: {e}", exc_info=True)
        from app.utils.error_messages import translate_chat_error
        yield {"type": "error", "message": translate_chat_error(e)}
        return

    final_answer = "".join(content_parts)
    final_reasoning = "".join(reasoning_parts) or None

    saved = kb_dao.add_message(
        conversation_id, "assistant", final_answer,
        reasoning_content=final_reasoning,
        sources=sources,
    )

    # history 在插入本轮用户消息之后才读取，所以“第一次提问”时 history 长度恰好为 1
    # （只有刚插入的这条 user 消息）；以此判断是否需要回填会话标题。
    if len(history) <= 1:
        kb_dao.update_conversation_meta(
            conversation_id, title=question[:30], provider_id=provider_id, model_name=model_name,
        )
    else:
        kb_dao.update_conversation_meta(conversation_id, provider_id=provider_id, model_name=model_name)
    kb_dao.touch_conversation(conversation_id)

    yield {"type": "done", "message_id": saved["id"]}
```

- [ ] **Step 6: Write the service test**

`backend/tests/test_knowledge_base_service.py`:
```python
"""knowledge_base_service 集成测试 - 走真实 DB；get_index_coverage 不依赖 LLM/向量库，可直接测"""
import uuid

import app.db.init_db  # noqa: F401
from app.db.video_task_dao import insert_video_task, delete_task_by_video
from app.db.kb_index_status_dao import set_status
from app.services.knowledge_base_service import get_index_coverage


def test_get_index_coverage_zero_notes():
    coverage = get_index_coverage(user_id=999006)
    assert coverage == {"total": 0, "indexed": 0}


def test_get_index_coverage_counts_indexed_subset():
    user_id = 999007
    video_id_a = f"video-{uuid.uuid4().hex[:8]}"
    video_id_b = f"video-{uuid.uuid4().hex[:8]}"
    task_a = f"test-{uuid.uuid4().hex[:8]}"
    task_b = f"test-{uuid.uuid4().hex[:8]}"
    insert_video_task(video_id=video_id_a, platform="bilibili", task_id=task_a, user_id=user_id)
    insert_video_task(video_id=video_id_b, platform="bilibili", task_id=task_b, user_id=user_id)
    set_status(task_a, "indexed")
    set_status(task_b, "failed")

    try:
        coverage = get_index_coverage(user_id)
        assert coverage == {"total": 2, "indexed": 1}
    finally:
        delete_task_by_video(video_id_a, "bilibili", user_id=user_id)
        delete_task_by_video(video_id_b, "bilibili", user_id=user_id)
```

- [ ] **Step 7: Run the tests**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_knowledge_base_service.py tests/test_kb_permissions.py -v
```
Expected: `4 passed`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/utils/status_code.py backend/app/services/kb_permissions.py backend/app/services/knowledge_base_service.py backend/tests/test_kb_permissions.py backend/tests/test_knowledge_base_service.py
git commit -m "feat: add knowledge_base_service with cross-note RAG + reasoning streaming"
```

---

## Task 7: `app/routers/knowledge_base.py` (the 6 `/kb/*` endpoints) + register in `app/__init__.py`

**Files:**
- Create: `backend/app/routers/knowledge_base.py`
- Modify: `backend/app/__init__.py` (register router)
- Test: `backend/tests/test_knowledge_base_router.py`

**Interfaces:**
- Consumes: `app.auth.dependencies.get_current_user`, `app.db.kb_dao.*` (Task 3), `app.services.kb_permissions.require_pro` (Task 6), `app.services.knowledge_base_service.get_index_coverage`/`ask_stream` (Task 6), `app.utils.response.ResponseWrapper as R` (existing).
- Produces (for frontend Task 8+): the 6 endpoints exactly as specified — `POST /api/kb/conversations`, `GET /api/kb/conversations`, `GET /api/kb/conversations/{id}/messages`, `DELETE /api/kb/conversations/{id}`, `POST /api/kb/ask_stream`, `GET /api/kb/index_status`.

- [ ] **Step 1: Write the router**

`backend/app/routers/knowledge_base.py`:
```python
import json as _json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db import kb_dao
from app.db.models.users import User
from app.services.kb_permissions import require_pro
from app.services.knowledge_base_service import ask_stream as ask_stream_service, get_index_coverage
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter(prefix="/kb", tags=["knowledge_base"])


class AskStreamRequest(BaseModel):
    conversation_id: int
    question: str
    provider_id: str
    model_name: str
    enable_thinking: bool = False


@router.post("/conversations")
def create_conversation(current_user: User = Depends(get_current_user)):
    conv = kb_dao.create_conversation(current_user.id)
    return R.success(conv, msg="会话创建成功")


@router.get("/conversations")
def list_conversations(current_user: User = Depends(get_current_user)):
    conversations = kb_dao.list_conversations(current_user.id)
    return R.success(conversations)


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: int, current_user: User = Depends(get_current_user)):
    conv = kb_dao.get_conversation(conversation_id, current_user.id)
    if not conv:
        return R.error(msg="会话不存在或无权访问", code=404)
    messages = kb_dao.list_messages(conversation_id)
    return R.success(messages)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, current_user: User = Depends(get_current_user)):
    ok = kb_dao.delete_conversation(conversation_id, current_user.id)
    if not ok:
        return R.error(msg="会话不存在或无权访问", code=404)
    return R.success(msg="会话已删除")


@router.get("/index_status")
def index_status(current_user: User = Depends(get_current_user)):
    coverage = get_index_coverage(current_user.id)
    return R.success(coverage)


@router.post("/ask_stream")
def ask_stream(data: AskStreamRequest, current_user: User = Depends(get_current_user)):
    """知识库跨笔记流式问答：以 SSE（text/event-stream）逐段返回回答内容，需 Pro。"""
    require_pro(current_user)

    conv = kb_dao.get_conversation(data.conversation_id, current_user.id)
    if not conv:
        return R.error(msg="会话不存在或无权访问", code=404)

    def event_gen():
        try:
            for event in ask_stream_service(
                conversation_id=data.conversation_id,
                question=data.question,
                provider_id=data.provider_id,
                model_name=data.model_name,
                enable_thinking=data.enable_thinking,
                user_id=current_user.id,
            ):
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"知识库流式问答失败: {e}", exc_info=True)
            yield f"data: {_json.dumps({'type': 'error', 'message': '知识库问答失败，请稍后重试'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 2: Register the router**

In `backend/app/__init__.py`, add `knowledge_base` to the import line (after `flashcard`):
```python
from .routers import note, provider, model, config, chat, auth, note_style, profile, export_note, share, feedback, billing, billing_notify, admin, admin_cookies, admin_notifications, platform, update_logs, admin_update_logs, note_collection, flashcard, knowledge_base
```
And add after `app.include_router(flashcard.router, prefix="/api")`:
```python
    app.include_router(knowledge_base.router, prefix="/api")
```

- [ ] **Step 3: Write the router test**

`backend/tests/test_knowledge_base_router.py`:
```python
"""knowledge_base 路由集成测试 - 使用真实 DB + TestClient，覆盖会话 CRUD 与 Pro 校验"""
import uuid

import app.db.init_db  # noqa: F401
from fastapi.testclient import TestClient

from main import app as fastapi_app
from app.auth.jwt_handler import create_access_token
from app.db.engine import SessionLocal
from app.db.models.users import User

client = TestClient(fastapi_app)


def _make_user() -> tuple[User, str]:
    """创建一个免费用户（active_subscription_id=None），足以覆盖会话 CRUD 与 Pro 拒绝路径。"""
    db = SessionLocal()
    try:
        username = f"kb-test-{uuid.uuid4().hex[:8]}"
        user = User(
            username=username,
            email=f"{username}@example.com",
            hashed_password="x",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id, user.username)
        return user, token
    finally:
        db.close()


def _cleanup_user(user_id: int):
    db = SessionLocal()
    try:
        db.query(User).filter_by(id=user_id).delete()
        db.commit()
    finally:
        db.close()


def test_conversation_crud_flow():
    user, token = _make_user()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        created = client.post("/api/kb/conversations", headers=headers).json()
        assert created["code"] == 0
        conv_id = created["data"]["id"]

        listed = client.get("/api/kb/conversations", headers=headers).json()
        assert any(c["id"] == conv_id for c in listed["data"])

        messages = client.get(f"/api/kb/conversations/{conv_id}/messages", headers=headers).json()
        assert messages["data"] == []

        deleted = client.delete(f"/api/kb/conversations/{conv_id}", headers=headers).json()
        assert deleted["code"] == 0
    finally:
        _cleanup_user(user.id)


def test_ask_stream_rejects_free_user():
    user, token = _make_user()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        created = client.post("/api/kb/conversations", headers=headers).json()
        conv_id = created["data"]["id"]

        resp = client.post(
            "/api/kb/ask_stream",
            headers=headers,
            json={
                "conversation_id": conv_id,
                "question": "test",
                "provider_id": "deepseek",
                "model_name": "deepseek-chat",
                "enable_thinking": False,
            },
        )
        assert resp.json()["code"] == 40601
    finally:
        _cleanup_user(user.id)
```

- [ ] **Step 4: Run the tests**

```bash
cd backend
/opt/anaconda3/bin/python3 -m pytest tests/test_knowledge_base_router.py -v
```
Expected: `2 passed`.

- [ ] **Step 5: Manually verify the app boots with the new router**

```bash
cd backend
/opt/anaconda3/bin/python3 -c "from app import create_app; from contextlib import asynccontextmanager
@asynccontextmanager
async def _noop(app):
    yield
app = create_app(_noop)
print([r.path for r in app.routes if '/kb' in r.path])"
```
Expected: prints a list containing `/api/kb/conversations`, `/api/kb/conversations/{conversation_id}/messages`, `/api/kb/ask_stream`, `/api/kb/index_status`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/knowledge_base.py backend/app/__init__.py backend/tests/test_knowledge_base_router.py
git commit -m "feat: add /kb/* router for knowledge base cross-note QA"
```

---

## Task 8: `services/knowledgeBase.ts` + `store/knowledgeBaseStore/index.ts`

**Files:**
- Create: `NoteFlow_frontend/src/services/knowledgeBase.ts`
- Create: `NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts`

**Interfaces:**
- Consumes: `NoteFlow_frontend/src/utils/request.ts` default export (existing, for non-streaming calls); `localStorage.getItem('noteflow-user')` token-read pattern (existing, copied from `services/chat.ts`).
- Produces (for Task 9 page component):
  - Types: `KbConversation { id, title, provider_id, model_name, created_at, updated_at }`, `KbSource { task_id, title, text, source_type }`, `KbMessage { id?, role: 'user'|'assistant', content: string, reasoning_content?: string, sources?: KbSource[] }`
  - Functions: `createConversation(): Promise<KbConversation>`, `listConversations(): Promise<KbConversation[]>`, `getConversationMessages(id: number): Promise<KbMessage[]>`, `deleteConversation(id: number): Promise<void>`, `getKbIndexStatus(): Promise<{total: number; indexed: number}>`, `askKbStream(data, handlers): Promise<void>` with `handlers: {onSources?, onReasoning?, onDelta?, onDone?, onError?, signal?}`
  - Store `useKnowledgeBaseStore`: state `{conversations: KbConversation[], activeConversationId: number | null, messages: KbMessage[]}`, actions `loadConversations()`, `newConversation()`, `selectConversation(id)`, `removeConversation(id)`, `addMessage(msg)`, `appendToLastMessage(text)`, `appendToLastReasoning(text)`, `setLastMessageSources(sources)`, `clearMessages()`. **Not** persisted to localStorage (per spec — server-persisted instead).

- [ ] **Step 1: Write the service**

`NoteFlow_frontend/src/services/knowledgeBase.ts`:
```typescript
import request from '@/utils/request'

export interface KbConversation {
  id: number
  title: string | null
  provider_id: string | null
  model_name: string | null
  created_at: string
  updated_at: string
}

export interface KbSource {
  task_id: string
  title: string
  text: string
  source_type: string
}

export interface KbMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string | null
  sources?: KbSource[] | null
}

export interface KbIndexCoverage {
  total: number
  indexed: number
}

export const createConversation = async (): Promise<KbConversation> => {
  return await request.post('/kb/conversations')
}

export const listConversations = async (): Promise<KbConversation[]> => {
  return await request.get('/kb/conversations')
}

export const getConversationMessages = async (conversationId: number): Promise<KbMessage[]> => {
  return await request.get(`/kb/conversations/${conversationId}/messages`)
}

export const deleteConversation = async (conversationId: number): Promise<void> => {
  return await request.delete(`/kb/conversations/${conversationId}`)
}

export const getKbIndexStatus = async (): Promise<KbIndexCoverage> => {
  return await request.get('/kb/index_status')
}

/** SSE 流式事件 */
export type KbStreamEvent =
  | { type: 'sources'; sources: KbSource[] }
  | { type: 'reasoning'; content: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; message_id: number }
  | { type: 'error'; message: string }

/**
 * 知识库流式问答：与 services/chat.ts 的 askQuestionStream 相同的 fetch + SSE 解析模式，
 * 多一个 reasoning 事件类型。
 */
export const askKbStream = async (
  data: {
    conversation_id: number
    question: string
    provider_id: string
    model_name: string
    enable_thinking: boolean
  },
  handlers: {
    onSources?: (sources: KbSource[]) => void
    onReasoning?: (text: string) => void
    onDelta?: (text: string) => void
    onDone?: (messageId: number) => void
    onError?: (msg: string) => void
    signal?: AbortSignal
  },
): Promise<void> => {
  const baseURL = (import.meta.env.VITE_API_BASE_URL as string) || '/api'

  let token: string | null = null
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) token = JSON.parse(stored)?.state?.token ?? null
  } catch {
    // ignore
  }

  const resp = await fetch(`${baseURL.replace(/\/$/, '')}/kb/ask_stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: handlers.signal,
  })

  if (!resp.ok || !resp.body) {
    handlers.onError?.(`请求失败（${resp.status}）`)
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    const line = raw.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    let evt: KbStreamEvent
    try {
      evt = JSON.parse(payload)
    } catch {
      return
    }
    if (evt.type === 'sources') handlers.onSources?.(evt.sources)
    else if (evt.type === 'reasoning') handlers.onReasoning?.(evt.content)
    else if (evt.type === 'delta') handlers.onDelta?.(evt.content)
    else if (evt.type === 'done') handlers.onDone?.(evt.message_id)
    else if (evt.type === 'error') handlers.onError?.(evt.message)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      chunk.split('\n').forEach(dispatch)
    }
  }
  if (buffer.trim()) buffer.split('\n').forEach(dispatch)
}
```

- [ ] **Step 2: Write the store**

`NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts`:
```typescript
import { create } from 'zustand'
import {
  createConversation,
  listConversations,
  getConversationMessages,
  deleteConversation,
  type KbConversation,
  type KbMessage,
  type KbSource,
} from '@/services/knowledgeBase'

interface KnowledgeBaseStore {
  conversations: KbConversation[]
  activeConversationId: number | null
  messages: KbMessage[]
  loaded: boolean

  loadConversations: (force?: boolean) => Promise<void>
  newConversation: () => Promise<number | null>
  selectConversation: (id: number) => Promise<void>
  removeConversation: (id: number) => Promise<void>
  addMessage: (msg: KbMessage) => void
  appendToLastMessage: (text: string) => void
  appendToLastReasoning: (text: string) => void
  setLastMessageSources: (sources: KbSource[]) => void
  clearMessages: () => void
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStore>()((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  loaded: false,

  loadConversations: async (force = false) => {
    if (get().loaded && !force) return
    try {
      const list = await listConversations()
      set({ conversations: list, loaded: true })
    } catch (error) {
      console.error('加载知识库会话列表失败', error)
    }
  },

  newConversation: async () => {
    try {
      const conv = await createConversation()
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: conv.id,
        messages: [],
      }))
      return conv.id
    } catch (error) {
      console.error('创建知识库会话失败', error)
      return null
    }
  },

  selectConversation: async (id: number) => {
    set({ activeConversationId: id, messages: [] })
    try {
      const messages = await getConversationMessages(id)
      set({ messages })
    } catch (error) {
      console.error('加载知识库会话消息失败', error)
    }
  },

  removeConversation: async (id: number) => {
    try {
      await deleteConversation(id)
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
        messages: state.activeConversationId === id ? [] : state.messages,
      }))
    } catch (error) {
      console.error('删除知识库会话失败', error)
    }
  },

  addMessage: (msg: KbMessage) => {
    set((state) => ({ messages: [...state.messages, msg] }))
  },

  appendToLastMessage: (text: string) => {
    set((state) => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = { ...last, content: last.content + text }
      return { messages }
    })
  },

  appendToLastReasoning: (text: string) => {
    set((state) => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = {
        ...last,
        reasoning_content: (last.reasoning_content ?? '') + text,
      }
      return { messages }
    })
  },

  setLastMessageSources: (sources: KbSource[]) => {
    set((state) => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = { ...last, sources }
      return { messages }
    })
  },

  clearMessages: () => set({ messages: [] }),
}))
```

- [ ] **Step 3: Typecheck**

```bash
cd NoteFlow_frontend
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add NoteFlow_frontend/src/services/knowledgeBase.ts NoteFlow_frontend/src/store/knowledgeBaseStore/index.ts
git commit -m "feat: add knowledgeBase service and store"
```

---

## Task 9: `pages/KnowledgeBasePage/` UI + sidebar nav entry + route registration

**Files:**
- Create: `NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx`
- Modify: `NoteFlow_frontend/src/pages/Index.tsx` (nav item)
- Modify: `NoteFlow_frontend/src/App.tsx` (lazy import + route)

**Interfaces:**
- Consumes: `useKnowledgeBaseStore` (Task 8), `askKbStream`/`getKbIndexStatus` (Task 8), `useModelStore` (existing, for model dropdown), `useUserStore` (existing, for Pro check via `activeSubscription`), `ConfirmDialog` (existing), `@ant-design/x` `Bubble`/`Sender` (existing dependency, used by `ChatPanel.tsx`).
- Produces: the routed page at `/knowledge-base`; no other module depends on this file's exports (it's a leaf page component).

- [ ] **Step 1: Write the page component (part 1 — imports, state, effects)**

`NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx`:
```tsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bubble, Sender } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { toast } from 'react-hot-toast'
import {
  BookOpen,
  Plus,
  Trash2,
  UserRound,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useKnowledgeBaseStore } from '@/store/knowledgeBaseStore'
import { useModelStore } from '@/store/modelStore'
import { useUserStore } from '@/store/userStore'
import { askKbStream, getKbIndexStatus, type KbSource } from '@/services/knowledgeBase'
import logo from '@/assets/icon.svg'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

const DEFAULT_QUESTIONS = [
  '总结一下我最近几篇笔记的核心内容',
  '我的笔记里提到过哪些工具或产品？',
  '帮我梳理一下这些笔记之间的共同主题',
  '有没有哪篇笔记的观点互相矛盾？',
]

function SourceBadges({ sources }: { sources: KbSource[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        <BookOpen className="h-3 w-3" />
        <span>引用来源 ({sources.length})</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sources.map((s, i) => (
            <Badge key={i} variant="outline" className="text-xs font-normal">
              {s.title || '笔记'}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function ReasoningCard({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(streaming)
  if (!content) return null

  return (
    <div className="mb-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-left font-medium text-neutral-500"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        <span>{streaming ? '正在深度思考...' : '已深度思考'}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && <div className="mt-1.5 whitespace-pre-wrap text-neutral-400">{content}</div>}
    </div>
  )
}

export default function KnowledgeBasePage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [coverage, setCoverage] = useState<{ total: number; indexed: number } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)

  const conversations = useKnowledgeBaseStore((s) => s.conversations)
  const activeConversationId = useKnowledgeBaseStore((s) => s.activeConversationId)
  const messages = useKnowledgeBaseStore((s) => s.messages)
  const loadConversations = useKnowledgeBaseStore((s) => s.loadConversations)
  const newConversation = useKnowledgeBaseStore((s) => s.newConversation)
  const selectConversation = useKnowledgeBaseStore((s) => s.selectConversation)
  const removeConversation = useKnowledgeBaseStore((s) => s.removeConversation)
  const addMessage = useKnowledgeBaseStore((s) => s.addMessage)
  const appendToLastMessage = useKnowledgeBaseStore((s) => s.appendToLastMessage)
  const appendToLastReasoning = useKnowledgeBaseStore((s) => s.appendToLastReasoning)
  const setLastMessageSources = useKnowledgeBaseStore((s) => s.setLastMessageSources)

  const user = useUserStore((s) => s.user)
  const activeSubscription = useUserStore((s) => s.activeSubscription)
  const isPro = !!activeSubscription
  const userAvatarSrc = user?.avatar
    ? user.avatar.startsWith('http') ? user.avatar : `${API_BASE}${user.avatar}`
    : null

  const modelList = useModelStore((s) => s.modelList)
  const loadEnabledModels = useModelStore((s) => s.loadEnabledModels)

  useEffect(() => {
    loadConversations()
    if (modelList.length === 0) loadEnabledModels()
    getKbIndexStatus()
      .then(setCoverage)
      .catch(() => setCoverage({ total: 0, indexed: 0 }))
  }, [])

  useEffect(() => {
    if (!selectedModelKey && modelList.length > 0) {
      const first = modelList[0]
      setSelectedModelKey(`${first.provider_id}::${first.model_name}`)
    }
  }, [modelList, selectedModelKey])

  const selectedModel = useMemo(() => {
    const [providerId, modelName] = selectedModelKey.split('::')
    return modelList.find((m) => m.provider_id === providerId && m.model_name === modelName)
  }, [selectedModelKey, modelList])

  useEffect(() => {
    if (!selectedModel?.supports_reasoning) setEnableThinking(false)
  }, [selectedModel])
```

- [ ] **Step 2: Write the page component (part 2 — send handler, delete handler)**

Append directly after the `useEffect` block from Step 1 (still inside the `KnowledgeBasePage` function body):
```tsx

  const handleSend = useCallback(
    async (value: string) => {
      const question = value.trim()
      if (!question || loading || !selectedModel) return

      let conversationId = activeConversationId
      if (!conversationId) {
        conversationId = await newConversation()
        if (!conversationId) {
          toast.error('创建会话失败，请重试')
          return
        }
      }

      addMessage({ role: 'user', content: question })
      setInput('')
      setLoading(true)
      addMessage({ role: 'assistant', content: '', reasoning_content: '' })

      try {
        await askKbStream(
          {
            conversation_id: conversationId,
            question,
            provider_id: selectedModel.provider_id,
            model_name: selectedModel.model_name,
            enable_thinking: enableThinking && !!selectedModel.supports_reasoning,
          },
          {
            onSources: (sources) => setLastMessageSources(sources),
            onReasoning: (text) => appendToLastReasoning(text),
            onDelta: (text) => appendToLastMessage(text),
            onError: (msg) => {
              appendToLastMessage(msg || '知识库问答失败')
              toast.error(msg || '知识库问答失败')
            },
          },
        )
        loadConversations(true)
      } catch {
        appendToLastMessage('\n\n（请求中断）')
        toast.error('知识库问答失败')
      } finally {
        setLoading(false)
      }
    },
    [loading, selectedModel, activeConversationId, enableThinking, newConversation, addMessage, appendToLastMessage, appendToLastReasoning, setLastMessageSources, loadConversations],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (deleteTargetId == null) return
    await removeConversation(deleteTargetId)
    setDeleteTargetId(null)
  }, [deleteTargetId, removeConversation])
```

- [ ] **Step 3: Write the page component (part 3 — Pro gate + no-notes gate early returns)**

Append directly after the handlers from Step 2:
```tsx

  if (!isPro) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <BookOpen className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-medium text-gray-800">知识库为会员专属功能</p>
          <p className="mt-1 text-sm text-neutral-400">升级 Pro 即可对全部笔记进行跨笔记 AI 问答</p>
        </div>
        <Button asChild>
          <Link to="/upgrade">升级 Pro →</Link>
        </Button>
      </div>
    )
  }

  if (coverage && coverage.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-light)] text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-medium text-gray-800">还没有笔记</p>
          <p className="mt-1 text-sm text-neutral-400">先去工作台生成第一篇笔记，再回来开始知识库问答</p>
        </div>
        <Button asChild>
          <Link to="/">去工作台 →</Link>
        </Button>
      </div>
    )
  }
```

- [ ] **Step 4: Write the page component (part 4 — bubble config + JSX return, sidebar + main panel)**

Append directly after the early-return block from Step 3:
```tsx

  const bubbleItems = useMemo(() => {
    return messages.map((msg, i) => {
      const isLast = i === messages.length - 1
      const pending = loading && isLast && msg.role === 'assistant' && msg.content === '' && !msg.reasoning_content
      return {
        key: `kb-msg-${i}`,
        role: msg.role === 'user' ? ('user' as const) : ('ai' as const),
        content: pending ? '思考中...' : msg.content,
        loading: pending,
        footer:
          msg.role === 'assistant' ? (
            <>
              {msg.reasoning_content && (
                <ReasoningCard
                  content={msg.reasoning_content}
                  streaming={loading && isLast && msg.content === ''}
                />
              )}
              {msg.sources && <SourceBadges sources={msg.sources} />}
            </>
          ) : undefined,
      }
    })
  }, [messages, loading])

  const roles = useMemo(
    () => ({
      user: {
        placement: 'end' as const,
        avatar: (
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-teal-600 text-white">
            {userAvatarSrc ? (
              <img src={userAvatarSrc} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </div>
        ),
        variant: 'filled' as const,
        styles: { content: { background: '#167a6e', color: '#fff' } },
      },
      ai: {
        placement: 'start' as const,
        avatar: <img src={logo} alt="AI" className="h-7 w-7 object-contain" />,
        variant: 'outlined' as const,
        contentRender: (content: any) => (
          <div className="markdown-body !bg-transparent text-sm [&_*]:!bg-transparent">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {typeof content === 'string' ? content : String(content)}
            </ReactMarkdown>
          </div>
        ),
      },
    }),
    [userAvatarSrc],
  )

  return (
    <div className="flex h-full">
      {/* 左侧会话历史 */}
      <div className="flex w-64 shrink-0 flex-col border-r">
        <div className="p-3">
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            onClick={() => newConversation()}
          >
            <Plus className="h-4 w-4" />
            新对话
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-neutral-400">还没有历史对话</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  activeConversationId === c.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-700 hover:bg-neutral-100'
                }`}
              >
                <span className="truncate">{c.title || '新对话'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTargetId(c.id)
                  }}
                  className="shrink-0 text-neutral-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧主问答区 */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-hidden">
          {messages.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-5 py-6">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-gray-800">你的第二大脑，随时开问</h1>
                <p className="mt-1.5 text-sm text-neutral-400">跨笔记检索并引用来源笔记，一起梳理你积累的知识</p>
              </div>
              <div className="w-full max-w-md space-y-2">
                {DEFAULT_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSend(q)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-primary/40 hover:bg-[var(--primary-light)] hover:text-primary"
                  >
                    <span className="flex-1 truncate">{q}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-colors group-hover:text-primary" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Bubble.List items={bubbleItems} role={roles} style={{ height: '100%' }} />
          )}
        </div>

        {/* 底部输入区 */}
        <div className="border-t px-3 py-2">
          <div className="mb-2 flex items-center gap-2">
            <Select value={selectedModelKey} onValueChange={setSelectedModelKey}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem key={`${m.provider_id}::${m.model_name}`} value={`${m.provider_id}::${m.model_name}`}>
                    {m.model_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              className="flex items-center gap-1.5 text-xs text-neutral-500"
              title={selectedModel?.supports_reasoning ? '' : '当前模型不支持深度思考'}
            >
              <Switch
                checked={enableThinking}
                onCheckedChange={setEnableThinking}
                disabled={!selectedModel?.supports_reasoning}
              />
              <span>深度思考</span>
            </div>

            {coverage && coverage.indexed < coverage.total && (
              <span className="text-xs text-neutral-400">
                {coverage.indexed}/{coverage.total} 篇笔记已索引，其余正在后台处理
              </span>
            )}
          </div>

          <Sender value={input} onChange={setInput} onSubmit={handleSend} loading={loading} placeholder="输入你的问题..." />
          <p className="mt-1.5 text-center text-xs text-neutral-300">知识库为会员功能</p>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTargetId != null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        title="删除对话"
        description="删除后该对话的所有消息将无法恢复。"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
```

- [ ] **Step 5: Add the sidebar nav entry**

In `NoteFlow_frontend/src/pages/Index.tsx`, add `BookOpen` to the lucide-react import (line 3-17), then insert into `NAV_ITEMS` right after the `笔记合集` entry (line 30):
```typescript
  { icon: BookOpen, label: '知识库', to: '/knowledge-base' },
```
Then, in the `NAV_ITEMS.map` render loop (around line 98-124), add a Pro badge next to the label for this one item. Change the label `<span>` block to:
```tsx
                <span
                  className={`flex items-center gap-1 overflow-hidden whitespace-nowrap text-sm transition-[opacity,max-width] duration-200 ${
                    collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
                  } ${isUpgrade ? 'font-semibold' : ''}`}
                >
                  {label}
                  {to === '/knowledge-base' && (
                    <span className="rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-800">Pro</span>
                  )}
                </span>
```

- [ ] **Step 6: Register the route**

In `NoteFlow_frontend/src/App.tsx`, add the lazy import after `CollectionDetailPage` (line 77):
```typescript
const KnowledgeBasePage = lazy(() => import('@/pages/KnowledgeBasePage'))
```
And add the route after `collections/:id` (line 172):
```tsx
              <Route path="knowledge-base" element={<KnowledgeBasePage />} />
```

- [ ] **Step 7: Typecheck and build**

```bash
cd NoteFlow_frontend
npx tsc --noEmit
```
Expected: no new errors.

```bash
pnpm build
```
Expected: build succeeds.

- [ ] **Step 8: Manual verification**

```bash
cd NoteFlow_frontend
pnpm dev
```
Log in as a Pro test user with at least one generated note, navigate to `/knowledge-base`, verify: nav item shows with Pro badge; empty state shows title + 4 preset questions; sending a question streams `sources` → (if a `supports_reasoning=1` model with 深度思考 on) `reasoning` → `delta` chunks rendered as Markdown; conversation appears in the left history list; refreshing the page and reselecting the conversation restores its messages; deleting a conversation via the trash icon + confirm dialog removes it. Then log in as a free (non-Pro) test user and verify the Pro-gate empty state renders instead. Stop the dev server after verifying.

- [ ] **Step 9: Commit**

```bash
git add NoteFlow_frontend/src/pages/KnowledgeBasePage/index.tsx NoteFlow_frontend/src/pages/Index.tsx NoteFlow_frontend/src/App.tsx
git commit -m "feat: add KnowledgeBasePage with cross-note QA UI, nav entry, and route"
```

