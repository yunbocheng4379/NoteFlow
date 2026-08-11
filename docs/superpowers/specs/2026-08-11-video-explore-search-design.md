# 视频探索搜索功能 · 设计文档

**Date**: 2026-08-11
**Status**: Draft (awaiting user review)
**Scope**: MVP — B站 + YouTube 关键词搜索，供用户从首页发现视频后一键生成笔记

---

## 1. 背景与目标

现有笔记生成流程要求用户**先拿到视频 URL** 再粘贴到首页输入框。对于"我想看看关于 XX 的视频"这种探索型需求，用户需要跳出到 B站 / YouTube 手动搜索、复制链接、再回到 NoteFlow 粘贴 —— 割裂且低效。

本功能在首页 EmptyState 上增加一个"探索"入口，用户输入关键词即可在 B站 + YouTube 同时搜索，卡片式展示结果，一键触发笔记生成。

**成功标准**：
- 用户输入关键词后 ≤ 5 秒看到结果（p95）
- 单平台故障时另一平台结果仍能展示
- 点击卡片即进入 EmptyState 现有的 `handleQuickGenerate` 流程，跟粘贴 URL 行为完全一致
- 卡片"更多设置"按钮调用 EmptyState 现有的 `onMoreSettings` 打开 NoteForm 弹窗（视频信息已预填）

---

## 2. 范围

**In scope**（MVP）：
- 后端 `GET /api/video_search?q=<keyword>` 接口
- B站搜索走 `api.bilibili.com/x/web-interface/search/type` 公开接口
- YouTube 搜索走 `yt_dlp` 的 `ytsearch20:` 前缀
- 并行调度、平台交错排序、单平台故障容错
- 前端 EmptyState 双 tab（"链接" / "探索"）
- ExplorePanel 组件：搜索框 + 结果网格 + 加载/空态
- ResultCard 组件：封面、标题、平台、时长、作者、点击 = 快速生成、右上"更多设置"按钮

**Out of scope**（后续迭代或永不做）：
- 抖音 / 快手 / TikTok 搜索（下一版本）
- 多选批量生成、加入合集
- 结果分页 / 加载更多
- 搜索历史、热搜推荐
- 探索 tab 挂到 NoteForm 弹窗（等 EmptyState 验证效果后再评估）
- 后端搜索结果缓存（yt-dlp 本身够慢，加缓存后续再说）
- 接口级速率限制（如被滥用再补）

---

## 3. 架构

### 3.1 后端组件

```
backend/app/
├── services/video_search/          # 新增，隔离搜索逻辑
│   ├── __init__.py                 # 导出 search_all
│   ├── base.py                     # SearchResult (dataclass), BaseSearcher (Protocol)
│   ├── bilibili_searcher.py        # httpx 调 B站公开搜索接口
│   ├── youtube_searcher.py         # yt_dlp ytsearch20:
│   └── aggregator.py               # asyncio.gather 并行 + 交错合并 + 去重
└── routers/
    └── video_search.py             # GET /api/video_search
```

**关键边界**：
- `video_search/` 目录与 `downloaders/` 完全解耦，不共享代码路径
- `SearchResult` dataclass 只包含前端展示所需字段，不外泄 raw yt-dlp / B站响应结构

### 3.2 前端组件

```
NoteFlow_frontend/src/
├── pages/HomePage/components/
│   ├── EmptyState.tsx              # 修改：顶部加 "链接 | 探索" tab 切换
│   └── ExplorePanel/               # 新增目录
│       ├── index.tsx               # 搜索框 + 结果网格 + 状态管理
│       └── ResultCard.tsx          # 单个视频卡片
└── services/
    └── videoSearch.ts              # 新增 API client（一个函数）
```

**关键边界**：
- `ExplorePanel` 不持有笔记生成的任何表单状态。生成流程通过 props 回调委托给 EmptyState：
  - `onQuickGenerate(prefill: { video_url, platform })` — 复用 EmptyState 的 `handleQuickGenerate`
  - `onMoreSettings(prefill: { video_url, platform })` — 复用 EmptyState 已有同名 prop
- 搜索结果的 useState 仅存活于 ExplorePanel 内，不进 zustand

---

## 4. 接口契约

### 4.1 HTTP

**`GET /api/video_search`**

Query 参数：
| 名称 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `q` | string | 是 | 关键词，trim 后长度 [1, 50]，超出返回 400 |
| `limit` | int | 否 | 每平台条数，默认 20，clamp 到 [1, 20] |

Response（走 `ResponseWrapper`）：
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "keyword": "瑞克",
    "total": 38,
    "items": [
      {
        "platform": "bilibili",
        "video_url": "https://www.bilibili.com/video/BV1xx",
        "title": "《瑞克和莫蒂 全1-9季》超清双字...",
        "cover_url": "https://i2.hdslb.com/bfs/archive/xxx.jpg",
        "author": "光年字幕组",
        "duration": 645,
        "publish_time": "2024-03-12",
        "play_count": 123456
      }
    ],
    "platform_status": {
      "bilibili": "ok",
      "youtube": "ok"
    }
  }
}
```

**字段约束**：
- `platform`: `"bilibili" | "youtube"`
- `duration`: 秒，可能为 `null`（YouTube 直播/极短片可能拿不到）
- `publish_time`: ISO date `"YYYY-MM-DD"`，YouTube flat 模式拿不到时为 `null`
- `play_count`: 可能为 `null`
- `platform_status[platform]`: `"ok" | "failed"`，前端据此提示单平台故障

**错误响应**：
- `q` 缺失/超长：`400` + `msg`
- 两平台都失败：**返回 200**，`data.items = []`，`data.total = 0`，`platform_status` 都是 `"failed"`（不算业务错误）

### 4.2 SearchResult dataclass（`services/video_search/base.py`）

```python
@dataclass
class SearchResult:
    platform: Literal["bilibili", "youtube"]
    video_url: str
    title: str
    cover_url: str | None
    author: str | None
    duration: int | None       # 秒
    publish_time: str | None   # ISO date "YYYY-MM-DD"
    play_count: int | None
```

---

## 5. 数据流

### 5.1 后端并行调度

```python
# services/video_search/aggregator.py
async def search_all(keyword: str, per_platform: int = 20) -> list[SearchResult]:
    tasks = [
        bilibili_search(keyword, per_platform),
        youtube_search(keyword, per_platform),
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    per_platform_lists = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"video_search platform failed: {r}")
            per_platform_lists.append([])
        else:
            per_platform_lists.append(r)

    return interleave_and_dedupe(per_platform_lists)
```

**排序**：交错（B, Y, B, Y, ...），同平台内保持返回顺序。
**去重**：以 `video_url` 为唯一键（几乎不会碰撞，兜底而已）。

### 5.2 B 站 searcher

**端点**：`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=<kw>&page=1&pagesize=<n>`

**Header**（必须）：
```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
Referer: https://www.bilibili.com
```
不需要 Cookie。

**HTTP 客户端**：`httpx.AsyncClient(timeout=10.0)`，与项目其它 http 调用风格一致。

**字段映射**（B站响应 `data.result[]`，过滤 `type == "video"`）：
| B站字段 | SearchResult 字段 | 处理 |
|---|---|---|
| `bvid` + `arcurl` | `video_url` | 优先用 `arcurl`（已含 https 前缀） |
| `pic` | `cover_url` | 可能返回 `//` 开头，直接返回，前端 image_proxy 处理 |
| `author` | `author` | 直接映射 |
| `duration` | `duration` | 返回 `"MM:SS"` 或 `"H:MM:SS"` 字符串，转成秒 |
| `pubdate` | `publish_time` | Unix 秒级时间戳，转 `"YYYY-MM-DD"` |
| `play` | `play_count` | 直接映射 |
| `title` | `title` | **必须**用 `re.sub(r'<[^>]+>', '', title)` 去除搜索接口返回的 `<em>` 高亮标签 |

### 5.3 YouTube searcher

**yt_dlp 调用**：
```python
opts = {
    'quiet': True,
    'skip_download': True,
    'extract_flat': True,
    'default_search': 'ytsearch',
}
# 在 loop.run_in_executor 里跑（yt_dlp 是同步阻塞）
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(f"ytsearch{n}:{keyword}", download=False)
entries = info.get('entries', [])
```

**字段映射**（flat 模式下的 entry）：
| entry 字段 | SearchResult 字段 | 处理 |
|---|---|---|
| `id` | `video_url` | 拼成 `f"https://www.youtube.com/watch?v={id}"` |
| `title` | `title` | 直接映射 |
| `thumbnails[-1]['url']` | `cover_url` | 取最后一个（分辨率通常最高），若不存在则用 `f"https://i.ytimg.com/vi/{id}/hqdefault.jpg"` 兜底 |
| `uploader` 或 `channel` | `author` | 优先 `uploader` |
| `duration` | `duration` | 已经是秒，可能为 `None` |
| `view_count` | `play_count` | 可能为 `None` |
| （无） | `publish_time` | flat 模式拿不到，返回 `None` |

**并发规避**：yt_dlp 是同步阻塞，使用 `asyncio.get_running_loop().run_in_executor(None, ...)` 包装。

### 5.4 前端交互

```
用户在 ExplorePanel 输入 keyword
  → 300ms debounce
  → axios GET /api/video_search?q=xxx
  → items 存入 useState<SearchResult[]>
  → 网格渲染（每行 3 列，卡片纵向布局）
    → 点击卡片主体 → props.onQuickGenerate({video_url, platform})
    → 点击右上"更多设置"按钮 → props.onMoreSettings({video_url, platform})
    → 点击封面/标题也可打开视频原页（新标签，可选）
```

**Loading 状态**：搜索中显示骨架屏（6 个占位卡片）。
**空态**：`items.length === 0 && !loading && keyword` → "未找到与 XXX 相关的视频，请换个关键词试试"。
**初始态**：`keyword === ''` → "输入关键词，一键搜索 B站 + YouTube 视频"。

---

## 6. 错误处理

| 场景 | 后端 | 前端 |
|---|---|---|
| B站接口 -412 / timeout / 5xx | log warning，该平台返回 `[]` | 结果里只有 YouTube 时，顶部 toast "B站搜索暂不可用" |
| yt_dlp 抛异常 | 同上 | 同上（换成 YouTube 提示） |
| 两平台都失败 | `code=0`, `items=[]`, `total=0` | 显示空态 |
| `q` 为空或超长 | 400 + msg | 输入框下方红字（`react-hook-form` 或本地 useState） |
| 网络异常 | — | axios 拦截器已有全局 toast，保留搜索框内容可重试 |

**关键设计**：**单平台失败不阻塞另一个**（`asyncio.gather(return_exceptions=True)`）；用户绝不会因为搜索看到 500。

前端如何知道"哪个平台失败了"？后端在响应 header 或 `data` 里加 `platform_status`：
```json
"data": {
  "keyword": "...",
  "total": 20,
  "items": [...],
  "platform_status": {
    "bilibili": "ok",       // "ok" | "failed"
    "youtube": "ok"
  }
}
```
前端根据 `platform_status` 决定是否展示"XX 搜索暂不可用"toast。

---

## 7. 测试策略

### 7.1 后端测试（`backend/tests/test_video_search.py`）

- `test_bilibili_search_parses_response()` — mock `httpx.AsyncClient`，喂 B站真实响应样本，断言字段映射（含 `<em>` 标签清理、duration 字符串转秒、pubdate 时间戳转 ISO）
- `test_youtube_search_parses_flat_result()` — mock `yt_dlp.YoutubeDL`，喂 flat entry 样本，断言 URL 拼接和字段映射
- `test_aggregator_interleaves_results()` — 断言 [B1,B2,B3] + [Y1,Y2,Y3] 交错为 [B1,Y1,B2,Y2,B3,Y3]
- `test_aggregator_survives_single_platform_failure()` — 一个 platform 抛异常，另一个正常返回，结果只含成功平台且 `platform_status` 正确
- `test_aggregator_both_failed()` — 两平台都异常，返回 empty list，`platform_status` 都是 `"failed"`
- `test_router_validates_query()` — `q` 空 / 超过 50 字符返回 400
- `test_duration_string_to_seconds()` — `"10:45"` → 645，`"1:02:03"` → 3723，`"0"` → 0
- `test_bilibili_filters_non_video_types()` — B站响应里混入 `type="live"` 的 entry，被过滤掉

### 7.2 前端人工验证清单

- [ ] EmptyState 顶部出现 "链接 | 探索" tab，默认停留在"链接"
- [ ] 切到"探索"tab，输入"瑞克"，看到 ~40 个卡片
- [ ] 每个卡片显示：封面、标题、平台角标（B站/YouTube）、时长、作者
- [ ] 点击卡片主体，进入笔记生成流程（跟 EmptyState 粘贴 URL 后点"快速生成"完全一致）
- [ ] 点击卡片右上"更多设置"按钮，NoteForm 弹窗打开，`video_url` 和 `platform` 已预填
- [ ] 断网重试，页面不崩溃
- [ ] 搜索"aksldfjaklsdjf"这种无结果关键词，看到空态提示
- [ ] （可选）本地临时把 bilibili_searcher.py 里的 API URL 改错模拟风控，验证只显示 YouTube 结果 + toast 提示

**不做前端单元测试**：项目当前无前端测试基建，MVP 阶段不引入 vitest。

---

## 8. 依赖与配置

- **无新增 Python 包**：`httpx` 和 `yt_dlp` 均已在 `requirements.txt`
- **无新增前端包**：使用现有 `axios`、`react-hot-toast`、shadcn/ui
- **无新增环境变量**
- **无数据库变更**

---

## 9. 上线与回滚

- 功能纯增量，无侵入现有代码路径
- 回滚 = 隐藏 EmptyState 的"探索"tab（一行代码）
- 后端路由不注册即完全下线
