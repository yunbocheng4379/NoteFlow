# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BiliNote is an AI video note generation tool. It extracts content from video links (Bilibili, YouTube, Douyin, Kuaishou, local files) and generates structured Markdown notes using LLM models. Full-stack app with a FastAPI backend, React frontend, and optional Tauri desktop packaging.

## Development Commands

### Backend (Python 3.11 + FastAPI)
```bash
cd backend
pip install -r requirements.txt
python main.py                    # Starts on 0.0.0.0:8483
pytest                            # Run tests in backend/tests/
pytest tests/test_request_chunker.py::test_name   # Run a single test
```

### Frontend (React 19 + Vite + TypeScript)
```bash
cd BillNote_frontend
pnpm install
pnpm dev          # Dev server on port 3015, proxies /api to backend
pnpm build        # Production build
pnpm lint         # ESLint
```

### Docker
```bash
docker-compose up                              # Web stack (backend + frontend + nginx)
docker-compose -f docker-compose.gpu.yml up    # GPU variant
```

### Desktop (Tauri)
```bash
cd backend && ./build.sh          # Build PyInstaller backend binary
cd BillNote_frontend && pnpm tauri build
```

### Browser Extension (Vue 3 + vitesse-webext, MV3)
```bash
cd BillNote_extension
pnpm install
pnpm dev          # watch mode → ./extension/
pnpm build        # production build → ./extension/
pnpm typecheck
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright e2e
```
Load unpacked at `chrome://extensions/` → select `BillNote_extension/extension/`. Talks to the same backend at `http://localhost:8483` (configurable in the options page). CORS in `backend/main.py` already accepts `chrome-extension://` and `moz-extension://` via regex.

## Architecture

**Backend** (`backend/`) — FastAPI app, entry point `main.py`:
- `app/routers/` — API routes (all mounted under `/api` in `app/__init__.py`): `note.py` (generation), `provider.py`, `model.py`, `config.py`, `chat.py` (RAG Q&A on generated notes), `auth.py` (register/login/password + email/phone verification-code login/bind-phone), `billing.py` (credits, recharge/subscription orders, pricing preview), `profile.py`, `note_style.py`, `export_note.py`, `share.py` (public note-sharing links), `feedback.py`, `platform.py` (enable/disable downloader platforms), `update_logs.py` + `admin_update_logs.py`, `admin.py` (user management), `admin_cookies.py` (cookie pool CRUD), `admin_notifications.py`
- `app/services/` — Business logic:
  - `note.py` — `NoteGenerator` orchestrates the full pipeline (download → transcribe → LLM → notes)
  - `task_serial_executor.py` — task queue
  - `chat_service.py` + `chat_tools.py` + `vector_store.py` — RAG-based AI Q&A with Function Calling, indexing transcripts and video metadata
  - `cookie_manager.py` / `cookie_pool_manager.py` / `cookie_failure_detector.py` — per-platform cookie storage and pool rotation; injected into yt-dlp by downloaders (e.g. Bilibili)
  - `transcriber_config_manager.py` — persisted transcriber settings
  - `sms_service.py` — Alibaba Cloud SMS verification codes (eager top-level SDK import — missing `alibabacloud_dysmsapi20170525`/`alibabacloud-tea-openapi`/`alibabacloud-tea-util` packages crash the whole backend at startup, unlike `utils/mailer.py`'s lazy env-var-checked degradation)
  - `verification_code.py` — Redis-backed login/bind-phone verification codes (TTL + per-target cooldown + daily cap, atomic via Lua scripts)
  - `billing/` — `credit_ledger.py` (credits ledger), `order_service.py`, `subscription_service.py`, `pricing.py`, `referral_service.py`, `scheduler.py` (billing cron jobs, started in `main.py` lifespan)
  - `user_tier.py`, `llm_fallback.py`, `notification_service.py`, `proxy_config_manager.py`
- `app/auth/` — `jwt_handler.py` (password hashing + JWT create/decode), `dependencies.py` (`get_current_user`, `get_current_user_optional`, `get_current_admin`)
- `app/downloaders/` — Platform adapters (bilibili, youtube, douyin, kuaishou, local) with shared `base.py` interface
- `app/transcriber/` — Speech-to-text engines (fast-whisper, groq, bcut, kuaishou, mlx-whisper) with factory in `transcriber_provider.py`. YouTube path prefers existing subtitles and skips audio download when available.
- `app/gpt/` — LLM integration with factory pattern (`gpt_factory.py`), prompt templates (`prompt.py`, `prompt_builder.py`), and `request_chunker.py` for long transcripts
- `app/db/` — **MySQL** (via `DATABASE_URL`, e.g. `mysql+pymysql://user:pass@host:3306/bilinote`; SQLAlchemy raises at import time if unset) + SQLAlchemy: DAO pattern (`provider_dao.py`, `model_dao.py`, `video_task_dao.py`, `feedback_dao.py`, `note_share_dao.py`, `platform_dao.py`, `platform_cookie_dao.py`, `update_log_dao.py`, `notification_dao.py`, `transcriber_config_dao.py`), models in `models/` (`users.py`, `video_tasks.py`, `providers.py`, `credit_transactions.py`, `orders.py`, `subscriptions.py`, `subscription_plans.py`, `recharge_packages.py`, `referral_rewards.py`, `platforms.py`, `platform_cookies.py`, `note_share.py`, `note_style.py`, `notifications.py`, `update_logs.py`, `feedbacks.py`), one-off `migrate_*.py` scripts for schema changes (support both SQLite and MySQL dialects where noted)
- `app/db/redis_client.py` — Redis connection singleton (`REDIS_URL`, default `redis://127.0.0.1:6379/0`) used by verification codes and short-lived locks (e.g. `bind-phone` concurrent-bind lock)
- `app/utils/` — `response.py` (ResponseWrapper for consistent JSON), `status_code.py` (business error codes), `video_helper.py` (screenshots via FFmpeg), `export.py` (PDF/DOCX), `ppt_generator.py`, `minio_client.py`, `mailer.py` (SMTP, lazy env-checked, never raises)
- `app/validators/video_url_validator.py` — URL → platform detection (mirrored client-side in the extension)
- `app/exceptions/` — `BizException` + handlers wired in `main.py` via `register_exception_handlers`
- `backend/events/` — Blinker signal system for post-processing (e.g., temp file cleanup after transcription); registered in `lifespan` startup
- `backend/ffmpeg_helper.py` — `ensure_ffmpeg_or_raise` is called at startup; respects `FFMPEG_BIN_PATH`
- Startup sequence in `main.py`'s `lifespan`: register event handlers → `init_db()` → read transcriber config + background preload thread → seed default LLM providers → seed system note styles → start billing scheduler. Each step logs `[startup N/5 ...]` so container logs pinpoint startup failures.

**Frontend** (`BillNote_frontend/src/`) — React 19 + Vite + Tailwind + shadcn/ui:
- `pages/HomePage/` — Main note generation UI: `NoteForm.tsx` (input), `MarkdownViewer.tsx` (preview), `MarkmapComponent.tsx` (mind map)
- `pages/AuthPage/` — Login/register (password login, email/phone verification-code login, register), two-tier Tab UI
- `pages/BindPhonePage/` — Mandatory phone-binding page; gated by `PhoneGuard` in `App.tsx` for logged-in users with no phone on file
- `pages/BillingPage/`, `pages/UpgradePage/`, `pages/ReferralPage/` — Credits balance, recharge/subscription, referral program
- `pages/ProfilePage/`, `pages/FeedbackPage/`, `pages/UpdateLogPage/`, `pages/Onboarding/`, `pages/ShareViewPage/` (public shared-note view), `pages/TaskListPage/`
- `pages/SettingPage/` — LLM provider management (`Model.tsx`), system monitoring (`Monitor.tsx`), transcriber config (`transcriber.tsx`), cookie pool (`CookiePool.tsx`), note styles, notifications, update logs, user management, about — admin-only sub-pages nested under `settings/*` in `App.tsx`
- `store/` — Zustand stores: `taskStore` (persists to `localStorage` via `createJSONStorage`), `modelStore`, `configStore`, `providerStore`, `userStore` (auth token + user info), `chatStore`, `noteStyleStore`
- `services/` — Axios API clients matching backend routes (`auth.ts`, `billing.ts`, etc.)
- `hooks/useTaskPolling.ts` — Polls task status every 3 seconds
- `components/ui/` — shadcn/ui (Radix-based) components
- `i18n/` — `react-i18next` setup with locale JSON in `i18n/locales/`; toggled via `components/LanguageSwitcher.tsx`
- `App.tsx` — `AuthGuard` (redirects unauthenticated users to `/login`) and `PhoneGuard` (redirects logged-in users with no `phone` to `/bind-phone`) wrap the main authenticated route tree
- Path alias: `@` → `./src`

**Core Workflow**: User submits URL → task queued → download video → extract audio (FFmpeg) → transcribe (Whisper/Groq/etc) → generate notes (LLM) → frontend polls for completion → display Markdown + mind map.

**Browser Extension** (`BillNote_extension/`) — Vue 3 + Vite + UnoCSS + webextension-polyfill, MV3:
- `src/popup/Popup.vue` — main entry: detects platform from active tab URL, drives generate flow, shows progress + markdown
- `src/options/Options.vue` — settings: backend URL, default provider/model (loaded from `/get_all_providers` + `/get_models_by_provider/{id}`), quality, screenshot/link toggles, style
- `src/logic/api.ts` — backend API client (uses `settings.backendUrl`, unwraps `ResponseWrapper`, absolutizes `/static/screenshots/...` image paths)
- `src/logic/storage.ts` — `chrome.storage.local`-backed Pinia-like state via `useWebExtensionStorage` for settings + last 30 tasks
- `src/logic/platform.ts` — URL → platform detection mirroring `backend/app/validators/video_url_validator.py`
- `src/sidepanel/`, `src/contentScripts/` — placeholders for P2/P3 (floating button, side panel mind map, RAG chat); not wired into MVP UX
- `src/manifest.ts` — MV3 manifest, popup is default action; `host_permissions: *://*/*`
- Polling lives client-side in popup (3 s interval while open); MV3 service worker is intentionally thin in P1

## Key Configuration

- **Ports**: Backend 8483, Frontend dev 3015, Docker maps 3015→80
- **Environment**: Backend reads `backend/.env` (copy from `backend/.env.example`); root has no `.env.example` committed. **`DATABASE_URL` is required** (SQLAlchemy raises `RuntimeError` at import if unset) — MySQL in practice, e.g. `mysql+pymysql://user:pass@127.0.0.1:3306/bilinote`; `docker-compose.yml` runs its own `mysql` service and overrides `DATABASE_URL` to point at it. LLM API keys are configured through the UI, not env vars.
- **Redis**: Required for verification codes (`app/db/redis_client.py`, `REDIS_URL` env var, default `redis://127.0.0.1:6379/0`)
- **SMS/Email verification codes**: Alibaba Cloud SMS (`ALIYUN_SMS_*` env vars, see `app/services/sms_service.py`) and SMTP (`SMTP_*` env vars, see `backend/.env.example`) both degrade gracefully to "not sent" if unconfigured — except the SMS SDK import itself, which is eager and crashes startup if the `alibabacloud_dysmsapi20170525`/`alibabacloud-tea-openapi`/`alibabacloud-tea-util` packages aren't installed (pinned in `requirements.txt`)
- **Database**: MySQL (see above). A stray SQLite file may exist at `backend/bili_note.db` from earlier versions/migrations — not the active store when `DATABASE_URL` points at MySQL.
- **FFmpeg**: Required system dependency for video/audio processing
- **Vite proxy**: Dev server proxies `/api` and `/static` to backend (configured in `vite.config.ts`, reads env from parent dir; falls back to current dir when `DOCKER_BUILD` is set)
- **CORS**: `backend/main.py` uses a regex (`CORS_ORIGIN_REGEX`) that allows localhost, `tauri.localhost`, and `chrome-extension://` / `moz-extension://` origins — required for the desktop app and the browser extension.

## Code Style

- **Frontend**: ESLint + Prettier (2 spaces, single quotes, 100 char width, Tailwind plugin). TypeScript strict mode.
- **Backend**: Python with type hints. No configured linter. Uses Pydantic models for validation.
- **Note**: The frontend directory is named `BillNote_frontend` (not "Bili").
