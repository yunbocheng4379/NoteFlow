# 多方式登录与强制绑定手机号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BiliNote 支持邮箱验证码登录、手机验证码登录（在现有密码登录基础上），并在注册成功后 / 老用户下次登录时强制引导绑定手机号。

**Architecture:** 后端新增一个 Redis 验证码存储 + 限流模块（`app/services/verification_code.py`），一个阿里云短信封装（`app/services/sms_service.py`），复用现有 SMTP 邮件封装发验证码邮件；`auth.py` 路由新增 3 个接口（`send-code`、`login-by-code`、`bind-phone`）并扩展现有 `/auth/login` 支持手机号匹配。前端 `AuthPage` 改造成两层 Tab，新增 `/bind-phone` 页面和路由守卫。

**Tech Stack:** FastAPI + SQLAlchemy + Redis (`redis` Python 包, sync client) + 阿里云短信 SDK (`alibabacloud_dysmsapi20170525`) + 现有 SMTP (`smtplib`)；前端 React 19 + Zustand + react-router-dom + axios。

## Global Constraints

- 验证码 Redis key: `verify_code:{purpose}:{target}`，TTL 300 秒，一次性消费（校验成功立即删除）。
- 限流 key: `verify_code_cooldown:{target}`（`SETNX` + `EX 60`）和 `verify_code_daily:{target}:{YYYYMMDD}`（每日上限 10 次）。（更新：实现已改为 Lua script 原子比较并设置，语义变更为 target+purpose 维度限流，60 秒内同一 target 对同一 purpose 只能发一次，不同 purpose 互不影响。）
- 手机号格式：`^1\d{10}$`（11 位，1 开头）。
- 验证码为 6 位数字字符串（可含前导 0），生成用 `random.randint(0, 999999)` 后 `str(...).zfill(6)`。
- 错误码新增到 `backend/app/utils/status_code.py` 的 `StatusCode`：`TARGET_NOT_FOUND=40402`、`PHONE_EXISTS=40903`、`CODE_INVALID=40103`、`CODE_EXPIRED=40104`、`RATE_LIMITED=42901`、`SEND_CODE_FAILED=50001`。
- 强制绑定手机号仅在前端路由层拦截，后端不加拦截依赖。
- 短信/邮件发送失败不能抛出未捕获异常导致 500，必须转换成 `SEND_CODE_FAILED` 业务错误返回给前端。
- 所有新增 Python 依赖使用精确版本号（`==`），写入 `backend/requirements.txt`。

---

## File Structure

**新建文件：**
- `backend/app/services/verification_code.py` — Redis 验证码生成/校验/限流的唯一入口
- `backend/app/services/sms_service.py` — 阿里云短信发送封装
- `backend/app/db/redis_client.py` — Redis 连接单例（同步 `redis.Redis` client，从 `REDIS_URL` 环境变量读取）
- `backend/tests/test_verification_code.py` — 验证码生成/校验/限流单测
- `backend/tests/test_auth_code_login.py` — `send-code` / `login-by-code` / `bind-phone` / 手机号密码登录的路由级单测
- `BillNote_frontend/src/pages/BindPhonePage/index.tsx` — 绑定手机号页面

**修改文件：**
- `backend/requirements.txt` — 新增阿里云短信 SDK 依赖
- `backend/app/utils/status_code.py` — 新增 6 个错误码
- `backend/app/utils/mailer.py` — 新增 `send_verification_code_email`
- `backend/app/routers/auth.py` — 新增 3 个路由 + 扩展 `/auth/login` 的账号匹配 + 扩展 `RegisterRequest`（不变，注册流程本身不变）
- `BillNote_frontend/src/services/auth.ts` — 新增 `sendCode`/`loginByCode`/`bindPhone` 方法 + 错误码映射 + `UserInfo.phone` 字段
- `BillNote_frontend/src/pages/AuthPage/index.tsx` — 改造成两层 Tab
- `BillNote_frontend/src/App.tsx` — 新增 `/bind-phone` 路由 + 路由守卫检查 `phone`

## Interfaces Between Tasks

- `verification_code.py` 产出：
  - `generate_and_store(target: str, purpose: str) -> str`（返回生成的 6 位码，内部处理限流校验，限流不通过抛 `RateLimitedError`）
  - `verify_and_consume(target: str, purpose: str, code: str) -> bool`（校验成功返回 True 并删除 key；不存在/过期返回 `CodeExpiredError`；不匹配返回 `CodeInvalidError`）
  - 异常类：`RateLimitedError`、`CodeExpiredError`、`CodeInvalidError`（均继承 `Exception`，供 `auth.py` 捕获转换为业务错误码）
- `sms_service.py` 产出：`send_verification_sms(phone: str, code: str) -> bool`（失败返回 False，不抛异常，日志记录原因）
- `mailer.py` 新函数产出：`send_verification_code_email(to: str, code: str) -> bool`（复用 `send_email`，同样失败返回 False 不抛异常）
- `redis_client.py` 产出：`get_redis() -> redis.Redis`（惰性单例）

---

### Task 1: Redis 连接单例

**Files:**
- Create: `backend/app/db/redis_client.py`
- Test: 无独立单测（在 Task 2 的测试里间接验证连接可用）

**Interfaces:**
- Produces: `get_redis() -> redis.Redis`

- [ ] **Step 1: 创建 Redis 客户端单例**

```python
# backend/app/db/redis_client.py
"""Redis 连接单例, 供验证码等短生命周期数据使用."""
import os
from functools import lru_cache

import redis
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_redis() -> redis.Redis:
    url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    return redis.Redis.from_url(url, decode_responses=True)
```

- [ ] **Step 2: 本地启动 Redis 并验证可连通**

Run: `redis-server --daemonize yes && redis-cli ping`
Expected: `PONG`

若本机没有安装 Redis：`brew install redis`（macOS）。

- [ ] **Step 3: 用 Python 验证客户端可用**

Run:
```bash
cd backend && /opt/anaconda3/envs/python3.11/bin/python -c "
from app.db.redis_client import get_redis
r = get_redis()
r.set('smoke_test', '1', ex=5)
print(r.get('smoke_test'))
"
```
Expected: 输出 `1`

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/redis_client.py
git commit -m "feat(auth): 新增 Redis 连接单例, 为验证码功能提供存储"
```

---

### Task 2: 验证码生成/校验/限流模块

**Files:**
- Create: `backend/app/services/verification_code.py`
- Test: `backend/tests/test_verification_code.py`

**Interfaces:**
- Consumes: `get_redis()` from Task 1 (`backend.app.db.redis_client`)
- Produces:
  - `generate_and_store(target: str, purpose: str) -> str`
  - `verify_and_consume(target: str, purpose: str, code: str) -> bool`
  - `RateLimitedError`, `CodeExpiredError`, `CodeInvalidError`

- [ ] **Step 1: 写失败的测试**

```python
# backend/tests/test_verification_code.py
"""verification_code.py 单测 — 直连本地 Redis, 每个测试用独立 target 避免互相污染."""
import time
import pytest

from app.db.redis_client import get_redis
from app.services.verification_code import (
    generate_and_store,
    verify_and_consume,
    RateLimitedError,
    CodeExpiredError,
    CodeInvalidError,
)


@pytest.fixture(autouse=True)
def cleanup_redis():
    r = get_redis()
    yield
    for pattern in ("verify_code:*test_target*", "verify_code_cooldown:*test_target*", "verify_code_daily:*test_target*"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


def test_generate_and_store_returns_six_digit_code():
    code = generate_and_store("test_target_1@example.com", "login")
    assert len(code) == 6
    assert code.isdigit()


def test_verify_and_consume_success():
    target = "test_target_2@example.com"
    code = generate_and_store(target, "login")
    assert verify_and_consume(target, "login", code) is True
    # 一次性消费: 再校验同一个码应该报过期(已删除)
    with pytest.raises(CodeExpiredError):
        verify_and_consume(target, "login", code)


def test_verify_and_consume_wrong_code_raises_invalid():
    target = "test_target_3@example.com"
    generate_and_store(target, "login")
    with pytest.raises(CodeInvalidError):
        verify_and_consume(target, "login", "000000")


def test_verify_and_consume_no_code_raises_expired():
    with pytest.raises(CodeExpiredError):
        verify_and_consume("test_target_never_sent@example.com", "login", "123456")


def test_purpose_isolation():
    """同一 target 不同 purpose 的码互不影响"""
    target = "test_target_4@example.com"
    login_code = generate_and_store(target, "login")
    bind_code = generate_and_store(target, "bind")
    assert verify_and_consume(target, "login", login_code) is True
    assert verify_and_consume(target, "bind", bind_code) is True


def test_cooldown_blocks_second_send_within_60s():
    target = "test_target_5@example.com"
    generate_and_store(target, "login")
    with pytest.raises(RateLimitedError):
        generate_and_store(target, "login")


def test_daily_limit_blocks_after_ten_sends():
    target = "test_target_6@example.com"
    r = get_redis()
    # 直接把冷却 key 清掉, 只测每日上限
    for i in range(10):
        r.delete(f"verify_code_cooldown:{target}")
        generate_and_store(target, "login")
    r.delete(f"verify_code_cooldown:{target}")
    with pytest.raises(RateLimitedError):
        generate_and_store(target, "login")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/test_verification_code.py -v`
Expected: FAIL，报 `ModuleNotFoundError: No module named 'app.services.verification_code'`

- [ ] **Step 3: 实现验证码模块**

```python
# backend/app/services/verification_code.py
"""
验证码 (登录/绑定手机号) 核心模块
=====================================
统一走 Redis 存储 + TTL 过期. 一次性消费: 校验成功立即删除 key, 防重放.

Key 设计:
  verify_code:{purpose}:{target}          -> 6 位数字码, TTL 300s
  verify_code_cooldown:{target}           -> 占位值, TTL 60s (SETNX 防抢发)
  verify_code_daily:{target}:{YYYYMMDD}   -> 计数器, TTL 到当天结束

purpose: "login" | "bind"
target: 手机号或邮箱原始字符串 (调用方需自行 strip/normalize)
"""
import random
from datetime import datetime, timedelta

from app.db.redis_client import get_redis
from app.utils.logger import get_logger

logger = get_logger(__name__)

CODE_TTL_SECONDS = 300
COOLDOWN_SECONDS = 60
DAILY_LIMIT = 10


class RateLimitedError(Exception):
    """发送过于频繁 (冷却期内或超过每日上限)"""


class CodeExpiredError(Exception):
    """验证码不存在或已过期"""


class CodeInvalidError(Exception):
    """验证码不匹配"""


def _code_key(purpose: str, target: str) -> str:
    return f"verify_code:{purpose}:{target}"


def _cooldown_key(target: str) -> str:
    return f"verify_code_cooldown:{target}"


def _daily_key(target: str) -> str:
    today = datetime.now().strftime("%Y%m%d")
    return f"verify_code_daily:{target}:{today}"


def _seconds_until_midnight() -> int:
    now = datetime.now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds())


def generate_and_store(target: str, purpose: str) -> str:
    """生成 6 位验证码, 写入 Redis, 触发限流检查. 限流不通过抛 RateLimitedError."""
    r = get_redis()

    if not r.set(_cooldown_key(target), "1", ex=COOLDOWN_SECONDS, nx=True):
        logger.warning(f"验证码发送被冷却限流拦截: target={target}, purpose={purpose}")
        raise RateLimitedError("发送过于频繁，请稍后再试")

    daily_key = _daily_key(target)
    count = r.incr(daily_key)
    if count == 1:
        r.expire(daily_key, _seconds_until_midnight())
    if count > DAILY_LIMIT:
        logger.warning(f"验证码发送被每日上限拦截: target={target}, purpose={purpose}, count={count}")
        raise RateLimitedError("今日发送次数已达上限，请明天再试")

    code = str(random.randint(0, 999999)).zfill(6)
    r.set(_code_key(purpose, target), code, ex=CODE_TTL_SECONDS)
    return code


def verify_and_consume(target: str, purpose: str, code: str) -> bool:
    """校验验证码. 成功返回 True 并删除 key (一次性消费).
    不存在/已过期抛 CodeExpiredError, 存在但不匹配抛 CodeInvalidError."""
    r = get_redis()
    key = _code_key(purpose, target)
    stored = r.get(key)

    if stored is None:
        raise CodeExpiredError("验证码已过期或不存在，请重新获取")

    if stored != code:
        raise CodeInvalidError("验证码错误")

    r.delete(key)
    return True
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/test_verification_code.py -v`
Expected: 7 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/verification_code.py backend/tests/test_verification_code.py
git commit -m "feat(auth): 新增验证码生成/校验/限流模块"
```

---

### Task 3: 新增错误码

**Files:**
- Modify: `backend/app/utils/status_code.py`

**Interfaces:**
- Produces: 6 个新增 `StatusCode` 成员，供 Task 4/5 路由层使用

- [ ] **Step 1: 直接修改（枚举新增无需测试驱动，属于纯数据变更）**

```python
# backend/app/utils/status_code.py
from enum import IntEnum

class StatusCode(IntEnum):
    SUCCESS = 0
    FAIL = 1

    DOWNLOAD_ERROR = 1001
    TRANSCRIBE_ERROR = 1002
    GENERATE_ERROR = 1003

    INVALID_URL = 2001
    PARAM_ERROR = 2002

    # 认证相关
    ACCOUNT_NOT_FOUND = 40401   # 账户不存在
    PASSWORD_INCORRECT = 40101  # 密码错误
    ACCOUNT_DISABLED = 40301    # 账号被禁用
    USERNAME_EXISTS = 40901     # 用户名已存在
    EMAIL_EXISTS = 40902        # 邮箱已被注册

    # 验证码登录 / 绑定手机号相关
    TARGET_NOT_FOUND = 40402    # 验证码登录目标(手机号/邮箱)对应账号不存在
    PHONE_EXISTS = 40903        # 手机号已被其他账号绑定
    CODE_INVALID = 40103        # 验证码错误
    CODE_EXPIRED = 40104        # 验证码已过期或不存在
    RATE_LIMITED = 42901        # 发送过于频繁
    SEND_CODE_FAILED = 50001    # 验证码发送失败(短信/邮件服务异常)
```

- [ ] **Step 2: 验证导入无语法错误**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -c "from app.utils.status_code import StatusCode; print(StatusCode.TARGET_NOT_FOUND, StatusCode.SEND_CODE_FAILED)"`
Expected: `StatusCode.TARGET_NOT_FOUND StatusCode.SEND_CODE_FAILED` (或对应整数值)，无异常

- [ ] **Step 3: Commit**

```bash
git add backend/app/utils/status_code.py
git commit -m "feat(auth): 新增验证码登录/绑定手机号相关错误码"
```

---

### Task 4: 阿里云短信封装 + 邮箱验证码邮件

**Files:**
- Create: `backend/app/services/sms_service.py`
- Modify: `backend/requirements.txt`
- Modify: `backend/app/utils/mailer.py`

**Interfaces:**
- Produces: `send_verification_sms(phone: str, code: str) -> bool`, `send_verification_code_email(to: str, code: str) -> bool`
- Consumes: 无（Task 5 会消费这两个函数）

- [ ] **Step 1: 新增依赖到 requirements.txt**

在 `backend/requirements.txt` 末尾追加（保持字母序无关，追加到文件尾即可，与现有风格一致）：

```
alibabacloud_dysmsapi20170525==4.6.0
alibabacloud-tea-openapi==0.4.5
alibabacloud-tea-util==0.3.14
```

- [ ] **Step 2: 安装依赖**

Run: `/opt/anaconda3/envs/python3.11/bin/pip install alibabacloud_dysmsapi20170525==4.6.0 alibabacloud-tea-openapi==0.4.5 alibabacloud-tea-util==0.3.14`
Expected: 安装成功，无报错

- [ ] **Step 3: 实现短信服务封装**

```python
# backend/app/services/sms_service.py
"""
阿里云短信 (SMS) 发送封装.
=====================================
配置来自环境变量:
  ALIYUN_SMS_ACCESS_KEY_ID
  ALIYUN_SMS_ACCESS_KEY_SECRET
  ALIYUN_SMS_SIGN_NAME       短信签名 (需在阿里云控制台审核通过)
  ALIYUN_SMS_TEMPLATE_CODE   短信模板 code, 模板内容需含 ${code} 变量
  ALIYUN_SMS_REGION          默认 cn-hangzhou

设计取舍: 与 mailer.py 一致 —— 发送失败只记日志返回 False, 不抛异常;
由调用方 (auth.py 路由) 决定是否转换为业务错误返回给前端。
"""
import json
import os

from alibabacloud_dysmsapi20170525.client import Client as DysmsapiClient
from alibabacloud_dysmsapi20170525 import models as dysmsapi_models
from alibabacloud_tea_openapi import models as open_api_models

from app.utils.logger import get_logger

logger = get_logger(__name__)


def _get_client() -> DysmsapiClient | None:
    access_key_id = os.getenv("ALIYUN_SMS_ACCESS_KEY_ID")
    access_key_secret = os.getenv("ALIYUN_SMS_ACCESS_KEY_SECRET")
    if not access_key_id or not access_key_secret:
        logger.warning("阿里云短信未配置 (ALIYUN_SMS_ACCESS_KEY_ID/SECRET 缺失)，跳过发送短信")
        return None

    region = os.getenv("ALIYUN_SMS_REGION", "cn-hangzhou")
    config = open_api_models.Config(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        region_id=region,
        endpoint=f"dysmsapi.{region}.aliyuncs.com",
    )
    return DysmsapiClient(config)


def send_verification_sms(phone: str, code: str) -> bool:
    """发送验证码短信. 失败只记日志, 返回 False (调用方负责转换为业务错误)."""
    client = _get_client()
    if client is None:
        return False

    sign_name = os.getenv("ALIYUN_SMS_SIGN_NAME")
    template_code = os.getenv("ALIYUN_SMS_TEMPLATE_CODE")
    if not sign_name or not template_code:
        logger.warning("阿里云短信签名/模板未配置 (ALIYUN_SMS_SIGN_NAME/TEMPLATE_CODE 缺失)，跳过发送短信")
        return False

    request = dysmsapi_models.SendSmsRequest(
        phone_numbers=phone,
        sign_name=sign_name,
        template_code=template_code,
        template_param=json.dumps({"code": code}),
    )
    try:
        response = client.send_sms(request)
        body = response.body
        if body.code == "OK":
            logger.info(f"短信验证码已发送: phone={phone}")
            return True
        logger.error(f"短信发送失败: phone={phone}, code={body.code}, message={body.message}")
        return False
    except Exception as e:
        logger.error(f"短信发送异常: phone={phone}, error={e}")
        return False
```

- [ ] **Step 4: 新增邮箱验证码邮件函数**

在 `backend/app/utils/mailer.py` 文件末尾追加：

```python
def send_verification_code_email(to: str, code: str) -> bool:
    """登录/绑定验证码邮件。"""
    subject = "BiliNote 验证码"
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #167a6e;">你的验证码</h2>
      <p style="font-size: 28px; font-weight: 600; letter-spacing: 4px; color: #0f172a;">{code}</p>
      <p style="color: #666; font-size: 13px;">验证码 5 分钟内有效，请勿告知他人。</p>
      <p style="color: #999; font-size: 12px;">来自 BiliNote AI 笔记系统</p>
    </div>
    """
    return send_email(to=to, subject=subject, html_body=html_body)
```

- [ ] **Step 5: 验证模块可正常导入（无 Access Key 情况下应优雅返回 False，不抛异常）**

Run:
```bash
cd backend && /opt/anaconda3/envs/python3.11/bin/python -c "
from app.services.sms_service import send_verification_sms
from app.utils.mailer import send_verification_code_email
print('sms result (no config expected False):', send_verification_sms('13800000000', '123456'))
print('email import ok')
"
```
Expected: 输出 `sms result (no config expected False): False`，`email import ok`，无异常抛出

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/services/sms_service.py backend/app/utils/mailer.py
git commit -m "feat(auth): 新增阿里云短信封装与邮箱验证码邮件"
```

---

### Task 5: 后端路由 — send-code / login-by-code / bind-phone / 手机号密码登录

**Files:**
- Modify: `backend/app/routers/auth.py`
- Test: `backend/tests/test_auth_code_login.py`

**Interfaces:**
- Consumes:
  - `generate_and_store`, `verify_and_consume`, `RateLimitedError`, `CodeExpiredError`, `CodeInvalidError` from `app.services.verification_code` (Task 2)
  - `send_verification_sms` from `app.services.sms_service` (Task 4)
  - `send_verification_code_email` from `app.utils.mailer` (Task 4)
  - `StatusCode.TARGET_NOT_FOUND` 等新增错误码 (Task 3)
- Produces: `POST /auth/send-code`, `POST /auth/login-by-code`, `POST /auth/bind-phone` 三个新路由；`POST /auth/login` 支持手机号匹配

- [ ] **Step 1: 写失败的测试**

先确认测试用的 FastAPI TestClient 模式在项目里是否已有先例 — 项目目前没有路由级测试先例，这里直接连本地 MySQL（与 `test_credit_ledger.py` 一致的模式）+ 连本地 Redis，用 `TestClient` 发真实 HTTP 请求。

```python
# backend/tests/test_auth_code_login.py
"""
auth.py 验证码登录/绑定手机号路由集成测试.
直连本地 MySQL + Redis, 每个测试创建独立用户, 测试结束清理。

跑法:
  cd backend && pytest tests/test_auth_code_login.py -v
"""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import app.db.init_db  # noqa: F401
from app.db.engine import SessionLocal
from app.db.models.users import User
from app.db.redis_client import get_redis
from app.auth.jwt_handler import hash_password
from main import app as fastapi_app

client = TestClient(fastapi_app)


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def test_user(db):
    suffix = datetime.now().strftime("%H%M%S%f")
    u = User(
        username=f"codelogin_{suffix}",
        email=f"codelogin_{suffix}@test.local",
        phone=f"139{suffix[:8]}",
        hashed_password=hash_password("plain-pass-123"),
        credits=0,
        total_points=0,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id

    yield u

    db.execute(User.__table__.delete().where(User.id == user_id))
    db.commit()


@pytest.fixture(autouse=True)
def cleanup_redis():
    r = get_redis()
    yield
    for pattern in ("verify_code:*codelogin*", "verify_code_cooldown:*codelogin*", "verify_code_daily:*codelogin*"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


def _put_code(target: str, purpose: str) -> str:
    """测试直接写 Redis 造码, 绕开限流/发送环节。"""
    from app.services.verification_code import _code_key, CODE_TTL_SECONDS
    r = get_redis()
    code = "123456"
    r.set(_code_key(purpose, target), code, ex=CODE_TTL_SECONDS)
    return code


# ---------- send-code ----------

def test_send_code_login_target_not_found():
    resp = client.post("/api/auth/send-code", json={
        "target": "nobody_codelogin_xyz@test.local",
        "target_type": "email",
        "purpose": "login",
    })
    body = resp.json()
    assert body["code"] == 40402  # TARGET_NOT_FOUND


def test_send_code_bind_phone_already_exists(test_user):
    resp = client.post("/api/auth/send-code", json={
        "target": test_user.phone,
        "target_type": "phone",
        "purpose": "bind",
    })
    body = resp.json()
    assert body["code"] == 40903  # PHONE_EXISTS


def test_send_code_login_success_when_target_exists(test_user):
    resp = client.post("/api/auth/send-code", json={
        "target": test_user.email,
        "target_type": "email",
        "purpose": "login",
    })
    body = resp.json()
    # SMTP 未配置时发送会失败, 但接口不应 500, 应返回 SEND_CODE_FAILED 或 success
    assert body["code"] in (0, 50001)


# ---------- login-by-code ----------

def test_login_by_code_success(test_user):
    code = _put_code(test_user.email, "login")
    resp = client.post("/api/auth/login-by-code", json={
        "target": test_user.email,
        "target_type": "email",
        "code": code,
    })
    body = resp.json()
    assert body["code"] == 0
    assert "token" in body["data"]
    assert body["data"]["user"]["id"] == test_user.id


def test_login_by_code_account_not_found():
    resp = client.post("/api/auth/login-by-code", json={
        "target": "ghost_codelogin@test.local",
        "target_type": "email",
        "code": "123456",
    })
    body = resp.json()
    assert body["code"] == 40401  # ACCOUNT_NOT_FOUND


def test_login_by_code_wrong_code(test_user):
    _put_code(test_user.email, "login")
    resp = client.post("/api/auth/login-by-code", json={
        "target": test_user.email,
        "target_type": "email",
        "code": "000000",
    })
    body = resp.json()
    assert body["code"] == 40103  # CODE_INVALID


def test_login_by_code_expired_code(test_user):
    resp = client.post("/api/auth/login-by-code", json={
        "target": test_user.email,
        "target_type": "email",
        "code": "123456",
    })
    body = resp.json()
    assert body["code"] == 40104  # CODE_EXPIRED


# ---------- bind-phone ----------

def test_bind_phone_success(test_user, db):
    # 先清掉 fixture 里预置的 phone, 模拟未绑定用户
    test_user.phone = None
    db.commit()

    new_phone = "13900001111"
    code = _put_code(new_phone, "bind")

    login_resp = client.post("/api/auth/login", json={"account": test_user.username, "password": "plain-pass-123"})
    token = login_resp.json()["data"]["token"]

    resp = client.post(
        "/api/auth/bind-phone",
        json={"phone": new_phone, "code": code},
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["code"] == 0

    db.refresh(test_user)
    assert test_user.phone == new_phone


def test_bind_phone_duplicate(test_user, db):
    other_suffix = datetime.now().strftime("%H%M%S%f")
    other = User(
        username=f"codelogin_other_{other_suffix}",
        email=f"codelogin_other_{other_suffix}@test.local",
        phone=f"138{other_suffix[:8]}",
        hashed_password=hash_password("plain-pass-123"),
        credits=0,
        total_points=0,
    )
    db.add(other)
    db.commit()
    db.refresh(other)

    code = _put_code(other.phone, "bind")
    login_resp = client.post("/api/auth/login", json={"account": test_user.username, "password": "plain-pass-123"})
    token = login_resp.json()["data"]["token"]

    resp = client.post(
        "/api/auth/bind-phone",
        json={"phone": other.phone, "code": code},
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["code"] == 40903  # PHONE_EXISTS

    db.execute(User.__table__.delete().where(User.id == other.id))
    db.commit()


# ---------- 密码登录支持手机号 ----------

def test_password_login_by_phone(test_user):
    resp = client.post("/api/auth/login", json={"account": test_user.phone, "password": "plain-pass-123"})
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["user"]["id"] == test_user.id
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/test_auth_code_login.py -v`
Expected: FAIL，`send-code`/`login-by-code`/`bind-phone` 路由 404，及手机号密码登录断言失败

- [ ] **Step 3: 实现路由改动**

将 `backend/app/routers/auth.py` 整体替换为：

```python
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.jwt_handler import hash_password, verify_password, create_access_token
from app.auth.dependencies import get_current_user
from app.db.engine import get_db
from app.db.models.users import User
from app.services.verification_code import (
    generate_and_store,
    verify_and_consume,
    RateLimitedError,
    CodeExpiredError,
    CodeInvalidError,
)
from app.services.sms_service import send_verification_sms
from app.utils.mailer import send_verification_code_email
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

router = APIRouter(prefix="/auth", tags=["auth"])

PHONE_PATTERN = r"^1\d{10}$"


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    confirm_password: str
    invite_code: str | None = None  # 可选; 6 位 base32; 大小写不敏感

    @field_validator("username")
    @classmethod
    def username_length(cls, v):
        if len(v) < 3 or len(v) > 32:
            raise ValueError("用户名长度需在 3~32 字符之间")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v

    @field_validator("invite_code")
    @classmethod
    def invite_code_norm(cls, v):
        if v is None:
            return None
        v = v.strip().upper()
        return v if v else None

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致")
        return self


class LoginRequest(BaseModel):
    # 支持用户名/邮箱/手机号登录
    account: str
    password: str


class SendCodeRequest(BaseModel):
    target: str
    target_type: str  # "email" | "phone"
    purpose: str       # "login" | "bind"

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v

    @field_validator("purpose")
    @classmethod
    def purpose_valid(cls, v):
        if v not in ("login", "bind"):
            raise ValueError("purpose 必须是 login 或 bind")
        return v

    @model_validator(mode="after")
    def target_format_valid(self):
        import re
        target = self.target.strip()
        if self.target_type == "phone" and not re.match(PHONE_PATTERN, target):
            raise ValueError("手机号格式不正确")
        if self.target_type == "email" and ("@" not in target or "." not in target.split("@")[-1]):
            raise ValueError("邮箱格式不正确")
        self.target = target
        return self


class LoginByCodeRequest(BaseModel):
    target: str
    target_type: str  # "email" | "phone"
    code: str

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v


class BindPhoneRequest(BaseModel):
    phone: str
    code: str

    @field_validator("phone")
    @classmethod
    def phone_format_valid(cls, v):
        import re
        v = v.strip()
        if not re.match(PHONE_PATTERN, v):
            raise ValueError("手机号格式不正确")
        return v


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar": user.avatar,
        "is_admin": int(user.is_admin or 0),
    }


@router.post("/register")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    from app.services.billing import credit_ledger, referral_service

    if db.query(User).filter(User.username == body.username).first():
        return R.error(code=StatusCode.USERNAME_EXISTS, msg="用户名已存在")
    if db.query(User).filter(User.email == body.email).first():
        return R.error(code=StatusCode.EMAIL_EXISTS, msg="邮箱已被注册")

    try:
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            credits=0,
            total_points=0,
            used_points=0,
        )
        db.add(user)
        db.flush()

        referral_service.generate_referral_code(db, user.id)

        credit_ledger.grant(
            db,
            user_id=user.id,
            amount=referral_service.REGISTER_GRANT_CREDITS,
            type_="REGISTER_GRANT",
            note="新用户注册赠送",
        )

        referral_service.bind_referrer_and_pay_register_reward(
            db, invitee_user_id=user.id, invite_code=body.invite_code
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    token = create_access_token(user.id, user.username)
    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    account = body.account.strip()
    user = (
        db.query(User)
        .filter(or_(User.username == account, User.email == account, User.phone == account))
        .first()
    )
    if not user:
        return R.error(code=StatusCode.ACCOUNT_NOT_FOUND, msg="账户不存在，请先注册")
    if not verify_password(body.password, user.hashed_password):
        return R.error(code=StatusCode.PASSWORD_INCORRECT, msg="密码错误")
    if not user.is_active:
        return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")

    token = create_access_token(user.id, user.username)

    user.last_login_at = datetime.now()
    db.commit()

    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/send-code")
def send_code(body: SendCodeRequest, db: Session = Depends(get_db)):
    target = body.target

    if body.target_type == "phone":
        existing = db.query(User).filter(User.phone == target).first()
    else:
        existing = db.query(User).filter(User.email == target).first()

    if body.purpose == "login":
        if not existing:
            return R.error(code=StatusCode.TARGET_NOT_FOUND, msg="该手机号/邮箱未注册，请先注册")
    else:  # bind
        if existing:
            return R.error(code=StatusCode.PHONE_EXISTS, msg="该手机号已被其他账号绑定")

    try:
        code = generate_and_store(target, body.purpose)
    except RateLimitedError as e:
        return R.error(code=StatusCode.RATE_LIMITED, msg=str(e))

    if body.target_type == "phone":
        sent = send_verification_sms(target, code)
    else:
        sent = send_verification_code_email(target, code)

    if not sent:
        return R.error(code=StatusCode.SEND_CODE_FAILED, msg="验证码发送失败，请稍后重试")

    return R.success({"sent": True})


@router.post("/login-by-code")
def login_by_code(body: LoginByCodeRequest, db: Session = Depends(get_db)):
    target = body.target.strip()

    if body.target_type == "phone":
        user = db.query(User).filter(User.phone == target).first()
    else:
        user = db.query(User).filter(User.email == target).first()

    if not user:
        return R.error(code=StatusCode.ACCOUNT_NOT_FOUND, msg="账户不存在，请先注册")

    try:
        verify_and_consume(target, "login", body.code)
    except CodeExpiredError as e:
        return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
    except CodeInvalidError as e:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

    if not user.is_active:
        return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")

    token = create_access_token(user.id, user.username)
    user.last_login_at = datetime.now()
    db.commit()

    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/bind-phone")
def bind_phone(
    body: BindPhoneRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    phone = body.phone

    existing = db.query(User).filter(User.phone == phone, User.id != current_user.id).first()
    if existing:
        return R.error(code=StatusCode.PHONE_EXISTS, msg="该手机号已被其他账号绑定")

    try:
        verify_and_consume(phone, "bind", body.code)
    except CodeExpiredError as e:
        return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
    except CodeInvalidError as e:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

    current_user.phone = phone
    db.commit()

    return R.success({"phone": phone})


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return R.success(_user_payload(current_user))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/test_auth_code_login.py -v`
Expected: 全部 PASS（`test_send_code_login_success_when_target_exists` 因本地未配置 SMTP，`body["code"]` 会是 50001，测试已用 `in (0, 50001)` 兼容这一点）

- [ ] **Step 5: 回归运行现有 auth 相关及 credit_ledger 测试确认无破坏**

Run: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/test_credit_ledger.py tests/test_auth_code_login.py tests/test_verification_code.py -v`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/auth.py backend/tests/test_auth_code_login.py
git commit -m "feat(auth): 新增验证码登录/绑定手机号路由, 密码登录支持手机号"
```

---

### Task 6: 前端 `services/auth.ts` — 新增接口方法与类型

**Files:**
- Modify: `BillNote_frontend/src/services/auth.ts`

**Interfaces:**
- Consumes: 无（对接 Task 5 的后端路由）
- Produces: `authApi.sendCode`, `authApi.loginByCode`, `authApi.bindPhone`；`UserInfo.phone: string | null`；`AuthErrorCode` 新增 6 项

- [ ] **Step 1: 直接修改（前端服务层类型/方法变更, 无独立单测框架, 用 Task 7/8 的浏览器验证覆盖）**

```typescript
// BillNote_frontend/src/services/auth.ts
import request from '@/utils/request'

export interface LoginParams {
  account: string
  password: string
}

export interface RegisterParams {
  username: string
  email: string
  password: string
  confirm_password: string
  invite_code?: string
}

export interface UserInfo {
  id: number
  username: string
  email: string
  phone?: string | null
  avatar?: string
  is_admin?: number
}

export interface AuthResult {
  token: string
  user: UserInfo
}

export type TargetType = 'email' | 'phone'
export type CodePurpose = 'login' | 'bind'

export interface SendCodeParams {
  target: string
  target_type: TargetType
  purpose: CodePurpose
}

export interface LoginByCodeParams {
  target: string
  target_type: TargetType
  code: string
}

export interface BindPhoneParams {
  phone: string
  code: string
}

// 认证相关错误码（与后端 StatusCode 保持一致）
export const AuthErrorCode = {
  ACCOUNT_NOT_FOUND: 40401,
  PASSWORD_INCORRECT: 40101,
  ACCOUNT_DISABLED: 40301,
  USERNAME_EXISTS: 40901,
  EMAIL_EXISTS: 40902,
  TARGET_NOT_FOUND: 40402,
  PHONE_EXISTS: 40903,
  CODE_INVALID: 40103,
  CODE_EXPIRED: 40104,
  RATE_LIMITED: 42901,
  SEND_CODE_FAILED: 50001,
} as const

export const authApi = {
  login: (params: LoginParams) =>
    request.post<any, AuthResult>('/auth/login', params, { suppressToast: true }),

  register: (params: RegisterParams) =>
    request.post<any, AuthResult>('/auth/register', params, { suppressToast: true }),

  me: () => request.get<any, UserInfo>('/auth/me'),

  sendCode: (params: SendCodeParams) =>
    request.post<any, { sent: boolean }>('/auth/send-code', params, { suppressToast: true }),

  loginByCode: (params: LoginByCodeParams) =>
    request.post<any, AuthResult>('/auth/login-by-code', params, { suppressToast: true }),

  bindPhone: (params: BindPhoneParams) =>
    request.post<any, { phone: string }>('/auth/bind-phone', params, { suppressToast: true }),
}
```

- [ ] **Step 2: 类型检查确认无破坏**

Run: `cd BillNote_frontend && pnpm exec tsc --noEmit -p tsconfig.app.json 2>&1 | grep -i "services/auth" || echo "no auth.ts errors"`
Expected: `no auth.ts errors`（其他文件在后续任务修改前可能有类型报错，此步骤只关注 `auth.ts` 本身）

- [ ] **Step 3: Commit**

```bash
git add BillNote_frontend/src/services/auth.ts
git commit -m "feat(auth): 前端新增验证码登录/绑定手机号 API 方法与类型"
```

---

### Task 7: 前端 `AuthPage` 改造为两层 Tab

**Files:**
- Modify: `BillNote_frontend/src/pages/AuthPage/index.tsx`

**Interfaces:**
- Consumes: `authApi.login`, `authApi.register`, `authApi.sendCode`, `authApi.loginByCode`, `AuthErrorCode` from Task 6 (`@/services/auth`)
- Produces: 无（叶子组件，被 `App.tsx` 路由引用，接口不变：`<AuthPage />` 无 props）

- [ ] **Step 1: 替换整个文件**

保留原文件的左侧营销面板（`FEATURES`、`AI_TAGS`、左侧 JSX 区块）不变,只重写右侧表单区域和状态逻辑。完整替换 `BillNote_frontend/src/pages/AuthPage/index.tsx`：

```tsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, AuthErrorCode, type TargetType } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'
import BrandLogo from '@/components/BrandLogo'
import toast from 'react-hot-toast'

type TopMode = 'password' | 'code'
type Mode = 'login' | 'register'

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
      </svg>
    ),
    title: '多平台解析',
    desc: '支持哔哩哔哩、YouTube、抖音、快手',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    ),
    title: 'AI 笔记生成',
    desc: '接入主流 LLM 自动生成结构化 Markdown',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
      </svg>
    ),
    title: '思维导图',
    desc: '可视化梳理内容脉络，快速掌握全貌',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    ),
    title: 'AI 问答',
    desc: '基于笔记内容进行智能对话问答',
  },
]

const AI_TAGS = [
  { label: 'OpenAI', color: '#10a37f' },
  { label: 'Claude', color: '#d97757' },
  { label: 'Gemini', color: '#4285f4' },
  { label: 'DeepSeek', color: '#4f46e5' },
  { label: 'Qwen', color: '#f97316' },
]

const RESEND_COOLDOWN = 60

export default function AuthPage() {
  const navigate = useNavigate()
  const setAuth = useUserStore((s) => s.setAuth)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const [mode, setMode] = useState<Mode>('login')
  const [topMode, setTopMode] = useState<TopMode>('password')
  const [codeTargetType, setCodeTargetType] = useState<TargetType>('email')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const inviteFromUrl = (() => {
    try {
      const u = new URL(window.location.href)
      return (u.searchParams.get('invite') || '').trim().toUpperCase() || ''
    } catch {
      return ''
    }
  })()

  const [form, setForm] = useState({
    account: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: inviteFromUrl,
    codeTarget: '',
    code: '',
  })

  useEffect(() => {
    if (inviteFromUrl) setMode('register')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const switchMode = (m: Mode) => {
    setMode(m)
    setForm((prev) => ({ ...prev, password: '', confirmPassword: '' }))
  }

  const startCountdown = () => {
    setCountdown(RESEND_COOLDOWN)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const handleSendCode = async () => {
    const target = form.codeTarget.trim()
    if (!target) return toast.error(codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号')
    if (countdown > 0) return

    try {
      await authApi.sendCode({ target, target_type: codeTargetType, purpose: 'login' })
      toast.success('验证码已发送')
      startCountdown()
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.TARGET_NOT_FOUND) {
        toast.error('该账号未注册，请先注册')
      } else if (code === AuthErrorCode.RATE_LIMITED) {
        toast.error(err?.msg || '发送过于频繁，请稍后再试')
      } else if (code === AuthErrorCode.SEND_CODE_FAILED) {
        toast.error('验证码发送失败，请稍后再试')
      } else {
        toast.error(err?.msg || '发送失败，请稍后再试')
      }
    }
  }

  const submitPasswordLogin = async () => {
    if (!form.account.trim()) return toast.error('请输入用户名/邮箱/手机号')
    if (!form.password) return toast.error('请输入密码')
    setLoading(true)
    try {
      const result = await authApi.login({ account: form.account.trim(), password: form.password })
      setAuth(result.token, result.user)
      rehydrateTaskStore(result.user.id)
      await loadHistory()
      toast.success('登录成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.ACCOUNT_NOT_FOUND) {
        toast.error('账户不存在，请先注册')
        setForm((prev) => ({ ...prev, username: prev.account, password: '', confirmPassword: '' }))
        switchMode('register')
      } else if (code === AuthErrorCode.PASSWORD_INCORRECT) {
        toast.error('密码错误')
        setForm((prev) => ({ ...prev, password: '' }))
      } else {
        toast.error(err?.msg || '登录失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitCodeLogin = async () => {
    const target = form.codeTarget.trim()
    if (!target) return toast.error(codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号')
    if (!form.code.trim()) return toast.error('请输入验证码')
    setLoading(true)
    try {
      const result = await authApi.loginByCode({
        target,
        target_type: codeTargetType,
        code: form.code.trim(),
      })
      setAuth(result.token, result.user)
      rehydrateTaskStore(result.user.id)
      await loadHistory()
      toast.success('登录成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.ACCOUNT_NOT_FOUND) {
        toast.error('账户不存在，请先注册')
      } else if (code === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (code === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else {
        toast.error(err?.msg || '登录失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitRegister = async () => {
    if (!form.username.trim()) return toast.error('请填写用户名')
    if (form.username.trim().length < 3 || form.username.trim().length > 32)
      return toast.error('用户名长度需在 3~32 字符之间')
    if (!form.email.trim()) return toast.error('请填写邮箱')
    if (!form.password) return toast.error('请填写密码')
    if (form.password.length < 6) return toast.error('密码至少 6 位')
    if (!form.confirmPassword) return toast.error('请再次输入密码')
    if (form.password !== form.confirmPassword) return toast.error('两次输入的密码不一致')
    setLoading(true)
    try {
      await authApi.register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        confirm_password: form.confirmPassword,
        invite_code: form.inviteCode.trim() || undefined,
      })
      toast.success('注册成功，请登录')
      setForm((prev) => ({ ...prev, account: prev.username, email: '', password: '', confirmPassword: '' }))
      setMode('login')
      setTopMode('password')
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.USERNAME_EXISTS) {
        toast.error('用户名已存在')
      } else if (code === AuthErrorCode.EMAIL_EXISTS) {
        toast.error('邮箱已被注册')
      } else {
        toast.error(err?.msg || '注册失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    if (mode === 'register') {
      await submitRegister()
      return
    }

    if (topMode === 'password') {
      await submitPasswordLogin()
    } else {
      await submitCodeLogin()
    }
  }

  const showCodeLoginUI = mode === 'login' && topMode === 'code'

  return (
    <div
      className="min-h-[100dvh] flex overflow-hidden"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-[54%] relative flex-col justify-between p-12 overflow-hidden select-none"
        style={{ background: '#0b1e2d' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 68% 52% at 44% 62%, rgba(22,122,110,0.18) 0%, transparent 100%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            opacity: 0.05,
          }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-auto flex-shrink-0" />
            <span className="text-white text-[1.0625rem] font-semibold tracking-tight">
              BiliNote
            </span>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2
              className="font-bold leading-[1.18] mb-4"
              style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', letterSpacing: '-0.02em' }}
            >
              <span className="text-white">让每一个视频</span>
              <br />
              <span
                style={{
                  background: 'linear-gradient(90deg, #1aa396, #4dd9cc)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                变成结构化笔记
              </span>
            </h2>
            <p className="text-sm leading-relaxed max-w-[20rem]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              AI 驱动的视频笔记工具，自动转写、生成 Markdown，并支持思维导图可视化。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl p-3.5 flex flex-col gap-2"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <div style={{ color: '#1aa396' }}>{f.icon}</div>
                <div>
                  <p className="text-[13px] font-medium text-white leading-none mb-1">{f.title}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.38)' }}>
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-[11px] mb-2.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
            兼容主流模型
          </p>
          <div className="flex flex-wrap gap-2">
            {AI_TAGS.map((tag) => (
              <span
                key={tag.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: `${tag.color}18`,
                  border: `1px solid ${tag.color}40`,
                  color: tag.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: tag.color }}
                />
                {tag.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-[22rem]">
          <div className="flex items-center justify-center gap-2.5 mb-7">
            <BrandLogo className="h-7 w-auto flex-shrink-0" />
            <span className="text-xl font-semibold tracking-tight text-gray-900">BiliNote</span>
          </div>

          {/* 顶层 Tab: 登录 / 注册 */}
          <div className="flex rounded-lg p-1 mb-4" style={{ background: '#f4f4f5' }}>
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className="flex-1 py-2 rounded-md text-[13px] font-medium transition-all duration-150"
                style={
                  mode === m
                    ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                    : { color: '#6b7280' }
                }
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          {/* 二层 Tab: 密码登录 / 验证码登录 (仅登录模式显示) */}
          {mode === 'login' && (
            <div className="flex gap-4 mb-6 border-b border-gray-100">
              {(['password', 'code'] as TopMode[]).map((tm) => (
                <button
                  key={tm}
                  type="button"
                  onClick={() => setTopMode(tm)}
                  className="pb-2.5 text-[13px] font-medium transition-colors relative"
                  style={{ color: topMode === tm ? '#167a6e' : '#9ca3af' }}
                >
                  {tm === 'password' ? '密码登录' : '验证码登录'}
                  {topMode === tm && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: '#167a6e' }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 三层切换: 邮箱验证码 / 手机验证码 (仅验证码登录显示) */}
          {showCodeLoginUI && (
            <div className="flex rounded-lg p-1 mb-6" style={{ background: '#f4f4f5' }}>
              {(['email', 'phone'] as TargetType[]).map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => {
                    setCodeTargetType(tt)
                    setForm((prev) => ({ ...prev, codeTarget: '', code: '' }))
                  }}
                  className="flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150"
                  style={
                    codeTargetType === tt
                      ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                      : { color: '#6b7280' }
                  }
                >
                  {tt === 'email' ? '邮箱验证码' : '手机验证码'}
                </button>
              ))}
            </div>
          )}

          <div className="mb-7">
            <h1
              className="font-bold text-gray-900 mb-1"
              style={{ fontSize: '1.375rem', letterSpacing: '-0.016em' }}
            >
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h1>
            <p className="text-[13px] text-gray-400">
              {mode === 'login' ? '登录你的 BiliNote 账号继续使用' : '填写信息，开始使用 BiliNote'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'login' && topMode === 'password' && (
              <div className="space-y-1.5">
                <Label htmlFor="account" className="text-[13px] font-medium text-gray-600">
                  用户名 / 邮箱 / 手机号
                </Label>
                <Input
                  id="account"
                  placeholder="请输入用户名、邮箱或手机号"
                  value={form.account}
                  onChange={set('account')}
                  required
                  autoComplete="username"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  style={{ '--tw-ring-color': 'rgba(22,122,110,0.3)' } as React.CSSProperties}
                />
              </div>
            )}

            {showCodeLoginUI && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="codeTarget" className="text-[13px] font-medium text-gray-600">
                    {codeTargetType === 'email' ? '邮箱' : '手机号'}
                  </Label>
                  <Input
                    id="codeTarget"
                    type={codeTargetType === 'email' ? 'email' : 'tel'}
                    placeholder={codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号'}
                    value={form.codeTarget}
                    onChange={set('codeTarget')}
                    required
                    className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="loginCode" className="text-[13px] font-medium text-gray-600">
                    验证码
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="loginCode"
                      placeholder="请输入验证码"
                      value={form.code}
                      onChange={set('code')}
                      required
                      maxLength={6}
                      className="h-10 flex-1 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={countdown > 0}
                      className="h-10 shrink-0 rounded-lg px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ background: '#f4f4f5', color: countdown > 0 ? '#9ca3af' : '#167a6e' }}
                    >
                      {countdown > 0 ? `${countdown}s` : '获取验证码'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-[13px] font-medium text-gray-600">
                  用户名
                </Label>
                <Input
                  id="username"
                  placeholder="请输入用户名（3~32 字符）"
                  value={form.username}
                  onChange={set('username')}
                  required
                  autoComplete="username"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  style={{ '--tw-ring-color': 'rgba(22,122,110,0.3)' } as React.CSSProperties}
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[13px] font-medium text-gray-600">
                  邮箱
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="请输入邮箱"
                  value={form.email}
                  onChange={set('email')}
                  required
                  autoComplete="email"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {(mode === 'register' || (mode === 'login' && topMode === 'password')) && (
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[13px] font-medium text-gray-600">
                  密码
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                  value={form.password}
                  onChange={set('password')}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-[13px] font-medium text-gray-600">
                  确认密码
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  required
                  autoComplete="new-password"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="inviteCode" className="text-[13px] font-medium text-gray-600">
                  邀请码 <span className="text-xs text-gray-400">(选填, 注册即得 +200 电力)</span>
                </Label>
                <Input
                  id="inviteCode"
                  placeholder="填写好友邀请码"
                  value={form.inviteCode}
                  onChange={(e) => setForm((p) => ({ ...p, inviteCode: e.target.value.toUpperCase() }))}
                  maxLength={16}
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm font-mono tracking-wider focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg text-[13px] font-medium text-white transition-all duration-150 mt-1 active:scale-[0.99] disabled:opacity-55 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? '#167a6e'
                  : 'linear-gradient(135deg, #167a6e 0%, #1aa396 100%)',
              }}
            >
              {loading
                ? mode === 'login'
                  ? '登录中...'
                  : '注册中...'
                : mode === 'login'
                ? '登录'
                : '注册'}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-gray-400">
            {mode === 'login' ? (
              <>
                还没有账号？{' '}
                <button
                  type="button"
                  className="font-medium transition-colors"
                  style={{ color: '#167a6e' }}
                  onClick={() => switchMode('register')}
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？{' '}
                <button
                  type="button"
                  className="font-medium transition-colors"
                  style={{ color: '#167a6e' }}
                  onClick={() => switchMode('login')}
                >
                  去登录
                </button>
              </>
            )}
          </p>
        </div>

        <p className="absolute bottom-6 text-[11px] text-gray-300">
          2025 BiliNote
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `cd BillNote_frontend && pnpm exec tsc --noEmit -p tsconfig.app.json 2>&1 | grep -i "AuthPage" || echo "no AuthPage errors"`
Expected: `no AuthPage errors`

- [ ] **Step 3: Commit**

```bash
git add BillNote_frontend/src/pages/AuthPage/index.tsx
git commit -m "feat(auth): 登录页支持两层 Tab 切换密码/邮箱验证码/手机验证码登录"
```

---

### Task 8: 前端绑定手机号页面 + 路由守卫

**Files:**
- Create: `BillNote_frontend/src/pages/BindPhonePage/index.tsx`
- Modify: `BillNote_frontend/src/App.tsx`

**Interfaces:**
- Consumes: `authApi.sendCode`, `authApi.bindPhone`, `AuthErrorCode` from Task 6 (`@/services/auth`); `useUserStore` from `@/store/userStore`
- Produces: `<BindPhonePage />` 组件（无 props）；`App.tsx` 内新增 `PhoneGuard` 组件包裹受保护路由

- [ ] **Step 1: 创建绑定手机号页面**

```tsx
// BillNote_frontend/src/pages/BindPhonePage/index.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, AuthErrorCode } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import BrandLogo from '@/components/BrandLogo'
import toast from 'react-hot-toast'

const RESEND_COOLDOWN = 60

export default function BindPhonePage() {
  const navigate = useNavigate()
  const { token, user, setAuth } = useUserStore()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // 已绑定或未登录都不应停留在这个页面
    if (!token) {
      navigate('/login', { replace: true })
    } else if (user?.phone) {
      navigate('/', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const startCountdown = () => {
    setCountdown(RESEND_COOLDOWN)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const handleSendCode = async () => {
    const trimmed = phone.trim()
    if (!/^1\d{10}$/.test(trimmed)) return toast.error('请输入正确的手机号')
    if (countdown > 0) return

    try {
      await authApi.sendCode({ target: trimmed, target_type: 'phone', purpose: 'bind' })
      toast.success('验证码已发送')
      startCountdown()
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.PHONE_EXISTS) {
        toast.error('该手机号已被其他账号绑定')
      } else if (code === AuthErrorCode.RATE_LIMITED) {
        toast.error(err?.msg || '发送过于频繁，请稍后再试')
      } else if (code === AuthErrorCode.SEND_CODE_FAILED) {
        toast.error('验证码发送失败，请稍后再试')
      } else {
        toast.error(err?.msg || '发送失败，请稍后再试')
      }
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = phone.trim()
    if (!/^1\d{10}$/.test(trimmed)) return toast.error('请输入正确的手机号')
    if (!code.trim()) return toast.error('请输入验证码')

    setLoading(true)
    try {
      await authApi.bindPhone({ phone: trimmed, code: code.trim() })
      if (token && user) {
        setAuth(token, { ...user, phone: trimmed })
      }
      toast.success('手机号绑定成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const errCode = err?.code
      if (errCode === AuthErrorCode.PHONE_EXISTS) {
        toast.error('该手机号已被其他账号绑定')
      } else if (errCode === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (errCode === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else {
        toast.error(err?.msg || '绑定失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-white px-8">
      <div className="w-full max-w-[22rem]">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <BrandLogo className="h-7 w-auto flex-shrink-0" />
          <span className="text-xl font-semibold tracking-tight text-gray-900">BiliNote</span>
        </div>

        <div className="mb-7 text-center">
          <h1 className="font-bold text-gray-900 mb-1" style={{ fontSize: '1.375rem', letterSpacing: '-0.016em' }}>
            绑定手机号
          </h1>
          <p className="text-[13px] text-gray-400">
            为了账号安全，请绑定手机号后继续使用
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-[13px] font-medium text-gray-600">
              手机号
            </Label>
            <Input
              id="phone"
              type="tel"
              placeholder="请输入手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              maxLength={11}
              className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bindCode" className="text-[13px] font-medium text-gray-600">
              验证码
            </Label>
            <div className="flex gap-2">
              <Input
                id="bindCode"
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={6}
                className="h-10 flex-1 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0}
                className="h-10 shrink-0 rounded-lg px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                style={{ background: '#f4f4f5', color: countdown > 0 ? '#9ca3af' : '#167a6e' }}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg text-[13px] font-medium text-white transition-all duration-150 mt-1 active:scale-[0.99] disabled:opacity-55 disabled:cursor-not-allowed"
            style={{
              background: loading ? '#167a6e' : 'linear-gradient(135deg, #167a6e 0%, #1aa396 100%)',
            }}
          >
            {loading ? '绑定中...' : '确认绑定'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 修改 `App.tsx` — 新增路由 + 路由守卫**

在 `BillNote_frontend/src/App.tsx` 里做以下改动：

1. 新增 lazy import（放在其余 `const XxxPage = lazy(...)` 声明附近）：

```tsx
const BindPhonePage = lazy(() => import('@/pages/BindPhonePage'))
```

2. 修改 `AuthGuard`，改名逻辑不变，新增一个 `PhoneGuard`：

```tsx
function AuthGuard({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useUserStore((s) => s.isLoggedIn())
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

// 手机号未绑定时强制跳转绑定页; 老用户下次登录同样会被拦下来 (每次进入受保护路由都检查)
function PhoneGuard({ children }: { children: React.ReactNode }) {
  const user = useUserStore((s) => s.user)
  if (!user?.phone) return <Navigate to="/bind-phone" replace />
  return <>{children}</>
}
```

3. 在 `Routes` 里新增 `/bind-phone` 独立路由（与 `/login` 同级，不受 `AuthGuard`/`PhoneGuard` 包裹，但页面内部会自己检查是否已登录），并把 `PhoneGuard` 套在 `AuthGuard` 内层：

```tsx
<Routes>
  <Route path="/login" element={<AuthPage />} />
  <Route path="/bind-phone" element={<BindPhonePage />} />
  <Route path="/onboarding" element={<Onboarding />} />
  <Route path="/sn/:token" element={<ShareViewPage />} />
  <Route
    path="/"
    element={
      <AuthGuard>
        <PhoneGuard>
          <OnboardingGuard>
            <UpdateLogBannerSpacer />
            <Index />
          </OnboardingGuard>
        </PhoneGuard>
      </AuthGuard>
    }
  >
    {/* ... 子路由不变 ... */}
  </Route>
</Routes>
```

其余子路由（`tasks`、`profile` 等）与文件里原有内容保持一致，不需要改动。

- [ ] **Step 3: 类型检查**

Run: `cd BillNote_frontend && pnpm exec tsc --noEmit -p tsconfig.app.json 2>&1 | tail -40`
Expected: 无与 `BindPhonePage`、`App.tsx` 相关的类型错误（若有历史遗留错误与本次改动无关，可忽略，但需在总结里说明）

- [ ] **Step 4: 启动前端 dev server 手动验证**

Run: `cd BillNote_frontend && pnpm dev`
Expected: 服务在 `http://localhost:3015` 启动无报错

手动验证步骤（浏览器中执行，之后终止 dev server）：
1. 打开 `/login`，确认两层 Tab（密码登录/验证码登录，验证码登录下再切邮箱/手机）显示正常
2. 用现有测试账号密码登录，确认若该账号 `phone` 为空会被 `PhoneGuard` 拦到 `/bind-phone`
3. 在 `/bind-phone` 输入一个新手机号，点「获取验证码」（本地未配置阿里云会收到 `SEND_CODE_FAILED` toast，属预期，因为没有真实短信通道）
4. 确认整体交互（loading 状态、倒计时按钮禁用、toast 文案）符合设计

- [ ] **Step 5: Commit**

```bash
git add BillNote_frontend/src/pages/BindPhonePage/index.tsx BillNote_frontend/src/App.tsx
git commit -m "feat(auth): 新增绑定手机号页面, 路由守卫强制拦截未绑定用户"
```

---

## 验证清单（全部任务完成后）

- [ ] 后端: `cd backend && /opt/anaconda3/envs/python3.11/bin/python -m pytest tests/ -v` 全部通过
- [ ] 前端: `cd BillNote_frontend && pnpm lint` 无新增报错
- [ ] 前端: `cd BillNote_frontend && pnpm build` 构建成功
- [ ] 手动浏览器验证: 密码登录（用户名/邮箱/手机号三种账号都试一次）、邮箱验证码登录、手机验证码登录（本地无阿里云配置会在发送环节报错，属预期）、注册后强制绑定手机号、老用户登录后被拦截补绑
