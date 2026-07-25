# 知识库跨笔记 AI 问答 — 设计文档

日期：2026-07-26

## 背景与目标

在现有单笔记 RAG 问答（`chat_service.py` / `/chat/*`）基础上，新增一个"知识库"入口：用户可对**自己名下全部笔记**进行跨笔记 AI 问答，支持模型选择、深度思考开关（流式返回思考过程）、多会话历史管理，全部用 SSE 流式返回并以 Markdown 渲染。功能对齐参考截图的产品形态，仅限 Pro 会员使用。

不在本次范围内：
- 引用跳转到原视频精确时间点（后续独立任务）
- 检索范围的合集/子集筛选（先做"全部笔记"）
- Function Calling 工具调用（纯 RAG，不做主动查询工具）
- 历史上下文摘要压缩（先用固定条数截断）

## 架构总览

新增一套独立子系统，与现有单笔记问答（`chat_service.py`、`/chat/*`、`chatStore`）**并行存在，不修改其代码**：

- 后端：`app/services/knowledge_base_service.py`（问答核心逻辑）、`app/routers/knowledge_base.py`（路由，`prefix=/kb`）、`app/db/kb_dao.py`（会话/消息 DAO）
- 向量检索：复用现有 `VectorStoreManager` 的 per-task collection 存储与索引写入逻辑，新增一个跨 collection 查询方法
- LLM 调用：复用 `GPTFactory`/`ProviderService`/`ModelConfig`，新增 reasoning 相关的可选参数透传
- 前端：新页面 `pages/KnowledgeBasePage/`，新 store `store/knowledgeBaseStore/`，新 service `services/knowledgeBase.ts`，复用现有 markdown 渲染栈（`react-markdown`+`remark-gfm`+`remark-math`+`rehype-katex`）与 `@ant-design/x` 的 `Bubble`/`Sender` 组件

## 数据库设计

沿用项目现有规范：SQLAlchemy model（供 `init_db()`/新库自动建表）+ 手写 `migrate_add_xxx.py`（Python，供已有库幂等升级）+ `sql/migrate_add_xxx.sql`（纯 SQL，供直接 `mysql <` 导入）三件套，并在 `app/db/init_db.py` 里 import 新 model。

### `kb_conversations`（知识库会话）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO_INCREMENT | 会话 ID |
| user_id | INT, index | 所属用户 |
| title | VARCHAR(200) NULL | 会话标题，首次提问后取问题前 30 字自动生成 |
| provider_id | VARCHAR(64) NULL | 该会话最近使用的供应商 ID，用于下次打开默认选中 |
| model_name | VARCHAR(128) NULL | 该会话最近使用的模型名 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最近一次问答时间，用于会话列表排序 |

### `kb_messages`（知识库消息）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INT PK AUTO_INCREMENT | 消息 ID |
| conversation_id | INT, FK→kb_conversations.id ON DELETE CASCADE, index | 所属会话 |
| role | VARCHAR(16) | `user` / `assistant` |
| content | TEXT | 最终答案正文（不含思考过程），或用户提问内容 |
| reasoning_content | TEXT NULL | 深度思考过程内容，仅 assistant 且开启深度思考时有值 |
| sources | TEXT NULL | JSON 字符串，引用的跨笔记片段列表（含 task_id、笔记标题、片段文本） |
| created_at | DATETIME | 创建时间，决定消息在会话内的顺序 |

### `kb_index_status`（知识库向量索引状态，持久化修复项）

现有单笔记问答的索引状态 `_index_status` 是 `routers/chat.py` 里的进程内 `dict`，重启即丢失。知识库场景需要批量判断"用户所有笔记里哪些已索引"，顺带把这个状态持久化，供 `/chat/*` 和 `/kb/*` 共用。

| 列 | 类型 | 说明 |
|---|---|---|
| task_id | VARCHAR(64) PK | 对应 `video_tasks.task_id` |
| status | VARCHAR(16) | `indexing` / `indexed` / `failed` |
| updated_at | DATETIME | 最近状态变更时间 |

`routers/chat.py` 里现有的 `_index_status` dict 读写点全部改为读写该表（同一批修改内完成，避免两套状态源不一致）。

### `models` 表新增列

新增 `supports_reasoning TINYINT NOT NULL DEFAULT 0`，管理员在模型管理页勾选哪些模型原生支持 reasoning（如 `deepseek-reasoner`、Qwen thinking 系列）。前端"深度思考"开关仅对 `supports_reasoning=1` 的模型可点亮。

## 向量检索：跨笔记查询

`VectorStoreManager` 新增方法（不改动现有 `index_task`/`query`/`delete_index`）：

```python
def query_multi(self, task_ids: list[str], query_text: str, per_task_n: int = 4, top_k: int = 8) -> list[dict]:
    """对多个 task_id 的 collection 分别按现有配额检索，合并按 distance 排序取全局 top_k，
    每条结果的 metadata 补充 task_id 字段，供上层标注来源笔记。"""
```

跨笔记问答服务侧的检索流程：
1. 查 `video_tasks` 表拿该 `user_id` 名下全部 `task_id`
2. 查 `kb_index_status` 过滤出 `status='indexed'` 的子集
3. 对未索引的 task_id，后台异步触发 `index_task`（复用现有逻辑），本次回答不等待，仅用已索引部分
4. 调 `query_multi` 拿 top_k 片段，构建 context 与 sources（每条来源标注笔记标题 + task_id，不含精确时间点跳转）

若用户名下没有任何 `video_tasks`，前端直接禁止提问，提示去工作台生成笔记，不发起请求。

## LLM 调用与深度思考

复用 `GPTFactory.from_config` 拿到的 `UniversalGPT.client`（底层 openai SDK client），问答服务自己组 `messages` 并调用 `chat.completions.create(stream=True, ...)`，与现有 `chat_service.py` 的流式实现模式一致。

深度思考仅对 `models.supports_reasoning=1` 的模型生效：
- 请求时若模型是 DeepSeek reasoner 系列：不需要额外参数，正常调用即可，SDK 返回的流式 chunk 的 `delta` 上会带非标准字段 `reasoning_content`（openai SDK 的 `BaseModel` 是 `extra="allow"`，可通过 `getattr(delta, "reasoning_content", None)` 安全读取，不会因未声明字段报错）
- 若是 Qwen thinking 系列等需要显式参数开启的模型：调用时加 `extra_body={"enable_thinking": True}`
- 若用户关闭深度思考开关，或所选模型 `supports_reasoning=0`：不传任何 reasoning 相关参数，只走普通 `content` delta，不尝试读 `reasoning_content`

流式生成器区分两类 delta，分别 yield 为不同 SSE 事件类型：

```
{"type": "sources", "sources": [...]}          先下发跨笔记来源
{"type": "reasoning", "content": "..."}         思考过程片段（仅开启时有）
{"type": "delta", "content": "..."}             正式答案片段
{"type": "done", "message_id": 123}             结束，携带落库后的消息 ID
{"type": "error", "message": "..."}             出错
```

## 会话与上下文管理

- 新对话：`POST /kb/conversations` 建一行 `kb_conversations`（`title` 为 NULL），首次提问后用问题前 30 字回填 `title`
- 每次提问：先插入一条 `role=user` 的 `kb_messages`；流式过程中在内存累积 `content`/`reasoning_content`；SSE `done` 时一次性插入 `role=assistant` 消息（含 `sources` JSON），并更新 `kb_conversations.updated_at`
- 上下文构建：从数据库读该 `conversation_id` 最近 20 条消息（`content` 字段），拼进 `messages`；**不带入 `reasoning_content`**——按主流做法，上一轮的思考过程不作为下一轮上下文，只传最终答案
- 会话列表按 `updated_at` 倒序；支持删除（级联删消息）

## 权限（Pro 限定）

参照 `routers/model.py` 里 `_tier_filter_for` 的模式，新增一个轻量 helper：

```python
def _require_pro(user: User) -> None:
    if not user.active_subscription_id:
        raise BizException(msg="知识库为会员功能，请升级 Pro", code=STATUS_CODE_NOT_PRO)
```

`/kb/*` 除会话/消息的只读列表外，核心的 `POST /kb/ask_stream` 必须校验。前端捕获对应错误码后引导跳转 `/upgrade`（复用现有升级页，不新建引导页）。

## 后端 API

全部要求 `get_current_user`，`prefix=/kb`：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /kb/conversations | 新建会话，返回 conversation_id |
| GET | /kb/conversations | 会话列表（按 user_id 过滤，updated_at 倒序） |
| GET | /kb/conversations/{id}/messages | 拉取该会话历史消息 |
| DELETE | /kb/conversations/{id} | 删除会话（级联删消息），校验归属 |
| POST | /kb/ask_stream | 核心问答：body `{conversation_id, question, provider_id, model_name, enable_thinking}`，SSE 流式返回，需 Pro |
| GET | /kb/index_status | 返回当前用户笔记索引覆盖情况（已索引数/总数），用于页面提示 |

## 前端设计

- 路由：`App.tsx` 懒加载新增 `<Route path="knowledge-base" element={<KnowledgeBasePage />} />`
- 侧边栏：`pages/Index.tsx` 的 `NAV_ITEMS` 在"笔记合集"之后插入 `{ icon: BookOpen, label: '知识库', to: '/knowledge-base' }`，标签旁加 amber Pro 徽章（复用 `Form.tsx` 里现成的徽章样式）
- 页面布局（对齐参考图）：左侧会话历史列表（新建对话按钮 + 会话条目，可删除）+ 右侧主问答区：
  - 空状态：大标题 + 4 个预置问题按钮（模式参照 `ChatPanel.tsx` 的 `DEFAULT_QUESTIONS`）
  - 有消息：`Bubble.List` 渲染对话，assistant 消息里若有 `reasoning_content` 则先渲染一个可折叠的"思考过程"卡片（灰底小字号，折叠时显示"已深度思考"摘要行），再渲染正式答案（`ReactMarkdown` + `remarkGfm`/`remarkMath`/`rehypeKatex`),末尾展示来源笔记标注（笔记标题徽章，无跳转)
  - 底部输入区：`Sender` + 模型选择下拉（复用现有已启用模型列表接口）+ 深度思考开关（仅当前选中模型 `supports_reasoning=1` 时可点亮，否则置灰 tooltip 提示不支持）
  - 若用户 `video_tasks` 为空：整页面禁用输入并提示"还没有笔记，去工作台生成第一篇笔记"
- Store：`store/knowledgeBaseStore/index.ts`，不做 localStorage 持久化（改为服务端持久化），只保存 `activeConversationId` 与当前消息列表的内存态
- Service：`services/knowledgeBase.ts`，独立 SSE fetch 封装（参照 `services/chat.ts` 的 `askQuestionStream` 模式，事件类型多一个 `reasoning`）

## 测试计划

- 后端：`kb_dao.py` 的会话/消息 CRUD 单测；`VectorStoreManager.query_multi` 合并排序逻辑单测；`_require_pro` 权限校验单测
- 手动验证：多笔记跨库检索准确性、深度思考开关在支持/不支持模型下的行为差异、SSE 流式在网络中断/AbortSignal 下的表现、会话历史刷新页面后仍可恢复
