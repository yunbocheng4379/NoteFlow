# NoteFlow 微信小程序架构设计

## 1. 项目概述

### 1.1 项目核心目的

NoteFlow 是一个 AI 视频笔记系统，核心能力是：**输入视频链接 → 自动转写音频 → AI 生成结构化 Markdown 笔记**。支持 Bilibili、YouTube、抖音、快手等平台，生成后的笔记可进入知识库向量索引，支持跨笔记 AI 问答、闪记卡、合集管理和导出。

### 1.2 小程序定位

小程序作为 **用户端客户端**，复用现有 FastAPI 后端 API，让微信用户可以直接在微信内完成视频笔记生成、查看、问答和管理。无需下载 App，即开即用，借助微信社交裂变获客。

### 1.3 后端 API 基础

后端运行在 `https://api.noteflow.app/api`（生产环境），所有接口已就绪：

| 模块 | 前缀 | 核心接口 |
|------|------|----------|
| 认证 | /api/auth | register, login, send-code, login-by-code, me |
| 笔记 | /api | generate_note, task_status, tasks, video_info, generate_notes_batch |
| 问答 | /api | chat/index, chat/status, chat/ask, chat/ask_stream |
| 知识库 | /api/kb | conversations CRUD, ask_stream |
| 计费 | /api/billing | balance, pricing/preview, order/recharge, subscription/plans |
| 用户 | /api/profile | get/update, password, avatar, notify |
| 分享 | /api/share | enable/disable, view |
| 合集 | /api/collections | CRUD, items, merge, export |
| 闪记卡 | /api/flashcards | generate, sets, study |
| 模型 | /api | get_all_providers, model_list, note_styles |

---

## 2. 目录结构

```
noteflow-miniprogram/
├── app.js                          # App 生命周期、自动登录、全局数据
├── app.json                        # 全局配置：pages、tabBar、window、subpackages
├── app.wxss                        # 全局样式
├── project.config.json             # IDE 和项目配置
├── sitemap.json                    # 微信搜索索引配置
│
├── pages/                          # ===== 主包页面 =====
│   ├── home/                       # 首页 (TabBar 1)
│   │   ├── home.js
│   │   ├── home.json
│   │   ├── home.wxml
│   │   └── home.wxss
│   ├── tasks/                      # 笔记列表 (TabBar 2)
│   │   ├── tasks.js
│   │   ├── tasks.json
│   │   ├── tasks.wxml
│   │   └── tasks.wxss
│   ├── profile/                    # 我的 (TabBar 3)
│   │   ├── profile.js
│   │   ├── profile.json
│   │   ├── profile.wxml
│   │   └── profile.wxss
│   ├── note-detail/                # 笔记详情
│   │   ├── note-detail.js
│   │   ├── note-detail.json
│   │   ├── note-detail.wxml
│   │   └── note-detail.wxss
│   └── login/                      # 登录注册
│       ├── login.js
│       ├── login.json
│       ├── login.wxml
│       └── login.wxss
│
├── components/                      # ===== 自定义组件 =====
│   ├── task-card/                  # 任务列表卡片
│   ├── video-preview/              # 视频链接预览卡
│   ├── markdown-viewer/            # Markdown 渲染器
│   ├── chat-bubble/                 # 聊天气泡
│   ├── credit-badge/               # 电力余额徽标
│   ├── empty-state/                # 空状态占位
│   ├── loading-skeleton/           # 骨架屏
│   └── model-selector/             # 模型选择器
│
├── utils/                           # ===== 工具层 =====
│   ├── request.js                  # 统一请求封装 (auth + 错误处理 + 重试)
│   ├── auth.js                     # 微信登录桥接 + token 管理
│   ├── task-polling.js             # 任务状态轮询管理器
│   ├── platform-detector.js        # URL -> 平台检测
│   ├── markdown-parser.js          # Markdown -> WXML 节点树
│   ├── format.js                   # 日期/电力/文件大小格式化
│   └── event-bus.js                # 跨页面事件总线
│
├── services/                        # ===== API 对接层 =====
│   ├── auth.js                     # 认证接口
│   ├── note.js                     # 笔记生成接口
│   ├── chat.js                     # AI 问答接口
│   ├── billing.js                  # 计费接口
│   ├── profile.js                  # 用户信息接口
│   ├── share.js                    # 分享接口
│   ├── collection.js               # 合集接口
│   ├── flashcard.js                # 闪记卡接口
│   ├── knowledge-base.js           # 知识库接口
│   └── model.js                    # 模型/供应商接口
│
├── store/                           # ===== 全局状态 =====
│   └── store.js                    # 基于 Behavior 的轻量状态管理
│
├── subpackages/                    # ===== 分包 =====
│   ├── billing/                    # 充值 & 会员
│   │   └── pages/
│   │       ├── recharge/           # 电力充值
│   │       ├── subscription/       # 会员订阅
│   │       └── orders/             # 订单流水
│   ├── collections/                # 笔记合集 (Pro)
│   │   └── pages/
│   │       ├── list/               # 合集列表
│   │       └── detail/             # 合集详情
│   ├── knowledge-base/            # 知识库问答 (Pro)
│   │   └── pages/
│   │       └── chat/               # 跨笔记 AI 问答
│   ├── flashcards/                 # 闪记卡
│   │   └── pages/
│   │       ├── generate/           # 生成闪记卡
│   │       └── study/              # 卡片翻转学习
│   └── share/                      # 分享页
│       └── pages/
│           └── view/               # 公开笔记查看 (免登录)
│
├── images/                          # 静态图片/图标
│   ├── tab/                        # TabBar 图标
│   ├── icons/                      # 功能图标
│   └── empty/                      # 空状态插画
│
└── .env.js                          # 环境变量配置
```

---

## 3. 页面设计

### 3.1 TabBar 配置

```json
{
  "tabBar": {
    "color": "#888780",
    "selectedColor": "#378ADD",
    "backgroundColor": "#ffffff",
    "borderStyle": "white",
    "list": [
      {
        "pagePath": "pages/home/home",
        "text": "首页",
        "iconPath": "images/tab/home.png",
        "selectedIconPath": "images/tab/home-active.png"
      },
      {
        "pagePath": "pages/tasks/tasks",
        "text": "笔记",
        "iconPath": "images/tab/note.png",
        "selectedIconPath": "images/tab/note-active.png"
      },
      {
        "pagePath": "pages/profile/profile",
        "text": "我的",
        "iconPath": "images/tab/profile.png",
        "selectedIconPath": "images/tab/profile-active.png"
      }
    ]
  }
}
```

### 3.2 首页 (pages/home)

**核心功能**：视频链接输入 + 快速生成 + 最近任务

**页面结构**：
- 顶部：Logo + 电力余额徽标（点击跳转充值）
- 输入区：视频链接输入框 + 平台自动检测 + 剪贴板粘贴
- 预览卡：解析到视频信息后显示标题/封面/时长
- 设置区：模型选择器（下拉）、笔记风格选择、格式勾选（目录/链接/截图/摘要）
- 提交按钮：显示预计消耗电力
- 底部：最近 3 条任务卡片（点击进入详情）

**关键交互**：
- 粘贴链接后 debounce 500ms 自动调 `/api/video_info` 预览
- 平台自动检测：URL 模式匹配（bilibili.com / youtube.com / douyin.com / kuaishou.com）
- 提交前调 `/api/billing/pricing/preview` 展示费用
- 提交后跳转到笔记详情页开始轮询

### 3.3 笔记列表 (pages/tasks)

**核心功能**：全部任务列表 + 状态筛选

**页面结构**：
- 顶部：搜索框 + 状态筛选 Tab（全部 / 进行中 / 已完成 / 失败）
- 列表：任务卡片（封面、标题、平台标签、状态、创建时间、电力消耗）
- 底部：上拉加载更多

**关键交互**：
- 进入页面调 `/api/tasks` 获取全量列表
- 进行中的任务卡片显示进度条，3s 轮询状态
- 下拉刷新
- 左滑删除任务

### 3.4 笔记详情 (pages/note-detail)

**核心功能**：Markdown 笔记查看 + AI 问答 + 导出

**页面结构**：
- 顶部：视频信息条（封面缩略图 + 标题 + 平台 + 时长 + 原链接跳转）
- 内容 Tab：笔记 | 转写稿 | 问答
- 笔记 Tab：Markdown 渲染（支持标题、列表、代码块、引用、图片代理）
- 转写稿 Tab：时间轴文本，点击跳转视频时间点
- 问答 Tab：聊天界面，底部输入框
- 右上角操作菜单：编辑标题、分享、导出（MD/PDF）、生成闪记卡、删除

**Markdown 渲染方案**：
- 使用 `towxml` 库将 Markdown 转为 WXML 节点树
- 图片 URL 统一走 `/api/image_proxy?url=xxx` 代理（B 站图片需要 Referer）
- 代码块使用自定义高亮组件

**AI 问答方案**：
- 使用非流式接口 `/api/chat/ask`（小程序不原生支持 SSE）
- 先调 `/api/chat/index` 确保笔记已索引
- 聊天 UI：气泡布局 + 历史消息 + 引用来源折叠

### 3.5 我的 (pages/profile)

**核心功能**：用户信息 + 电力余额 + 功能入口

**页面结构**：
- 用户信息卡：头像 + 用户名 + 手机号/邮箱 + 编辑
- 电力余额卡片：当前电力 + 消耗总计 + 会员状态 + 充值按钮
- 功能菜单列表：
  - 我的订单（跳转分包 billing）
  - 笔记合集（跳转分包 collections，Pro 标识）
  - 知识库问答（跳转分包 kb，Pro 标识）
  - 邀请奖励（邀请码 + 邀请记录）
  - 消息通知
  - 帮助与反馈
  - 关于 NoteFlow
- 底部：退出登录

### 3.6 登录注册 (pages/login)

**核心功能**：微信一键登录 + 手机号验证码登录

**页面结构**：
- Logo + 标语
- 微信一键登录按钮（`<button open-type="getPhoneNumber">`）
- 分割线 "其他登录方式"
- 手机号 + 验证码登录表单
- 注册入口（用户名 + 邮箱 + 密码）
- 用户协议勾选

---

## 4. 核心技术方案

### 4.1 微信登录桥接

后端使用 JWT 认证，小程序需桥接微信登录与后端 Session。

**流程**：
1. 小程序调 `wx.login()` 获取 `code`
2. POST `/api/auth/wechat-login` { code } → 后端调微信 API 获取 openid
3. 后端创建/查找用户 → 返回 JWT token
4. 小程序存储 token 到 `wx.setStorageSync('access_token', token)`
5. 后续所有请求 header 携带 `Authorization: Bearer <token>`

**后端新增接口**（需在 `backend/app/routers/auth.py` 添加）：
```python
@router.post("/wechat-login")
def wechat_login(body: WechatLoginRequest, db: Session = Depends(get_db)):
    # 1. 用 code 调微信 API 获取 openid + session_key
    # 2. 按 openid 查找/创建用户
    # 3. 返回 JWT token + user info
    pass
```

**token 刷新**：401 时自动触发 `wx.login()` 重新获取 token，重试原请求。

### 4.2 统一请求封装 (utils/request.js)

```javascript
const BASE_URL = 'https://api.noteflow.app/api';

const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('access_token');
    const header = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
      ...options.header,
    };

    wx.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data || {},
      header,
      timeout: options.timeout || 30000,
      success: (res) => {
        if (res.statusCode === 401) {
          return refreshTokenAndRetry(options).then(resolve).catch(reject);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data;
          if (body.code === 200 || body.success) {
            resolve(body.data);
          } else {
            wx.showToast({ title: body.msg || '请求失败', icon: 'none' });
            reject(body);
          }
        } else {
          reject({ code: res.statusCode, message: 'Request failed' });
        }
      },
      fail: (err) => {
        if (!options.suppressToast) {
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
        reject({ code: -1, message: 'Network error', detail: err });
      },
    });
  });
};
```

### 4.3 任务轮询管理器 (utils/task-polling.js)

```javascript
class TaskPolling {
  constructor() {
    this._timers = {};  // { task_id: intervalId }
    this._callbacks = {};
  }

  start(taskId, callback) {
    if (this._timers[taskId]) return;
    this._callbacks[taskId] = callback;

    const poll = () => {
      request({ url: `/task_status/${taskId}` })
        .then((data) => {
          callback(data);
          if (data.status === 'SUCCESS' || data.status === 'FAILED') {
            this.stop(taskId);
          }
        })
        .catch(() => {});
    };

    poll();  // 立即执行一次
    this._timers[taskId] = setInterval(poll, 3000);
  }

  stop(taskId) {
    if (this._timers[taskId]) {
      clearInterval(this._timers[taskId]);
      delete this._timers[taskId];
      delete this._callbacks[taskId];
    }
  }

  stopAll() {
    Object.keys(this._timers).forEach(id => this.stop(id));
  }
}

module.exports = new TaskPolling();
```

**生命周期管理**：
- 页面 `onHide` → `stopAll()` 暂停轮询
- 页面 `onShow` → 检查进行中任务 → 重新 `start()`
- 全局 `app.js` 监听 `onHide` → 暂停所有轮询

### 4.4 Markdown 渲染方案

小程序无法直接使用 `react-markdown`，需要适配方案：

**方案 A：towxml 库（推荐）**
- 将 Markdown 解析为 JSON 节点树，通过 WXML 模板递归渲染
- 支持标题、列表、代码块、引用、表格、图片
- 包大小约 100KB，可放入主包
- 图片 URL 自动替换为代理地址

**方案 B：自研轻量解析器**
- 仅支持标题、列表、加粗/斜体、代码块、引用
- 包大小约 20KB
- 适合 MVP 快速上线

**图片代理**：
```javascript
// markdown-parser.js
function proxyImages(markdown) {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => `![${alt}](${BASE_URL}/image_proxy?url=${encodeURIComponent(url)})`
  );
}
```

### 4.5 微信支付集成

后端已有订单创建逻辑，需新增微信支付渠道：

**后端改造**：
- `order_service` 新增 `pay_method: "WECHAT_MP"`
- 创建订单时调微信支付统一下单 API → 返回 prepay_id + 签名参数
- 返回给小程序：timeStamp, nonceStr, package, signType, paySign

**小程序端**：
```javascript
// services/billing.js
const pay = async (orderNo, payParams) => {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: payParams.timeStamp,
      nonceStr: payParams.nonceStr,
      package: payParams.package,
      signType: payParams.signType,
      paySign: payParams.paySign,
      success: () => resolve({ success: true }),
      fail: (err) => {
        if (err.errMsg.includes('cancel')) {
          resolve({ success: false, reason: 'cancelled' });
        } else {
          reject(err);
        }
      },
    });
  });
};
```

### 4.6 平台检测 (utils/platform-detector.js)

镜像后端 `video_url_validator.py` 的检测逻辑：

```javascript
const PLATFORM_RULES = [
  { platform: 'bilibili', pattern: /bilibili\.com\/video|b23\.tv/i },
  { platform: 'youtube', pattern: /youtube\.com\/watch|youtu\.be/i },
  { platform: 'douyin', pattern: /douyin\.com\/video|iesdouyin\.com/i },
  { platform: 'kuaishou', pattern: /kuaishou\.com|chenzhongtech\.com/i },
];

function detectPlatform(url) {
  for (const rule of PLATFORM_RULES) {
    if (rule.pattern.test(url)) return rule.platform;
  }
  return null;
}
```

### 4.7 SSE/流式问答适配

后端 `/api/chat/ask_stream` 使用 SSE 返回。小程序不原生支持 EventSource，有两个方案：

**方案 A：使用 wx.request + enableChunked（推荐，需基础库 2.20+）**
```javascript
const task = wx.request({
  url: `${BASE_URL}/chat/ask_stream`,
  method: 'POST',
  enableChunked: true,
  data: { task_id, question, history, provider_id, model_name },
  success: () => {},
});
task.onChunkReceived((res) => {
  const text = decodeChunk(res.data);
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      // 处理 delta / billing / error 事件
    }
  }
});
```

**方案 B：使用非流式接口**（MVP 快速上线）
- 调 `/api/chat/ask` 一次性返回完整回答
- 简单可靠，但无打字机效果

---

## 5. 分包策略

### 5.1 主包体积控制

主包目标 < 1.8MB（留 0.2MB 余量）：

| 组成 | 预估大小 |
|------|----------|
| 页面代码（5 页 × ~15KB） | 75KB |
| towxml 库 | 100KB |
| 组件代码（8 个 × ~5KB） | 40KB |
| utils + services | 50KB |
| 图片资源（TabBar 图标 + 空状态） | 200KB |
| 第三方依赖 | 100KB |
| 合计 | ~565KB |

主包体积充裕，后续可容纳更多核心页面。

### 5.2 分包配置

```json
{
  "subpackages": [
    {
      "root": "subpackages/billing",
      "name": "billing",
      "pages": ["pages/recharge/recharge", "pages/subscription/subscription", "pages/orders/orders"]
    },
    {
      "root": "subpackages/collections",
      "name": "collections",
      "pages": ["pages/list/list", "pages/detail/detail"]
    },
    {
      "root": "subpackages/knowledge-base",
      "name": "kb",
      "pages": ["pages/chat/chat"]
    },
    {
      "root": "subpackages/flashcards",
      "name": "flashcards",
      "pages": ["pages/generate/generate", "pages/study/study"]
    },
    {
      "root": "subpackages/share",
      "name": "share",
      "pages": ["pages/view/view"]
    }
  ],
  "preloadRule": {
    "pages/profile/profile": {
      "network": "all",
      "packages": ["billing"]
    },
    "pages/note-detail/note-detail": {
      "network": "wifi",
      "packages": ["flashcards"]
    }
  }
}
```

### 5.3 分包预加载策略

- **首页** → 不预加载（保持启动速度）
- **笔记详情** → WiFi 下预加载 `flashcards`（用户可能生成闪记卡）
- **我的** → 预加载 `billing`（用户可能充值）

---

## 6. 状态管理

采用基于 `Behavior` 的轻量全局状态方案，不引入第三方库：

```javascript
// store/store.js
const store = Behavior({
  data: {
    userInfo: null,
    token: '',
    credits: 0,
    activeSubscription: null,
    currentTaskId: null,
  },
  methods: {
    updateStore(patch) {
      this.setData(patch);
      // 同步到全局
      const app = getApp();
      Object.assign(app.globalData, patch);
    },
    refreshBalance() {
      return request({ url: '/billing/balance' }).then((data) => {
        this.updateStore({
          credits: data.credits,
          activeSubscription: data.active_subscription,
        });
      });
    },
  },
});

module.exports = store;
```

需要全局状态的页面引入该 Behavior 即可，无需 Provider/Consumer 模式。

---

## 7. API 对接清单

### 7.1 认证模块 (services/auth.js)

| 方法 | 接口 | 说明 |
|------|------|------|
| wechatLogin | POST /auth/wechat-login | 微信 code 登录（新增） |
| login | POST /auth/login | 账号密码登录 |
| register | POST /auth/register | 注册 |
| sendCode | POST /auth/send-code | 发送验证码 |
| loginByCode | POST /auth/login-by-code | 验证码登录 |
| me | GET /auth/me | 获取当前用户 |

### 7.2 笔记模块 (services/note.js)

| 方法 | 接口 | 说明 |
|------|------|------|
| generateNote | POST /generate_note | 提交生成任务 |
| getTaskStatus | GET /task_status/{task_id} | 查询任务状态 |
| listTasks | GET /tasks | 任务列表 |
| deleteTask | DELETE /tasks/{task_id} | 删除任务 |
| getVideoInfo | POST /video_info | 视频信息预览 |
| updateNoteTitle | PUT /note/{task_id}/title | 重命名 |
| updateNoteContent | PUT /note/{task_id} | 编辑笔记 |
| generateBatch | POST /generate_notes_batch | 批量生成（Pro） |

### 7.3 问答模块 (services/chat.js)

| 方法 | 接口 | 说明 |
|------|------|------|
| indexNote | POST /chat/index | 建立索引 |
| chatStatus | GET /chat/status | 索引状态 |
| ask | POST /chat/ask | 单笔记问答 |
| askStream | POST /chat/ask_stream | 流式问答（可选） |

### 7.4 计费模块 (services/billing.js)

| 方法 | 接口 | 说明 |
|------|------|------|
| getBalance | GET /billing/balance | 余额查询 |
| pricingPreview | POST /billing/pricing/preview | 费用预览 |
| rechargePackages | GET /billing/recharge/packages | 充值套餐 |
| subscriptionPlans | GET /billing/subscription/plans | 会员方案 |
| createRechargeOrder | POST /billing/order/recharge | 创建充值订单 |
| createSubOrder | POST /billing/order/subscription | 创建会员订单 |
| mockPay | POST /billing/order/mock_pay | 模拟支付 |
| listOrders | GET /billing/orders | 订单列表 |
| listTransactions | GET /billing/transactions | 流水 |
| referralMe | GET /billing/referral/me | 邀请统计 |

### 7.5 其他模块

| 模块 | 关键接口 |
|------|----------|
| profile.js | GET/PUT /profile, POST /profile/avatar, PUT /profile/password |
| share.js | POST /share/enable/{id}, GET /share/view/{token} |
| collection.js | GET/POST /collections, GET/POST /collections/{id}/items, POST /collections/{id}/merge |
| flashcard.js | POST /flashcards/generate, GET /flashcards/set/{id} |
| knowledge-base.js | POST/GET /kb/conversations, POST /kb/ask_stream |
| model.js | GET /get_all_providers, GET /model_list, GET /note_styles |

---

## 8. 性能优化

### 8.1 启动优化

- 主包控制在 1.8MB 以内
- `app.js` 中延迟初始化非关键模块（分析、错误监控）
- 首页骨架屏先行渲染，数据异步加载
- 使用 `wx.lazyCodeLoading` 按需注入组件

### 8.2 渲染优化

- 列表页使用 `virtual-list` 或 `recycle-view` 虚拟滚动
- `setData` 最小化：只传变更字段，使用路径赋值 `this.setData({ 'task.status': 'success' })`
- 图片使用 `lazy-load` 懒加载 + CDN WebP 格式
- Markdown 长文分段渲染，先渲染前 3 屏，滚动时追加

### 8.3 网络优化

- 请求去重：同一 URL 的并发请求共享 Promise
- 请求缓存：模型列表、笔记风格、平台列表等低频变更数据缓存到 Storage
- 预加载：用户浏览笔记列表时预加载首页数据
- 图片代理：通过后端 `/api/image_proxy` 统一处理 Referer 问题

### 8.4 轮询优化

- 页面不可见时暂停轮询（`onHide`）
- 轮询超时：30 次未成功自动停止，提示用户
- 成功后立即停止，不浪费请求

---

## 9. 审核合规

### 9.1 隐私协议

- 配置 `__usePrivacyCheck__: true`
- 首次使用时弹出隐私协议弹窗
- 涉及用户数据的 API 前需用户同意

### 9.2 权限声明

在 `app.json` 中声明所需权限：
```json
{
  "permission": {
    "scope.userInfo": { "desc": "用于展示用户头像和昵称" }
  },
  "requiredPrivateInfos": ["getLocation"]
}
```

### 9.3 内容安全

- 用户生成的笔记内容如需公开展示（分享页），调 `wx.msgSecCheck` 进行文本安全检测
- 图片内容调 `wx.imgSecCheck` 检测

### 9.4 支付合规

- 使用微信支付（不使用第三方支付）
- 虚拟商品支付使用微信虚拟支付 API
- 实物/服务使用普通微信支付
- 支付前展示清晰的价格和商品说明

### 9.5 域名白名单

在微信公众平台后台配置以下域名：
- request 合法域名：`https://api.noteflow.app`
- download 合法域名：`https://api.noteflow.app`（图片代理下载）
- uploadFile 合法域名：`https://api.noteflow.app`（头像/封面上传）

---

## 10. 分阶段上线计划

### Phase 1：MVP（2 周）

- 微信登录 + 手机号登录
- 首页：链接输入 + 预览 + 生成
- 笔记列表 + 状态轮询
- 笔记详情：Markdown 渲染
- 我的：基本信息 + 余额
- 分享页：公开查看

### Phase 2：核心体验（2 周）

- 笔记详情 AI 问答（单笔记）
- 微信支付充值
- 会员订阅
- 邀请奖励
- 任务删除 + 重命名
- 导出 Markdown

### Phase 3：Pro 功能（2 周）

- 笔记合集管理
- 知识库跨笔记问答
- 闪记卡生成 + 学习
- 批量生成
- 订单流水查看

### Phase 4：增长（1 周）

- 分享到朋友圈/好友
- 邀请码裂变
- 消息订阅（任务完成通知）
- 数据埋点

---

## 11. 后端改造清单

以下接口需要新增或改造以支持小程序：

| 改造项 | 说明 |
|--------|------|
| POST /api/auth/wechat-login | 新增：接收 wx.login code，返回 JWT |
| billing pay_method: "WECHAT_MP" | 新增：微信支付渠道，调统一下单 API |
| GET /api/platforms | 改造：允许普通用户获取已启用平台列表 |
| CORS | 确认：后端 CORS 已支持所有 HTTPS 来源 |
| 图片代理 | 已有：/api/image_proxy 无需改造 |

---

## 12. 项目配置

### project.config.json

```json
{
  "appid": "wxXXXXXXXXXX",
  "projectname": "NoteFlow",
  "setting": {
    "es6": true,
    "enhance": true,
    "postcss": true,
    "minified": true,
    "newFeature": true,
    "urlCheck": true,
    "lazyloadCode": "requiredComponents"
  },
  "compileType": "miniprogram",
  "libVersion": "3.5.0"
}
```

### app.json

```json
{
  "pages": [
    "pages/home/home",
    "pages/tasks/tasks",
    "pages/profile/profile",
    "pages/note-detail/note-detail",
    "pages/login/login"
  ],
  "window": {
    "navigationBarTitleText": "NoteFlow",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#F1EFE8",
    "enablePullDownRefresh": false
  },
  "tabBar": { "...": "见 3.1" },
  "subpackages": { "...": "见 5.2" },
  "preloadRule": { "...": "见 5.3" },
  "useExtendedLib": {
    "weui": true
  },
  "lazyCodeLoading": "requiredComponents",
  "__usePrivacyCheck__": true
}
```
