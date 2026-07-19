# BiliNote / NoteFlow Production Deployment

This guide deploys the full web stack on a Linux server with Docker Compose:

- MySQL 8.0
- FastAPI backend
- React/Vite frontend served by nginx
- An outer nginx container that proxies `/api` and `/static` to the backend

The project uses the root `.env` as the production runtime configuration. Keep `.env`
out of Git and copy it to the server through a secure channel.

## 1. Server Requirements

Recommended minimum:

- Ubuntu 22.04 or newer
- 4 CPU cores
- 8 GB RAM for CPU deployment, 12 GB+ if using larger Whisper models
- 30 GB+ disk
- Docker and Docker Compose plugin

Open the public web port configured by `APP_PORT`, default `3015`.

## 2. Install Docker

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and log back in so the Docker group takes effect.

## 3. Clone the Repository

```bash
git clone https://github.com/yunbocheng4379/NoteFlow.git
cd NoteFlow
```

## 4. Prepare Production `.env`

Use your current local `.env` as the production configuration.

Recommended secure copy from your local machine:

```bash
scp .env root@YOUR_SERVER_IP:/opt/NoteFlow/.env
```

If you clone to another path, adjust `/opt/NoteFlow`.

Required production values:

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

MYSQL_ROOT_PASSWORD=...
MYSQL_DATABASE=bilinote
MYSQL_USER=bilinote
MYSQL_PASSWORD=...

JWT_SECRET_KEY=...
COOKIE_ENCRYPT_KEY=...
FRONTEND_URL=http://YOUR_SERVER_IP:3015
```

Important:

- Do not commit `.env`.
- `VITE_API_BASE_URL` should be `/api` for Docker production. If it is
  `http://127.0.0.1:8483`, browsers on user machines will try to call their own localhost.
- `COOKIE_ENCRYPT_KEY` must be a Fernet key. Generate one with:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

If this server is in mainland China and Docker Hub is slow, add:

```env
BASE_REGISTRY=docker.m.daocloud.io
```

## 5. Start CPU Deployment

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f backend
```

Open:

```text
http://YOUR_SERVER_IP:3015
```

## 6. Start GPU Deployment

Install NVIDIA Container Toolkit first, then run:

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

Check GPU visibility:

```bash
docker exec -it bilinote-backend nvidia-smi
```

## 7. First Login and Model Setup

After the containers are healthy:

1. Open `http://YOUR_SERVER_IP:3015`.
2. Register/login.
3. Go to settings and configure LLM providers/models.
4. Configure transcriber settings if needed.
5. For Bilibili/Douyin/Kuaishou videos that require cookies, configure platform cookies in the admin/settings pages.

LLM API keys are stored in MySQL through the UI. They should not be added to `.env`.

## 8. Common Operations

Restart:

```bash
docker compose restart
```

Rebuild after code changes:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f nginx
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f mysql
```

Stop:

```bash
docker compose down
```

Stop and delete all named volumes, including MySQL data:

```bash
docker compose down -v
```

Only use `down -v` when you intentionally want to wipe production data.

## 9. Data Persistence

The Docker deployment persists runtime data in named volumes:

- `mysql_data`: MySQL database
- `backend_static`: screenshots and static outputs
- `backend_uploads`: uploaded local videos
- `backend_note_results`: generated note/transcript files
- `backend_models`: Whisper model cache
- `backend_vector_db`: vector index
- `backend_logs`: backend logs
- `backend_data`: misc backend runtime data

Back them up before migrating servers:

```bash
docker run --rm -v bilinote_mysql_data:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/mysql_data.tgz -C /data .
```

Repeat with other volume names if needed.

## 10. Files Not Needed on the Server

Do not upload these from local development:

- `.env.bak*`
- `.DS_Store`
- `.pnpm-store/`
- `.superpowers/`
- `BillNote_frontend/node_modules/`
- `BillNote_frontend/dist/`
- `BillNote_frontend/bili_note.db`
- `backend/*.db`
- `backend/dump.rdb`
- `backend/logs/`
- `backend/note_results/`
- `backend/vector_db/`
- `backend/data/`
- `backend/models/`, unless intentionally pre-seeding model files
- `backend/uploads/`
- root `logs/`, `note_results/`, `static/`

Use Git for source code and copy only `.env` separately.

## 11. Verification Checklist

Run before handing the deployment to users:

```bash
docker compose config --quiet
docker compose ps
curl -f http://127.0.0.1:3015/
curl -f http://127.0.0.1:3015/api/sys_health
```

Then generate one short video note from the UI and confirm:

- task status progresses
- note is generated
- screenshots/static assets load
- balance/credit deduction is correct
- user can refresh and still see the task
