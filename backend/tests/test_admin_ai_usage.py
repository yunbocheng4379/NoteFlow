import csv
import io
import uuid
from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient

import app.db.init_db  # noqa: F401
from app.auth.jwt_handler import create_access_token
from app.db.engine import SessionLocal
from app.db.models.ai_usage import AIUsageLog
from app.db.models.users import User
from main import app as fastapi_app


client = TestClient(fastapi_app)


def _make_user(is_admin: int) -> tuple[User, str]:
    db = SessionLocal()
    username = f"ai-usage-{uuid.uuid4().hex[:10]}"
    user = User(username=username, email=f"{username}@example.com", hashed_password="x", is_admin=is_admin)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.username)
    db.close()
    return user, token


def test_ai_usage_overview_requires_admin():
    user, token = _make_user(0)
    try:
        response = client.get("/api/admin/ai-usage/overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403
    finally:
        db = SessionLocal()
        db.query(User).filter(User.id == user.id).delete()
        db.commit()
        db.close()


def test_admin_ai_usage_overview_and_logs_return_usage_data():
    user, token = _make_user(1)
    trace_id = f"test-{uuid.uuid4().hex}"
    db = SessionLocal()
    db.add(AIUsageLog(
        request_id=uuid.uuid4().hex,
        trace_id=trace_id,
        user_id=user.id,
        scene="workbench_chat",
        operation="ask",
        provider_name="OpenAI",
        model_name="gpt-4o",
        key_alias="primary",
        key_fingerprint="a" * 64,
        key_masked="sk-...1234",
        status="success",
        request_mode="sync",
        attempt_no=1,
        started_at=datetime.now(),
        input_tokens=100,
        output_tokens=20,
        total_tokens=120,
        token_source="provider",
        estimated_cost=Decimal("0.12"),
        prompt_content="safe prompt",
        response_content="safe answer",
    ))
    db.commit()
    db.close()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        overview = client.get("/api/admin/ai-usage/overview", headers=headers)
        assert overview.status_code == 200
        assert overview.json()["data"]["total_tokens"] >= 120

        logs = client.get("/api/admin/ai-usage/logs", headers=headers)
        assert logs.status_code == 200
        assert logs.json()["data"]["items"][0]["key_masked"] == "sk-...1234"
    finally:
        db = SessionLocal()
        db.query(AIUsageLog).filter(AIUsageLog.trace_id == trace_id).delete()
        db.query(User).filter(User.id == user.id).delete()
        db.commit()
        db.close()


def test_admin_ai_usage_export_is_csv_and_contains_no_full_key():
    user, token = _make_user(1)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = client.get("/api/admin/ai-usage/export", headers=headers)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "api_key" not in response.text.lower()
        list(csv.reader(io.StringIO(response.text)))
    finally:
        db = SessionLocal()
        db.query(User).filter(User.id == user.id).delete()
        db.commit()
        db.close()
