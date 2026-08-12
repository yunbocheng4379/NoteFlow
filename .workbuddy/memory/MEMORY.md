# NoteFlow 项目记忆

## 项目概述
- NoteFlow 是 AI 视频笔记系统：视频链接 → 下载 → 转写音频 → LLM 生成 Markdown 笔记
- 支持 Bilibili/YouTube/抖音/快手/本地视频
- 技术栈：FastAPI 后端 (port 8483) + React 19 前端 (port 3015) + 浏览器扩展 + Tauri 桌面
- 计费：电力积分(credits) + 会员订阅 + 充值套餐 + 邀请奖励
- 数据库：MySQL + ChromaDB (向量索引)

## 后端 API 结构
- 所有 API 前缀：/api
- 核心路由：auth, note, chat, knowledge_base(kb), billing, profile, share, collections, flashcards, provider, model, note_style, export, platform
- 认证：JWT Bearer token
- CORS：regex 匹配 localhost + tauri.localhost + chrome-extension:// + moz-extension://

## 小程序完整开发 (2026-08-11)
- 文档：docs/miniprogram-architecture.md
- 项目：noteflow-miniprogram/（119 文件）
- 主包（20）：home(首页)/tasks(笔记列表)/profile(个人)/note-detail(详情+AI问答)/login
- 5 分包（36）：billing(充值+订阅+订单)/collections(合集+详情)/knowledge-base(知识库问答)/flashcards(生成+复习)/share(分享落地页)
- 8 组件 + 10 API服务 + 7 工具模块 + 6 TabBar图标
- 后端新增：/api/auth/wechat-login ✅, WECHAT_MP 支付渠道（待做）
- User 模型新增 wechat_openid/wechat_unionid，email/hashed_password 改为 nullable
- APPID: wxc7bd21a33355b95f，需在 .env 配置真实 WECHAT_MP_SECRET
