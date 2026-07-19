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
    # purpose=bind 现在要求登录态, 先登录拿 token 再发起, 验证的仍是"手机号已被占用"这一业务逻辑
    login_resp = client.post("/api/auth/login", json={"account": test_user.username, "password": "plain-pass-123"})
    token = login_resp.json()["data"]["token"]

    resp = client.post(
        "/api/auth/send-code",
        json={
            "target": test_user.phone,
            "target_type": "phone",
            "purpose": "bind",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["code"] == 40903  # PHONE_EXISTS


def test_send_code_bind_phone_requires_login():
    # 未登录调用 send-code(purpose=bind) 应该被 401 拦截, 不应该走到手机号占用检查那一步
    resp = client.post("/api/auth/send-code", json={
        "target": "13800001234",
        "target_type": "phone",
        "purpose": "bind",
    })
    assert resp.status_code == 401


def test_send_code_login_success_when_target_exists(test_user):
    resp = client.post("/api/auth/send-code", json={
        "target": test_user.email,
        "target_type": "email",
        "purpose": "login",
    })
    body = resp.json()
    # SMTP 未配置时发送会失败, 但接口不应 500, 应返回 SEND_CODE_FAILED 或 success
    assert body["code"] in (0, 50001)


def test_send_code_login_account_disabled(test_user, db):
    test_user.is_active = 0
    db.commit()

    resp = client.post("/api/auth/send-code", json={
        "target": test_user.email,
        "target_type": "email",
        "purpose": "login",
    })
    body = resp.json()
    assert body["code"] == 40301  # ACCOUNT_DISABLED


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

    # 关键: fixture session 默认 REPEATABLE READ 会缓存快照, 必须 commit 后再 refresh
    # (与 test_credit_ledger.py 里同样的写法/注释一致)
    db.commit()
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


def test_bind_phone_blocked_by_concurrent_lock(test_user):
    # 模拟"另一个并发请求正在绑定同一手机号": 提前占住 bind_phone_lock,
    # 验证第二个请求会被锁直接拦截(不进入查重/验证码消费逻辑), 证明锁机制真的在拦截并发绑定。
    r = get_redis()
    new_phone = f"137{datetime.now().strftime('%H%M%S%f')[:8]}"
    lock_key = f"bind_phone_lock:{new_phone}"
    assert r.set(lock_key, "held-by-another-request", nx=True, ex=5)

    code = _put_code(new_phone, "bind")
    login_resp = client.post("/api/auth/login", json={"account": test_user.username, "password": "plain-pass-123"})
    token = login_resp.json()["data"]["token"]

    resp = client.post(
        "/api/auth/bind-phone",
        json={"phone": new_phone, "code": code},
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["code"] == 40903  # PHONE_EXISTS (锁拦截场景复用同一错误码)
    assert "正在被绑定" in body["msg"]

    # 被锁拦截应该在查重/验证码消费之前就返回, 验证码不会被消费掉
    from app.services.verification_code import _code_key
    assert r.get(_code_key("bind", new_phone)) == code

    r.delete(lock_key)


def test_bind_phone_concurrent_race(db):
    # 真实并发场景: 两个不同用户同时抢绑同一个手机号, 验证锁真正序列化了两次写入
    # (而不是只在"锁已被占"的单线程模拟下才生效), 且只有一个能成功, 另一个拿到 PHONE_EXISTS。
    import threading

    suffix = datetime.now().strftime("%H%M%S%f")
    users = []
    for i in range(2):
        u = User(
            username=f"codelogin_race{i}_{suffix}",
            email=f"codelogin_race{i}_{suffix}@test.local",
            hashed_password=hash_password("plain-pass-123"),
            credits=0,
            total_points=0,
        )
        db.add(u)
        users.append(u)
    db.commit()
    for u in users:
        db.refresh(u)

    new_phone = f"136{suffix[:8]}"
    for u in users:
        _put_code(new_phone, "bind")

    tokens = []
    for u in users:
        login_resp = client.post("/api/auth/login", json={"account": u.username, "password": "plain-pass-123"})
        tokens.append(login_resp.json()["data"]["token"])

    results = [None, None]

    def _bind(i):
        results[i] = client.post(
            "/api/auth/bind-phone",
            json={"phone": new_phone, "code": "123456"},
            headers={"Authorization": f"Bearer {tokens[i]}"},
        )

    threads = [threading.Thread(target=_bind, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    codes = sorted(r.json()["code"] for r in results)
    assert codes == [0, 40903]  # 恰好一个成功, 一个被 PHONE_EXISTS 拦截

    # 锁在 finally 里释放, 竞态结束后不应再持有
    r_client = get_redis()
    assert r_client.get(f"bind_phone_lock:{new_phone}") is None

    db.execute(User.__table__.delete().where(User.id.in_([u.id for u in users])))
    db.commit()


# ---------- 密码登录支持手机号 ----------

def test_password_login_by_phone(test_user):
    resp = client.post("/api/auth/login", json={"account": test_user.phone, "password": "plain-pass-123"})
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["user"]["id"] == test_user.id
