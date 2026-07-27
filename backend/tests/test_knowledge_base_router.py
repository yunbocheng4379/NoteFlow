"""knowledge_base 路由集成测试 - 使用真实 DB + TestClient，覆盖会话 CRUD 与 Pro 校验"""
import uuid

import app.db.init_db  # noqa: F401
from fastapi.testclient import TestClient

from main import app as fastapi_app
from app.auth.jwt_handler import create_access_token
from app.db.engine import SessionLocal
from app.db.models.users import User

client = TestClient(fastapi_app)


def _make_user() -> tuple[User, str]:
    """创建一个免费用户（active_subscription_id=None），足以覆盖会话 CRUD 与 Pro 拒绝路径。"""
    db = SessionLocal()
    try:
        username = f"kb-test-{uuid.uuid4().hex[:8]}"
        user = User(
            username=username,
            email=f"{username}@example.com",
            hashed_password="x",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id, user.username)
        return user, token
    finally:
        db.close()


def _cleanup_user(user_id: int):
    db = SessionLocal()
    try:
        db.query(User).filter_by(id=user_id).delete()
        db.commit()
    finally:
        db.close()


def test_conversation_crud_flow():
    user, token = _make_user()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        created = client.post("/api/kb/conversations", headers=headers).json()
        assert created["code"] == 0
        conv_id = created["data"]["id"]

        listed = client.get("/api/kb/conversations", headers=headers).json()
        assert any(c["id"] == conv_id for c in listed["data"])

        messages = client.get(f"/api/kb/conversations/{conv_id}/messages", headers=headers).json()
        assert messages["data"] == []

        deleted = client.delete(f"/api/kb/conversations/{conv_id}", headers=headers).json()
        assert deleted["code"] == 0
    finally:
        _cleanup_user(user.id)


def test_ask_stream_rejects_free_user():
    user, token = _make_user()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        created = client.post("/api/kb/conversations", headers=headers).json()
        conv_id = created["data"]["id"]

        resp = client.post(
            "/api/kb/ask_stream",
            headers=headers,
            json={
                "conversation_id": conv_id,
                "question": "test",
                "provider_id": "deepseek",
                "model_name": "deepseek-chat",
                "enable_thinking": False,
            },
        )
        assert resp.json()["code"] == 40601
    finally:
        _cleanup_user(user.id)
