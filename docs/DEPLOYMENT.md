# NoteFlow 正式环境部署说明

本文档用于在 Linux 服务器上通过 Docker Compose 部署完整的 NoteFlow Web 系统。

部署后包含以下服务：

- MySQL 8.0
- FastAPI 后端服务
- React/Vite 前端静态站点，由 nginx 提供访问
- 外层 nginx 反向代理，将 `/api` 和 `/static` 转发到后端

项目根目录下的 `.env` 会作为正式环境运行配置使用。`.env` 中通常包含数据库密码、JWT 密钥、Cookie 加密密钥、邮箱配置等敏感信息，必须单独上传到服务器，不能提交到 Git 仓库。

## 1. 服务器要求

建议最低配置：

- Ubuntu 22.04 或更新版本
- 4 核 CPU
- CPU 部署建议 8 GB 内存；如果使用较大的 Whisper 模型，建议 12 GB 或更高
- 30 GB 以上磁盘空间
- Docker
- Docker Compose Plugin

需要开放对外访问端口，默认由 `.env` 中的 `APP_PORT` 控制，当前建议使用：

```env
APP_PORT=3015
```

也就是说，服务器安全组、防火墙、宝塔面板或云厂商控制台中需要放行 `3015` 端口。

## 2. 安装 Docker

在服务器上执行：

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

执行完成后，退出当前 SSH 会话并重新登录，让 Docker 用户组权限生效。

重新登录后验证：

```bash
docker --version
docker compose version
```

## 3. 拉取项目代码

建议部署到 `/opt/NoteFlow`：

```bash
cd /opt
git clone https://github.com/yunbocheng4379/NoteFlow.git
cd NoteFlow
```

如果服务器上没有 `/opt` 写入权限，可以使用：

```bash
sudo mkdir -p /opt
sudo chown -R $USER:$USER /opt
```

## 4. 准备正式环境 `.env`

你当前本地使用的 `.env` 就可以作为正式环境配置使用，但不要提交到 GitHub。

在本地电脑执行下面命令，将 `.env` 上传到服务器项目目录：

```bash
scp .env root@YOUR_SERVER_IP:/opt/NoteFlow/.env
```

如果你的服务器项目目录不是 `/opt/NoteFlow`，请把路径改成实际路径。

上传后，在服务器上检查文件是否存在：

```bash
cd /opt/NoteFlow
ls -la .env
```

正式环境中建议确认这些关键配置：

```env
APP_PORT=3015
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8483

VITE_API_BASE_URL=/api
VITE_SCREENSHOT_BASE_URL=/static/screenshots
VITE_FRONTEND_PORT=3015

ENV=production
STATIC=/static
OUT_DIR=./static/screenshots
NOTE_OUTPUT_DIR=note_results
IMAGE_BASE_URL=/static/screenshots
DATA_DIR=data

MYSQL_ROOT_PASSWORD=请填写强密码
MYSQL_DATABASE=noteflow
MYSQL_USER=noteflow
MYSQL_PASSWORD=请填写强密码

JWT_SECRET_KEY=请填写高强度随机字符串
COOKIE_ENCRYPT_KEY=请填写 Fernet Key
FRONTEND_URL=http://YOUR_SERVER_IP:3015
```

注意：

- `.env` 不要提交到 GitHub。
- Docker 正式环境中，`VITE_API_BASE_URL` 必须建议设置为 `/api`。
- 不要把 `VITE_API_BASE_URL` 设置成 `http://127.0.0.1:8483`。否则用户浏览器访问线上站点时，会尝试请求用户自己电脑上的 `127.0.0.1`，接口会失败。
- `COOKIE_ENCRYPT_KEY` 必须是 Fernet Key，可以用下面命令生成：

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

如果服务器在中国大陆，Docker Hub 拉取镜像较慢，可以在 `.env` 中增加：

```env
BASE_REGISTRY=docker.m.daocloud.io
```

## 5. CPU 版本部署

在服务器项目目录执行：

```bash
cd /opt/NoteFlow
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看后端日志：

```bash
docker compose logs -f backend
```

访问系统：

```text
http://YOUR_SERVER_IP:3015
```

## 6. GPU 版本部署

如果需要使用 GPU 转写，服务器需要先安装 NVIDIA 驱动和 NVIDIA Container Toolkit。

确认服务器可以看到显卡：

```bash
nvidia-smi
```

然后执行：

```bash
cd /opt/NoteFlow
docker compose -f docker-compose.gpu.yml up -d --build
```

检查后端容器中是否能看到 GPU：

```bash
docker exec -it noteflow-backend nvidia-smi
```

如果该命令失败，通常是 NVIDIA Container Toolkit 没有安装好，或 Docker 没有正确启用 GPU runtime。

## 7. 首次登录和模型配置

容器启动成功后：

1. 打开 `http://YOUR_SERVER_IP:3015`。
2. 注册或登录系统。
3. 进入设置页面，配置 LLM 服务商和模型。
4. 根据需要配置语音转写服务。
5. 如果 B 站、抖音、快手等平台视频需要登录态，在系统中的 Cookie/平台配置页面填写对应 Cookie。

LLM API Key 会通过页面保存到数据库中，不建议写入 `.env`。

## 8. 常用运维命令

重启全部服务：

```bash
docker compose restart
```

代码更新后重新构建：

```bash
git pull
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f nginx
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f mysql
```

停止服务：

```bash
docker compose down
```

停止服务并删除所有 Docker 数据卷：

```bash
docker compose down -v
```

注意：`docker compose down -v` 会删除 MySQL 数据、生成结果、模型缓存等正式数据。只有确定要清空数据时才可以执行。

## 9. 数据持久化说明

当前 Docker 部署使用 named volumes 持久化运行数据：

- `mysql_data`：MySQL 数据库
- `backend_static`：截图和静态输出文件
- `backend_uploads`：上传的本地视频
- `backend_note_results`：生成的笔记和转写结果
- `backend_models`：Whisper 模型缓存
- `backend_vector_db`：向量索引数据
- `backend_logs`：后端日志
- `backend_data`：后端其他运行时数据

迁移服务器前建议备份这些数据卷。

备份 MySQL 数据卷示例：

```bash
mkdir -p backups
docker run --rm -v noteflow_mysql_data:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/mysql_data.tgz -C /data .
```

如果还需要备份截图、笔记结果、模型缓存等数据，可以把命令中的 `noteflow_mysql_data` 替换成其他 volume 名称重复执行。

## 10. 不需要上传到服务器的文件

正式部署时，不需要从本地手动上传这些文件：

- `.env.bak*`
- `.DS_Store`
- `.pnpm-store/`
- `.superpowers/`
- `NoteFlow_frontend/node_modules/`
- `NoteFlow_frontend/dist/`
- `NoteFlow_frontend/noteflow.db`
- `backend/*.db`
- `backend/dump.rdb`
- `backend/logs/`
- `backend/note_results/`
- `backend/vector_db/`
- `backend/data/`
- `backend/models/`，除非你明确想预置模型文件
- `backend/uploads/`
- 根目录下的 `logs/`
- 根目录下的 `note_results/`
- 根目录下的 `static/`

正确做法是：代码通过 Git 拉取，`.env` 单独安全上传，运行时数据由 Docker volume 保存。

## 11. 部署后检查清单

部署完成后，建议执行：

```bash
docker compose config --quiet
docker compose ps
curl -f http://127.0.0.1:3015/
curl -f http://127.0.0.1:3015/api/sys_health
```

然后在网页中实际生成一个短视频笔记，确认：

- 任务状态可以正常流转
- 笔记可以正常生成
- 截图和静态资源可以正常加载
- 用户余额和电力扣减正确
- 刷新页面后仍能看到任务记录

## 12. 常见问题

### 访问页面正常，但接口请求失败

优先检查 `.env` 中：

```env
VITE_API_BASE_URL=/api
```

如果这里写成了 `http://127.0.0.1:8483`，线上用户浏览器会请求自己电脑的本地端口，导致接口失败。

### 后端启动失败并提示数据库连接失败

检查：

```bash
docker compose logs -f mysql
docker compose logs -f backend
```

并确认 `.env` 中的 MySQL 配置和 `docker-compose.yml` 中的数据库配置一致。

### B 站、抖音、快手视频解析失败

这类平台经常需要有效 Cookie。请在系统设置中配置对应平台 Cookie，并确认 Cookie 没有过期。

### 视频转写失败

检查：

- FFmpeg 是否正常安装在后端镜像中
- 转写模型是否下载完成
- 后端日志中是否有内存不足、磁盘不足或模型加载失败信息

查看后端日志：

```bash
docker compose logs -f backend
```

## 13. 推荐的最快上线流程

如果服务器已经安装 Docker，最快部署流程如下：

```bash
cd /opt
git clone https://github.com/yunbocheng4379/NoteFlow.git
cd NoteFlow
```

在本地上传 `.env`：

```bash
scp .env root@YOUR_SERVER_IP:/opt/NoteFlow/.env
```

回到服务器启动：

```bash
cd /opt/NoteFlow
docker compose up -d --build
docker compose ps
```

访问：

```text
http://YOUR_SERVER_IP:3015
```
