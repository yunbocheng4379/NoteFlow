from app.services.ai_usage_service import AIUsageRecorder


def test_disabled_audit_does_not_open_audit_database(monkeypatch):
    monkeypatch.setenv("AI_USAGE_AUDIT_ENABLED", "false")
    opened = 0

    def session_factory():
        nonlocal opened
        opened += 1
        raise AssertionError("disabled audit must not open the audit database")

    result = AIUsageRecorder(session_factory).record_sync(
        {"scene": "test", "operation": "test", "model_name": "test-model"},
        [{"role": "user", "content": "test"}],
        lambda: "provider-result",
    )

    assert result == "provider-result"
    assert opened == 0
