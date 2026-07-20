<div style="display: flex; justify-content: center; align-items: center; gap: 10px;
">
    <p align="center">
  <img src="./doc/icon.svg" alt="NoteFlow Banner" width="50" height="50"  />
</p>
<h1 align="center" > NoteFlow v1.0.0</h1>
</div>

<p align="center"><i>AI 视频笔记生成工具 让 AI 为你的视频做笔记</i></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img src="https://img.shields.io/badge/frontend-react%2019-blue" />
  <img src="https://img.shields.io/badge/backend-fastapi-green" />
  <img src="https://img.shields.io/badge/GPT-openai%20%7C%20deepseek%20%7C%20qwen-ff69b4" />
  <img src="https://img.shields.io/badge/docker-ghcr.io-blue" />
  <img src="https://img.shields.io/badge/status-active-success" />
  <img src="https://img.shields.io/github/stars/yunbocheng4379/NoteFlow?style=social" />
</p>

<p align="center">
  <a href="https://www.noteflow.app/"><b>🚀 NoteFlow Pro · 在线版</b></a>
</p>

<p align="center">
  <b>不想折腾部署？</b>访问 <a href="https://www.noteflow.app/"><b>www.noteflow.app</b></a> 即开即用 —— 免安装、免配置环境、免下模型，注册即可把视频转成笔记。
  <br/>
  本地部署遇到的依赖、代理、模型下载这些坑，云端版统统不用管。
</p>

<p align="center">
  <a href="https://www.noteflow.app/">
    <img src="https://img.shields.io/badge/%E7%AB%8B%E5%8D%B3%E4%BD%93%E9%AA%8C-NoteFlow%20Pro-ff5c5c?style=for-the-badge" alt="立即体验 NoteFlow Pro" />
  </a>
</p>



## ✨ 项目简介

NoteFlow 是一个开源的 AI 视频笔记助手，支持通过哔哩哔哩、YouTube、抖音等视频链接，自动提取内容并生成结构清晰、重点明确的 Markdown 格式笔记。支持插入截图、原片跳转、AI 问答等功能。

> 💡 **想直接用、不想本地部署？** —— [NoteFlow Pro 在线版 www.noteflow.app](https://www.noteflow.app/) 已上线，云端托管、开箱即用，省去依赖安装 / 代理配置 / 模型下载的全部麻烦。

## 🌐 在线使用（推荐）

直接访问 **[www.noteflow.app](https://www.noteflow.app/)** 即可使用 NoteFlow Pro 在线版，无需本地部署。

## 📝 使用文档
详细文档可以查看[这里](https://github.com/yunbocheng4379/NoteFlow/)
## 📦 桌面版下载
本项目提供了 Windows 和 macOS 桌面客户端，可在 [Releases](https://github.com/yunbocheng4379/NoteFlow/releases) 页面下载最新版本。

> Windows 用户请注意：一定要在没有中文路径的环境下运行。

## 💎 NoteFlow AI笔记系统一对一搭建服务

提供 **NoteFlow AI笔记系统一对一搭建服务**：专人一对一远程协助，从环境部署、模型配置到上手使用全程陪跑，帮你快速跑通整套系统。扫码添加微信，备注「搭建服务」即可咨询：

<table align="center">
  <tr>
    <td align="center"><img src="./doc/remote-install-wechat.png" alt="NoteFlow AI笔记系统一对一搭建服务" width="220" /><br/>NoteFlow AI笔记系统一对一搭建服务</td>
  </tr>
</table>

## 🔧 功能特性

- 支持多平台：Bilibili、YouTube、本地视频、抖音、快手
- 支持返回笔记格式选择
- 支持笔记风格选择
- 支持多模态视频理解
- 支持多版本记录保留
- 支持自行配置 GPT 大模型（OpenAI、DeepSeek、Qwen 等）
- 本地模型音频转写（支持 Fast-Whisper、MLX-Whisper、Groq、BCut）
- GPT 大模型总结视频内容
- 自动生成结构化 Markdown 笔记
- 可选插入截图（自动截取）
- 可选内容跳转链接（关联原视频）
- 任务记录与历史回看
- 基于 RAG 的笔记内容 AI 问答（支持 Function Calling）
- 笔记顶部视频封面 Banner 展示
- 工作区和生成历史面板支持折叠/展开

### v1.0.0 当前版本

- 项目已统一更名为 NoteFlow，并以 v1.0.0 作为当前正式版本。
- 默认部署方式切换为 Docker Compose，完整 Web 栈包含 MySQL、FastAPI 后端、React/Vite 前端和 nginx 反向代理。
- 详细发布记录和历史变更请查看 [CHANGELOG.md](./CHANGELOG.md)。

## 📸 截图预览
![screenshot](./doc/image1.png)
![screenshot](./doc/image3.png)
![screenshot](./doc/image.png)
![screenshot](./doc/image4.png)
![screenshot](./doc/image5.png)

## 🚀 快速开始

### 方式一：Docker Compose 部署（推荐）

确保已安装 Docker 和 Docker Compose Plugin，然后使用项目内置 compose 文件构建并启动完整服务：

```bash
cp .env.example .env       # 第一次部署务必先创建 .env，否则 BACKEND_PORT/APP_PORT 等变量为空会启动失败
docker compose up -d --build

# GPU 加速部署（需要 NVIDIA GPU + NVIDIA Container Toolkit）
docker compose -f docker-compose.gpu.yml up -d --build
```

默认访问：`http://localhost:3015`

正式服务器部署步骤请优先参考：[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

#### Docker 部署常见问题（FAQ）

社区反馈最集中的几个坑，遇到先按下面排查：

**0. 国内拉不到 docker.io（build 阶段报 `dial tcp ... i/o timeout`）**

`docker compose build` 拉 `python:3.11-slim` / `node:20-alpine` / `nginx:1.25-alpine` 时连 `auth.docker.io` 超时。两种解法，按推荐顺序：

- **方法 A：配置 Docker daemon 镜像加速器**——编辑 `~/.docker/daemon.json`（Linux 在 `/etc/docker/daemon.json`），加：
  ```json
  {
    "registry-mirrors": ["https://docker.m.daocloud.io"]
  }
  ```
  然后重启 Docker Desktop / `sudo systemctl restart docker`。这是一劳永逸的做法。
- **方法 B：临时切换 base image 镜像源**——本项目所有 Dockerfile 都暴露了 `BASE_REGISTRY` build-arg：
  ```bash
  BASE_REGISTRY=docker.m.daocloud.io docker compose build
  docker compose up -d
  ```
  或永久写到 `.env`：`echo 'BASE_REGISTRY=docker.m.daocloud.io' >> .env`。

注意：Chinese 公共 docker 镜像源时常被关停，2025-2026 之间可用的列表会变；如果 `docker.m.daocloud.io` 不通，搜一下"Docker 镜像加速 可用"找最新可用源即可。

**1. 容器一直 restart / unhealthy**

先看后端日志：
```bash
docker logs -f noteflow-backend
```
后端启动会按顺序打印 `[startup 1/5] ... [startup 5/5] 启动完成`。若日志卡在某一步或出现 `[startup FAILED]`，就是那一步的问题，常见：
- **卡在 `[startup 3/5]`**：转写器配置读不到。检查 `.env` 里 `TRANSCRIBER_TYPE` 是否写错，`mlx-whisper` 只能在 Apple Silicon 用，Linux/Docker 请用 `fast-whisper` 或 `groq`。
- **首次跑视频时容器被 kill**：whisper 模型下载触发 OOM。先把 `.env` 里 `WHISPER_MODEL_SIZE` 改成 `tiny`，跑通后再去前端「音频转写配置」里逐档升。

**2. 改了 `.env` 没生效**

区分两类变量：
- `VITE_*` 是**构建时**变量（前端 bundle 里硬编码），改完必须 `docker compose build frontend && docker compose up -d`。只 `restart` 不会重新打包。
- 其他后端变量（`TRANSCRIBER_TYPE`、`WHISPER_MODEL_SIZE`、`FFMPEG_BIN_PATH` 等）是**运行时**变量，改完 `docker compose up -d` 即可。

注意：**LLM API key 不要写 `.env`**，从前端「模型供应商」页面录入，会保存到 MySQL 数据库并持久化。

**3. 数据存在哪？删容器会丢吗？**

`docker compose` 使用 named volumes 持久化数据，删容器不会丢：

- `noteflow_mysql_data`：MySQL 数据库
- `noteflow_backend_static`：截图和静态输出
- `noteflow_backend_uploads`：上传的本地视频
- `noteflow_backend_note_results`：生成的笔记和转写结果
- `noteflow_backend_models`：Whisper 模型缓存
- `noteflow_backend_vector_db`：向量索引
- `noteflow_backend_logs`：后端日志
- `noteflow_backend_data`：后端其他运行时数据

要彻底重置所有 Docker 数据，执行：

```bash
docker compose down -v
```

注意：`down -v` 会删除 MySQL 数据和生成结果，正式环境请谨慎使用。

**4. 前端打开是空白页 / 报 502**

通常是 nginx 起来了但 backend 还没 healthy。`docker ps` 看 backend 容器 STATUS 是不是 `(healthy)`；若长期 `(unhealthy)`，按问题 1 排查后端日志。

**5. 不要用 `restart: on-failure:N`**

如果你 fork 后改过 compose 文件、把 restart 策略改成了 `on-failure:3`：任何 3 次连续崩溃都会让容器永远不再启动，之后改 `.env` 也没用。本项目自带的 compose 已经统一用 `unless-stopped`。

### 方式二：源码部署

#### 1. 克隆仓库

```bash
git clone https://github.com/yunbocheng4379/NoteFlow.git
cd NoteFlow
mv .env.example .env
```

#### 2. 启动后端（FastAPI）

```bash
cd backend
pip install -r requirements.txt
python main.py
```

#### 3. 启动前端（Vite + React）

```bash
cd NoteFlow_frontend
pnpm install
pnpm dev
```

访问：`http://localhost:3015`

## ⚙️ 依赖说明

### 🎬 FFmpeg
本项目依赖 ffmpeg 用于音频处理与转码，源码部署时必须安装：
```bash
# Mac (brew)
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows
# 请从官网下载安装：https://ffmpeg.org/download.html
```
> ⚠️ 若系统无法识别 ffmpeg，请将其加入系统环境变量 PATH
>
> Docker 部署已内置 FFmpeg，无需额外安装。

### 🚀 CUDA 加速（可选）
若你希望更快地执行音频转写任务，可使用具备 NVIDIA GPU 的机器，并启用 fast-whisper + CUDA 加速版本：

具体 `fast-whisper` 配置方法，请参考：[fast-whisper 项目地址](http://github.com/SYSTRAN/faster-whisper#requirements)

### 🐳 使用 Docker Compose 一键部署

确保你已安装 Docker，然后在项目根目录执行：

```bash
# 标准部署
docker compose up -d --build

# GPU 加速部署（需要 NVIDIA GPU）
docker compose -f docker-compose.gpu.yml up -d --build
```

## 🧠 TODO

- [x] 支持抖音及快手等视频平台
- [x] 支持前端设置切换 AI 模型切换、语音转文字模型
- [x] AI 摘要风格自定义（学术风、口语风、重点提取等）
- [x] 加入更多模型支持
- [x] 加入更多音频转文本模型支持
- [x] 基于 RAG 的笔记内容 AI 问答
- [ ] 笔记导出为 PDF / Word / Notion

### Contact and Join-联系和加入社区

扫码加入 NoteFlow 交流微信群（共 5 个群，任选一个即可；二维码会定期更新，如已失效请到 [Issues](https://github.com/yunbocheng4379/NoteFlow/issues) 反馈）：

<table align="center">
  <tr>
    <td align="center"><img src="./doc/wechat-group-1.png" alt="NoteFlow 交流群 1" width="200" /><br/>交流群 1</td>
    <td align="center"><img src="./doc/wechat-group-2.png" alt="NoteFlow 交流群 2" width="200" /><br/>交流群 2</td>
    <td align="center"><img src="./doc/wechat-group-3.png" alt="NoteFlow 交流群 3" width="200" /><br/>交流群 3</td>
  </tr>
  <tr>
    <td align="center"><img src="./doc/wechat-group-4.png" alt="NoteFlow 交流群 4" width="200" /><br/>交流群 4</td>
    <td align="center"><img src="./doc/wechat-group-5.png" alt="NoteFlow 交流群 5" width="200" /><br/>交流群 5</td>
    <td></td>
  </tr>
</table>



## 🔎代码参考
- 本项目中的 `抖音下载功能` 部分代码参考引用自：[Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)

## 📜 License

MIT License

---

💬 你的支持与反馈是我持续优化的动力！欢迎 PR、提 issue、Star ⭐️
## Buy Me a Coffee / 捐赠
如果你觉得项目对你有帮助，考虑支持我一下吧
<div style='display:inline;'>
    <img width='30%' src='https://common-1304618721.cos.ap-chengdu.myqcloud.com/8986c9eb29c356a0cfa3d470c23d3b6.jpg'/>
    <img width='30%' src='https://common-1304618721.cos.ap-chengdu.myqcloud.com/2a049ea298b206bcd0d8b8da3219d6b.jpg'/>
</div>

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yunbocheng4379/NoteFlow&type=Date)](https://www.star-history.com/#yunbocheng4379/NoteFlow&Date)
