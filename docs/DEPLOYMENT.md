# NoteFlow 部署说明

本文档用于部署 NoteFlow Web 系统，适用于 Linux 服务器，也适用于本地 Docker Desktop 验证。

当前 Docker Compose 会启动 4 个服务：

- `noteflow-mysql`：MySQL 8.0 数据库
- `noteflow-backend`：FastAPI 后端
- `noteflow-frontend`：React/Vite 前端静态服务
- `noteflow-nginx`：统一入口，负责访问前端并代理 `/api`、`/static`

默认访问地址由 `.env` 中的 `APP_PORT` 决定。当前推荐：

```env
APP_PORT=3015
```

部署成功后访问：

```text
http://服务器IP:3015
```

本地 Docker Desktop 验证时访问：

```text
http://127.0.0.1:3015
```

## 1. 部署前准备

服务器建议配置：

- Ubuntu 22.04 或更新版本
- 4 核 CPU
- CPU 部署建议 8 GB 内存；如果使用较大的 Whisper 模型，建议 12 GB 或更高
- 30 GB 以上磁盘空间
- Docker
- Docker Compose Plugin

安装 Docker：

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

执行完成后退出 SSH 并重新登录，再验证：

```bash
docker --version
docker compose version
```

如果是云服务器，需要在安全组、防火墙或面板中放行 `.env` 中的 `APP_PORT`，默认是 `3015`。

## 2. 首次部署步骤

### 2.1 拉取代码

建议部署到 `/opt/NoteFlow`：

```bash
cd /opt
git clone https://github.com/yunbocheng4379/NoteFlow.git
cd NoteFlow
```

如果 `/opt` 没有权限：

```bash
sudo mkdir -p /opt
sudo chown -R $USER:$USER /opt
```

### 2.2 准备 `.env`

项目根目录必须有 `.env` 文件。可以从示例复制：

```bash
cp .env.example .env
```

如果你要使用本地已经调好的正式配置，可以从本地上传到服务器：

```bash
scp .env root@YOUR_SERVER_IP:/opt/NoteFlow/.env
```

正式环境至少确认这些配置：

```env
APP_PORT=3015
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8483

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

生成 `COOKIE_ENCRYPT_KEY`：

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

注意：

- `.env` 不要提交到 GitHub。
- Docker 部署时，后端不会连接 `.env` 中的宿主机 `DATABASE_URL=127.0.0.1`。
- `docker-compose.yml` 会把后端数据库地址覆盖为容器内地址：`mysql:3306/${MYSQL_DATABASE}`。
- Docker 前端镜像默认使用 `/api` 和 `/static/screenshots`，由 `noteflow-nginx` 反向代理到后端。
- 正式环境不要把前端 API 地址写成 `http://127.0.0.1:8483`，否则线上用户浏览器会请求用户自己电脑的 127.0.0.1。

如果服务器拉取 Docker Hub 较慢或失败，可以在 `.env` 中增加：

```env
BASE_REGISTRY=docker.m.daocloud.io
```

也可以临时在命令前加：

```bash
BASE_REGISTRY=docker.m.daocloud.io docker compose up -d --build
```

### 2.3 CPU 版本启动

```bash
cd /opt/NoteFlow
docker compose up -d --build
```

首次构建会下载系统包、Python 依赖和前端依赖，耗时较长是正常的。构建成功后查看状态：

```bash
docker compose ps
```

正常状态应看到：

```text
noteflow-mysql      healthy
noteflow-backend    healthy
noteflow-frontend   running
noteflow-nginx      running
```

验证健康接口：

```bash
curl http://127.0.0.1:3015/api/sys_health
```

正常返回应包含：

```json
{
  "backend": "ok",
  "ffmpeg": "ok",
  "db": "ok"
}
```

### 2.4 GPU 版本启动

如果服务器需要 GPU 转写，先安装 NVIDIA 驱动和 NVIDIA Container Toolkit。

确认服务器能识别显卡：

```bash
nvidia-smi
```

启动 GPU 版本：

```bash
cd /opt/NoteFlow
docker compose -f docker-compose.gpu.yml up -d --build
```

检查容器内 GPU：

```bash
docker exec -it noteflow-backend nvidia-smi
```

如果失败，通常是 NVIDIA Container Toolkit 没有安装好，或 Docker 没有正确启用 GPU runtime。

### 2.5 首次进入系统

1. 打开 `http://服务器IP:3015`。
2. 注册或登录系统。
3. 进入设置页配置 LLM 服务商和模型。
4. 根据需要配置语音转写服务。
5. 如果 B 站、抖音、快手等平台视频需要登录态，在系统平台 Cookie 配置中填写对应 Cookie。

LLM API Key 会保存到 MySQL 中，不建议写入 `.env`。

## 3. 项目更新后二次部署

二次部署用于服务器上已经跑着 NoteFlow，现在只是更新代码和镜像。

### 3.1 先备份数据库

强烈建议更新前备份 MySQL。先加载 `.env`：

```bash
cd /opt/NoteFlow
set -a
. ./.env
set +a
```

再执行备份：

```bash
mkdir -p backups
docker exec noteflow-mysql mysqldump \
  --default-character-set=utf8mb4 \
  -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --databases "$MYSQL_DATABASE" > "backups/noteflow_$(date +%Y%m%d_%H%M%S).sql"
```

### 3.2 拉取最新代码

```bash
cd /opt/NoteFlow
git pull
```

### 3.3 重新构建并启动

CPU 版本：

```bash
docker compose up -d --build
```

GPU 版本：

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

这条命令会保留 named volumes 中的数据库、截图、上传文件、笔记结果、模型缓存和向量库数据。

### 3.4 检查更新结果

```bash
docker compose ps
curl http://127.0.0.1:3015/api/sys_health
docker compose logs --tail=100 backend
```

如果 `noteflow-backend` 没有 healthy，优先看后端日志：

```bash
docker compose logs -f backend
```

## 4. 导入已有 MySQL 数据

如果你有旧系统导出的 SQL 文件，例如 `bilinote.sql`，可以导入到 Docker 中的 `noteflow` 数据库。

导入前先备份当前数据库：

```bash
cd /opt/NoteFlow
set -a
. ./.env
set +a
mkdir -p backups
docker exec noteflow-mysql mysqldump \
  --default-character-set=utf8mb4 \
  -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --databases "$MYSQL_DATABASE" > "backups/noteflow_before_import_$(date +%Y%m%d_%H%M%S).sql"
```

如果 SQL 是整库结构导出，并且你确认要覆盖当前 Docker 数据库：

```bash
docker compose stop nginx backend

docker exec -i noteflow-mysql mysql \
  --default-character-set=utf8mb4 \
  -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
DROP DATABASE IF EXISTS ${MYSQL_DATABASE};
CREATE DATABASE ${MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
"

docker exec -i noteflow-mysql mysql \
  --default-character-set=utf8mb4 \
  -uroot -p"$MYSQL_ROOT_PASSWORD" \
  "$MYSQL_DATABASE" < /path/to/your.sql

docker compose up -d backend nginx
docker compose ps
```

如果导入时遇到类似下面的错误：

```text
The value specified for generated column 'active_marker' is not allowed
```

说明 SQL 中显式插入了 MySQL 生成列。需要从对应 `INSERT` 语句里移除生成列字段和值，再重新导入。

如果导入后页面出现中文乱码，优先确认导入命令是否包含：

```bash
--default-character-set=utf8mb4
```

SQL 文件本身是 UTF-8 时，缺少这个参数可能会导致 MySQL CLI 按 `latin1` 读取输入，最终把乱码写入 `utf8mb4` 表中。

## 5. 常用运维命令

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f nginx
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f mysql
```

重启全部服务：

```bash
docker compose restart
```

只重启后端：

```bash
docker compose restart backend
```

停止服务但保留数据：

```bash
docker compose down
```

停止服务并删除所有 Docker 数据卷：

```bash
docker compose down -v
```

警告：`docker compose down -v` 会删除 MySQL 数据、生成结果、模型缓存、上传文件等正式数据。除非确定要清空系统，否则不要执行。

## 6. 数据持久化说明

当前 Docker Compose 顶层项目名是 `noteflow`，因此实际 Docker volume 名称会带 `noteflow_` 前缀。

主要数据卷：

- `noteflow_mysql_data`：MySQL 数据库
- `noteflow_backend_static`：截图和静态输出文件
- `noteflow_backend_uploads`：上传的本地视频
- `noteflow_backend_note_results`：生成的笔记和转写结果
- `noteflow_backend_models`：Whisper 模型缓存
- `noteflow_backend_vector_db`：向量索引数据
- `noteflow_backend_logs`：后端日志
- `noteflow_backend_data`：后端其他运行时数据

备份某个 volume 示例：

```bash
mkdir -p backups
docker run --rm \
  -v noteflow_mysql_data:/data \
  -v "$PWD/backups:/backup" \
  alpine tar czf /backup/noteflow_mysql_data.tgz -C /data .
```

还原前请先停止服务，并确认目标 volume 可以被覆盖。

## 7. 本地 Docker Desktop 验证

在本地项目目录执行：

```bash
cd /path/to/NoteFlow
BASE_REGISTRY=docker.m.daocloud.io docker compose up -d --build
```

验证：

```bash
docker compose ps
curl http://127.0.0.1:3015/api/sys_health
```

浏览器打开：

```text
http://127.0.0.1:3015
```

本地 Docker Desktop 使用的是 Docker 容器内的 `noteflow-mysql`，不是宿主机上直接运行的 MySQL。
