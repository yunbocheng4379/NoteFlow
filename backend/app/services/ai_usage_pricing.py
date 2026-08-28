from __future__ import annotations

import hashlib
from decimal import Decimal


def calculate_cost(
    input_tokens: int | None,
    output_tokens: int | None,
    input_price_per_million: Decimal | None,
    output_price_per_million: Decimal | None,
) -> Decimal | None:
    if input_price_per_million is None or output_price_per_million is None:
        return None
    input_count = Decimal(input_tokens or 0)
    output_count = Decimal(output_tokens or 0)
    return (input_count * input_price_per_million + output_count * output_price_per_million) / Decimal(1_000_000)


def fingerprint_secret(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "****"
    return f"{value[:3]}...{value[-4:]}"
