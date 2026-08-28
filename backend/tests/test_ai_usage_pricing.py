from decimal import Decimal

from app.services.ai_usage_pricing import (
    calculate_cost,
    fingerprint_secret,
    mask_secret,
)


def test_calculate_cost_uses_input_and_output_prices():
    assert calculate_cost(
        1_000_000,
        500_000,
        Decimal("2"),
        Decimal("4"),
    ) == Decimal("4")


def test_mask_secret_never_returns_full_key():
    masked = mask_secret("sk-test-secret-8F2A")
    assert masked.endswith("8F2A")
    assert masked != "sk-test-secret-8F2A"
    assert "test-secret" not in masked


def test_fingerprint_is_stable_sha256():
    assert fingerprint_secret("key") == fingerprint_secret("key")
    assert len(fingerprint_secret("key")) == 64
