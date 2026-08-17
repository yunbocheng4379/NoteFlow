"""微信小程序登录服务的隔离测试。"""

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.db.init_db  # noqa: F401
from app.db.engine import Base
from app.db.models.users import User
from main import app as fastapi_app


client = TestClient(fastapi_app)
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="module", autouse=True)
def create_test_tables():
    Base.metadata.create_all(bind=test_engine)
    yield


@pytest.fixture
def db():
    session = TestSession()
    created_ids = []
    try:
        yield session, created_ids
    finally:
        if created_ids:
            session.query(User).filter(User.id.in_(created_ids)).delete(synchronize_session=False)
            session.commit()
        session.close()


def _new_username(prefix: str) -> str:
    return f"{prefix}_{datetime.now().strftime('%H%M%S%f')}"


class FakeRedis:
    def __init__(self):
        self.values = {}

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    def get(self, key):
        return self.values.get(key)

    def delete(self, key):
        return int(self.values.pop(key, None) is not None)

    def getdel(self, key):
        return self.values.pop(key, None)


@pytest.fixture
def bridge(monkeypatch):
    from app.routers import auth as auth_router

    store = FakeRedis()
    monkeypatch.setattr(auth_router, "get_redis", lambda: store)

    async def fake_qr_bytes(state):
        assert state
        return b"fake-png"

    monkeypatch.setattr(auth_router, "_wechat_mini_qr_bytes", fake_qr_bytes, raising=False)
    return store


def test_find_or_create_matches_existing_openid(db):
    from app.services.wechat_miniprogram import find_or_create_wechat_user

    session, created_ids = db
    user = User(username=_new_username("mini_openid"), wechat_openid="openid-existing")
    session.add(user)
    session.commit()
    session.refresh(user)
    created_ids.append(user.id)

    matched, is_new = find_or_create_wechat_user(session, "openid-existing", None)

    assert matched.id == user.id
    assert is_new is False


def test_find_or_create_matches_unionid_and_fills_openid(db):
    from app.services.wechat_miniprogram import find_or_create_wechat_user

    session, created_ids = db
    user = User(username=_new_username("mini_unionid"), wechat_unionid="union-existing")
    session.add(user)
    session.commit()
    session.refresh(user)
    created_ids.append(user.id)

    matched, is_new = find_or_create_wechat_user(session, "openid-from-mini", "union-existing")

    assert matched.id == user.id
    assert matched.wechat_openid == "openid-from-mini"
    assert is_new is False


def test_find_or_create_creates_new_user_and_runs_registration_hooks(db, monkeypatch):
    from app.services import billing
    from app.services.wechat_miniprogram import find_or_create_wechat_user

    session, created_ids = db
    monkeypatch.setattr(billing.referral_service, "generate_referral_code", lambda db, user_id: None)
    monkeypatch.setattr(billing.credit_ledger, "grant", lambda *args, **kwargs: None)

    user, is_new = find_or_create_wechat_user(session, "openid-new", None)
    created_ids.append(user.id)

    assert is_new is True
    assert user.wechat_openid == "openid-new"
    assert user.username.startswith("wx_openid-new")


@pytest.mark.asyncio
async def test_wechat_code_to_session_raises_on_wechat_error(monkeypatch):
    import httpx
    from app.services.wechat_miniprogram import WechatMiniProgramError, wechat_code_to_session

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"errcode": 40029, "errmsg": "code been used"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    monkeypatch.setenv("WECHAT_MP_APPID", "wx-test-appid")
    monkeypatch.setenv("WECHAT_MP_SECRET", "test-secret")

    with pytest.raises(WechatMiniProgramError, match="code been used"):
        await wechat_code_to_session("temporary-code")


def test_pc_qr_creates_pending_state(bridge):
    response = client.get("/api/auth/wechat/mini/qr")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert len(payload["state"]) == 32
    assert payload["qr_image"].startswith("data:image/png;base64,")
    assert bridge.get(f"wechat:mini:pc:state:{payload['state']}") == "pending"


def test_pc_bridge_transitions_and_exchange_is_one_time(bridge, monkeypatch):
    from app.routers import auth as auth_router

    fake_user = SimpleNamespace(
        id=100001,
        username="bridge-user",
        email=None,
        phone=None,
        avatar=None,
        is_admin=0,
        is_active=1,
    )

    async def fake_login(db, code):
        assert code == "temporary-code"
        return fake_user, False, "bridge-jwt"

    monkeypatch.setattr(auth_router, "login_with_wechat_code", fake_login, raising=False)
    qr_payload = client.get("/api/auth/wechat/mini/qr").json()["data"]
    state = qr_payload["state"]

    pending = client.get(f"/api/auth/wechat/mini/status?state={state}")
    assert pending.json()["data"] == {"status": "pending"}

    complete = client.post(
        "/api/auth/wechat/mini/complete",
        json={"state": state, "code": "temporary-code"},
    )
    assert complete.json()["data"] == {"completed": True}

    ready = client.get(f"/api/auth/wechat/mini/status?state={state}")
    assert ready.json()["data"] == {"status": "ready"}

    exchange = client.post("/api/auth/wechat/mini/exchange", json={"state": state})
    assert exchange.json()["data"]["token"] == "bridge-jwt"
    assert exchange.json()["data"]["user"]["id"] == fake_user.id

    second = client.post("/api/auth/wechat/mini/exchange", json={"state": state})
    assert second.json()["code"] != 0


def test_pc_bridge_rejects_consumed_state(bridge):
    qr_payload = client.get("/api/auth/wechat/mini/qr").json()["data"]
    state = qr_payload["state"]
    bridge.delete(f"wechat:mini:pc:state:{state}")

    response = client.post(
        "/api/auth/wechat/mini/complete",
        json={"state": state, "code": "temporary-code"},
    )

    assert response.json()["code"] != 0
