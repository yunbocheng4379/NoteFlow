<p align="center">
  <img src="./doc/icon.svg" alt="NoteFlow Logo" width="58" height="58" />
</p>

<h1 align="center">NoteFlow v1.0.0</h1>

<p align="center"><i>一条视频链接，变成一份可检索、可追问、可管理的 AI 笔记。</i></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img src="https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-blue" />
  <img src="https://img.shields.io/badge/backend-FastAPI-green" />
  <img src="https://img.shields.io/badge/database-MySQL-orange" />
  <img src="https://img.shields.io/badge/RAG-ChromaDB-10b981" />
  <img src="https://img.shields.io/badge/docker-compose-blue" />
  <img src="https://img.shields.io/github/stars/yunbocheng4379/NoteFlow?style=social" />
</p>

<p align="center">
  <a href="http://47.99.136.241:3015/welcome"><b>NoteFlow Pro 在线版</b></a>
  ·
  <a href="https://github.com/yunbocheng4379/NoteFlow/releases"><b>桌面版下载</b></a>
  ·
  <a href="./docs/DEPLOYMENT.md"><b>部署文档</b></a>
</p>

## 项目简介

NoteFlow 是一个 AI 视频笔记系统，支持从 Bilibili、YouTube、抖音、快手、本地视频等来源解析内容，自动转写音频并生成结构化 Markdown 笔记。生成后的笔记可以进入知识库向量索引，用于跨笔记 AI 问答、引用来源追踪、笔记合集管理和后续导出。

如果你只想直接使用，不想处理 Docker、代理、FFmpeg、Whisper 模型下载和服务器配置，可以访问 **[www.noteflow.app](https://www.noteflow.app/)** 使用在线版。

## 核心能力

### 视频转笔记

- 支持在线视频链接和本地视频上传。
- 自动识别平台，支持 Bilibili、YouTube、抖音、快手等视频来源。
- 支持 Fast-Whisper、MLX-Whisper、Groq、BCut 等音频转写方案。
- 支持选择笔记风格、笔记格式、补充说明、截图插入、原片跳转链接。
- 支持视频理解、多模态截图分析和生成过程任务状态追踪。

### AI 模型与成本控制

- 支持 OpenAI-compatible 模型供应商，可接入 DeepSeek、Qwen、Kimi、MiniMax、Claude、Gemini、Groq 等模型。
- 模型列表展示供应商 Logo，支持普通模型 / Pro 模型分层。
- 支持深度思考开关，并根据模型能力自动禁用不支持的选项。
- 支持电力余额、套餐充值、会员订阅和账单流水。

### 知识库与笔记管理

- 生成笔记后自动写入向量库，并维护索引状态。
- 知识库支持跨笔记 AI 问答、选择指定笔记范围、深度思考展示、引用来源折叠展示。
- 支持笔记合集，将同一课程、主题或批量生成的笔记集中管理。
- 支持笔记重命名、编辑后自动重建向量索引。
- 支持任务列表、生成历史、多版本记录和历史回看。

### 管理后台

- AI 模型供应商管理、模型启用和模型等级配置。
- 音频转写配置和 Whisper 模型下载管理。
- Cookie 池管理：多平台 Cookie、分组、权重、失败计数、失效标记和池耗尽提醒。
- 用户管理、反馈管理、系统通知、部署监控、更新日志管理。
- 支持支付宝 / 微信支付渠道配置与订单状态同步。

## 截图预览

以下截图均来自当前 NoteFlow v1.0.0 系统界面：

![NoteFlow 工作台](./doc/screenshots/01-workspace.png)
![NoteFlow 任务列表](./doc/screenshots/02-task-list.png)
![NoteFlow 笔记合集](./doc/screenshots/03-collections.png)
![NoteFlow 知识库问答](./doc/screenshots/04-knowledge-base.png)
![NoteFlow Pro](./doc/screenshots/05-upgrade-pro.png)
![NoteFlow 关于页](./doc/screenshots/06-about.png)
![NoteFlow Cookie 池管理](./doc/screenshots/07-cookie-pool.png)

## 快速开始

### 方式一：Docker Compose 部署（推荐）

先准备 Docker 和 Docker Compose Plugin，然后在项目根目录执行：

```bash
cp .env.example .env
docker compose up -d --build
```

默认访问地址：

```text
http://localhost:3015
```

首次部署完成后建议检查：

```bash
docker compose ps
curl http://127.0.0.1:3015/api/sys_health
```

GPU 版本：

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

项目更新后的二次部署：

```bash
git pull
docker compose up -d --build
```

Docker 会保留 named volumes 中的 MySQL 数据、模型缓存、上传文件、笔记结果和向量库数据。正式环境更新前建议先按部署文档备份数据库。

正式服务器部署、首次部署、二次更新部署、数据库导入、Docker 镜像源等内容请查看：

[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

### 方式二：源码运行

后端：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

前端：

```bash
cd NoteFlow_frontend
pnpm install
pnpm dev
```

访问：

```text
http://localhost:3015
```

## 常用命令

后端测试：

```bash
cd backend
pytest
```

前端构建：

```bash
cd NoteFlow_frontend
pnpm build
```

浏览器扩展：

```bash
cd NoteFlow_extension
pnpm install
pnpm dev
pnpm build
```

桌面端打包：

```bash
cd backend && ./build.sh
cd NoteFlow_frontend && pnpm tauri build
```

## 目录结构

```text
NoteFlow
├── backend/              # FastAPI 后端、任务队列、下载器、转写、LLM、RAG、数据库
├── NoteFlow_frontend/    # React 19 + Vite 前端
├── NoteFlow_extension/   # 浏览器扩展
├── docs/                 # 部署和设计文档
├── doc/                  # README 图片和社区二维码
├── docker-compose.yml    # 标准 Docker 部署
└── docker-compose.gpu.yml
```

## 关键依赖

- Python 3.11+
- Node.js 20+
- MySQL 8+
- FFmpeg
- ChromaDB
- Docker / Docker Compose
- 可选：NVIDIA GPU + NVIDIA Container Toolkit

Docker 部署已内置 FFmpeg；源码部署需要自行安装 FFmpeg。

## Docker 常见问题

### 国内拉取 Docker Hub 超时

可在 Docker daemon 中配置镜像加速器，例如：

```json
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
```

也可以临时使用项目 Dockerfile 提供的 `BASE_REGISTRY`：

```bash
BASE_REGISTRY=docker.m.daocloud.io docker compose build
docker compose up -d
```

### 修改 `.env` 后没有生效

- `VITE_*` 是前端构建时变量，修改后需要重新 build 前端镜像。
- 后端运行时变量通常 `docker compose up -d` 即可生效。
- LLM API Key 建议在前端模型供应商页面配置，不要写入 `.env`。

### 数据持久化位置

Docker Compose 使用 named volumes 保存数据：

- `noteflow_mysql_data`：MySQL 数据
- `noteflow_backend_note_results`：生成笔记和转写结果
- `noteflow_backend_vector_db`：知识库向量索引
- `noteflow_backend_models`：Whisper 模型缓存
- `noteflow_backend_uploads`：上传文件
- `noteflow_backend_static`：截图等静态资源
- `noteflow_backend_logs`：后端日志

彻底清空数据：

```bash
docker compose down -v
```

正式环境请谨慎执行。

## 联系我们

以下二维码来自当前系统「关于」页面。如二维码失效，请到 [Issues](https://github.com/yunbocheng4379/NoteFlow/issues) 反馈。

<table align="center">
  <tr>
    <td align="center">
      <img src="./doc/about-wechat-community-qr.png" alt="NoteFlow 用户交流群" width="220" />
      <br/>
      NoteFlow 用户交流群
    </td>
    <td align="center">
      <img src="./doc/about-enterprise-service-qr.png" alt="企业定制 / 私有化部署咨询" width="220" />
      <br/>
      企业定制 / 私有化部署咨询
    </td>
  </tr>
</table>