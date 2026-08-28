from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.engine import Base
from app.db.models.ai_usage import AIModelPricing, AIUsageLog
from app.services.ai_usage_service import (
    AIUsageRecorder,
    extract_usage,
    sanitize_payload,
)


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine, tables=[AIUsageLog.__table__, AIModelPricing.__table__])
    return sessionmaker(bind=engine)


def context(**overrides):
    value = {
        "user_id": 42,
        "scene": "workbench_chat",
        "operation": "ask",
        "provider_id": "openai",
        "provider_name": "OpenAI",
        "model_name": "gpt-4o",
        "key_alias": "primary",
        "key_fingerprint": "f" * 64,
        "key_masked": "sk-...1234",
        "trace_id": "trace-test",
    }
    value.update(overrides)
    return value


def response_with_usage():
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=4, total_tokens=14)
    message = SimpleNamespace(content="answer")
    return SimpleNamespace(usage=usage, choices=[SimpleNamespace(message=message)])


def test_sync_success_persists_provider_usage_and_cost(session_factory):
    with session_factory() as db:
        db.add(
            AIModelPricing(
                provider_id="openai",
                provider_name="OpenAI",
                model_name="gpt-4o",
                input_price_per_million=Decimal("2"),
                output_price_per_million=Decimal("4"),
                currency="CNY",
                effective_from=datetime(2026, 1, 1),
            )
        )
        db.commit()

    result = AIUsageRecorder(session_factory).record_sync(
        context(), [{"role": "user", "content": "hello"}], response_with_usage
    )

    assert result.choices[0].message.content == "answer"
    with session_factory() as db:
        row = db.scalar(select(AIUsageLog))
        assert row.status == "success"
        assert row.input_tokens == 10
        assert row.output_tokens == 4
        assert row.total_tokens == 14
        assert row.token_source == "provider"
        assert row.estimated_cost == Decimal("0.00003600")


def test_sync_failure_persists_failed_status_without_hiding_original_error(session_factory):
    def fail():
        raise RuntimeError("provider down")

    with pytest.raises(RuntimeError, match="provider down"):
        AIUsageRecorder(session_factory).record_sync(context(), [], fail)

    with session_factory() as db:
        row = db.scalar(select(AIUsageLog))
        assert row.status == "failed"
        assert row.error_message == "provider down"


@pytest.mark.asyncio
async def test_stream_completion_persists_joined_output_after_chunks(session_factory):
    usage = SimpleNamespace(prompt_tokens=2, completion_tokens=3, total_tokens=5)

    async def stream_call():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="a"))])
        yield SimpleNamespace(
            usage=usage,
            choices=[SimpleNamespace(delta=SimpleNamespace(content="b"))],
        )

    chunks = [
        chunk async for chunk in AIUsageRecorder(session_factory).record_stream(
            context(), [], stream_call
        )
    ]

    assert len(chunks) == 2
    with session_factory() as db:
        row = db.scalar(select(AIUsageLog))
        assert row.status == "success"
        assert row.response_content == "ab"
        assert row.total_tokens == 5


def test_missing_usage_is_marked_unavailable():
    usage = extract_usage(SimpleNamespace(usage=None))
    assert usage.token_source == "unavailable"
    assert usage.total_tokens is None


def test_payload_redaction_removes_api_keys_and_truncates_content():
    safe = sanitize_payload("Authorization: Bearer secret-value\n" + "x" * 5000, max_length=80)
    assert "secret-value" not in safe.content
    assert len(safe.content) <= 80
    assert len(safe.sha256) == 64
