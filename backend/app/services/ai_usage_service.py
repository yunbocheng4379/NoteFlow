from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator, Callable, TypedDict

from sqlalchemy import select

from app.db.engine import SessionLocal
from app.db.models.ai_usage import AIModelPricing, AIUsageLog
from app.services.ai_usage_pricing import calculate_cost

logger = logging.getLogger(__name__)


class AIUsageContext(TypedDict, total=False):
    user_id: int | None
    user_snapshot: str | None
    scene: str
    operation: str
    resource_type: str | None
    resource_id: str | None
    trace_id: str
    provider_id: str | None
    provider_name: str
    model_id: int | None
    model_name: str
    key_alias: str | None
    key_fingerprint: str | None
    key_masked: str | None
    attempt_no: int
    parent_log_id: int | None


@dataclass(frozen=True)
class UsageData:
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    token_source: str = "unavailable"


@dataclass(frozen=True)
class SanitizedPayload:
    content: str
    sha256: str


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def extract_usage(response: Any) -> UsageData:
    usage = _get(response, "usage")
    if usage is None:
        return UsageData()

    input_tokens = _get(usage, "prompt_tokens", _get(usage, "input_tokens"))
    output_tokens = _get(usage, "completion_tokens", _get(usage, "output_tokens"))
    total_tokens = _get(usage, "total_tokens")
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = int(input_tokens) + int(output_tokens)

    prompt_details = _get(usage, "prompt_tokens_details")
    completion_details = _get(usage, "completion_tokens_details")
    cached = _get(prompt_details, "cached_tokens") if prompt_details else None
    reasoning = _get(completion_details, "reasoning_tokens") if completion_details else None
    return UsageData(
        input_tokens=int(input_tokens) if input_tokens is not None else None,
        output_tokens=int(output_tokens) if output_tokens is not None else None,
        cached_input_tokens=int(cached) if cached is not None else None,
        reasoning_tokens=int(reasoning) if reasoning is not None else None,
        total_tokens=int(total_tokens) if total_tokens is not None else None,
        token_source="provider",
    )


_SECRET_PATTERNS = (
    re.compile(r"(authorization\s*:\s*bearer\s+)[^\s,]+", re.IGNORECASE),
    re.compile(r"(bearer\s+)[^\s,]+", re.IGNORECASE),
    re.compile(r"(api[_-]?key\s*[:=]\s*)[^\s,]+", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_-]+"),
)


def sanitize_payload(value: Any, max_length: int = 4000) -> SanitizedPayload:
    if value is None:
        raw = ""
    elif isinstance(value, str):
        raw = value
    else:
        raw = json.dumps(value, ensure_ascii=False, default=str)
    safe = raw
    for pattern in _SECRET_PATTERNS:
        safe = pattern.sub(lambda match: (match.group(1) if match.lastindex else "") + "[REDACTED]", safe)
    digest = __import__("hashlib").sha256(safe.encode("utf-8")).hexdigest()
    return SanitizedPayload(content=safe[:max_length], sha256=digest)


def _response_content(response: Any) -> str:
    choices = _get(response, "choices", []) or []
    if not choices:
        return ""
    choice = choices[0]
    message = _get(choice, "message") or _get(choice, "delta")
    content = _get(message, "content", "") if message is not None else ""
    return content if isinstance(content, str) else ""


class AIUsageRecorder:
    """Best-effort persistence wrapper around provider calls."""

    def __init__(self, session_factory: Callable[[], Any] = SessionLocal):
        self.session_factory = session_factory

    def record_sync(
        self,
        context: AIUsageContext,
        request_messages: list[dict],
        call: Callable[[], Any],
    ) -> Any:
        request_id, started_at, row_id = self._start(context, request_messages, "sync")
        started_clock = time.monotonic()
        try:
            response = call()
            self._finish(
                row_id,
                request_id,
                started_at,
                started_clock,
                "success",
                extract_usage(response),
                _response_content(response),
            )
            return response
        except asyncio.CancelledError:
            self._finish(row_id, request_id, started_at, started_clock, "cancelled", UsageData(), "")
            raise
        except TimeoutError as exc:
            self._finish(row_id, request_id, started_at, started_clock, "timeout", UsageData(), "", exc)
            raise
        except BaseException as exc:
            self._finish(row_id, request_id, started_at, started_clock, "failed", UsageData(), "", exc)
            raise

    async def record_stream(
        self,
        context: AIUsageContext,
        request_messages: list[dict],
        stream_call: Callable[[], AsyncIterator[Any]],
    ) -> AsyncIterator[Any]:
        request_id, started_at, row_id = self._start(context, request_messages, "stream")
        started_clock = time.monotonic()
        output: list[str] = []
        usage = UsageData()
        try:
            stream = stream_call()
            if inspect.isawaitable(stream):
                stream = await stream
            async for chunk in stream:
                chunk_usage = extract_usage(chunk)
                if chunk_usage.token_source == "provider":
                    usage = chunk_usage
                output.append(_response_content(chunk))
                yield chunk
            self._finish(row_id, request_id, started_at, started_clock, "success", usage, "".join(output))
        except asyncio.CancelledError:
            self._finish(row_id, request_id, started_at, started_clock, "cancelled", usage, "".join(output))
            raise
        except BaseException as exc:
            self._finish(row_id, request_id, started_at, started_clock, "failed", usage, "".join(output), exc)
            raise

    def record_stream_sync(
        self,
        context: AIUsageContext,
        request_messages: list[dict],
        stream_call: Callable[[], Any],
    ):
        request_id, started_at, row_id = self._start(context, request_messages, "stream")
        started_clock = time.monotonic()
        output: list[str] = []
        usage = UsageData()
        try:
            for chunk in stream_call():
                chunk_usage = extract_usage(chunk)
                if chunk_usage.token_source == "provider":
                    usage = chunk_usage
                output.append(_response_content(chunk))
                yield chunk
            self._finish(row_id, request_id, started_at, started_clock, "success", usage, "".join(output))
        except GeneratorExit:
            self._finish(row_id, request_id, started_at, started_clock, "cancelled", usage, "".join(output))
            raise
        except BaseException as exc:
            self._finish(row_id, request_id, started_at, started_clock, "failed", usage, "".join(output), exc)
            raise

    def _start(
        self,
        context: AIUsageContext,
        request_messages: list[dict],
        request_mode: str,
    ) -> tuple[str, datetime, int | None]:
        request_id = uuid.uuid4().hex
        started_at = datetime.now()
        trace_id = context.get("trace_id") or uuid.uuid4().hex
        prompt = sanitize_payload(request_messages)
        row = AIUsageLog(
            request_id=request_id,
            trace_id=trace_id,
            parent_log_id=context.get("parent_log_id"),
            user_id=context.get("user_id"),
            user_snapshot=context.get("user_snapshot"),
            scene=context.get("scene", "unknown"),
            operation=context.get("operation", "completion"),
            resource_type=context.get("resource_type"),
            resource_id=context.get("resource_id"),
            provider_id=context.get("provider_id"),
            provider_name=context.get("provider_name", ""),
            model_id=context.get("model_id"),
            model_name=context.get("model_name", ""),
            key_alias=context.get("key_alias"),
            key_fingerprint=context.get("key_fingerprint"),
            key_masked=context.get("key_masked"),
            request_mode=request_mode,
            attempt_no=int(context.get("attempt_no", 1)),
            status="started",
            started_at=started_at,
            token_source="unavailable",
            prompt_content=prompt.content,
            prompt_sha256=prompt.sha256,
        )
        try:
            with self.session_factory() as db:
                self._apply_price_snapshot(db, row, context, started_at)
                db.add(row)
                db.commit()
                return request_id, started_at, row.id
        except Exception:
            logger.exception("Unable to create AI usage audit row")
            return request_id, started_at, None

    def _finish(
        self,
        row_id: int | None,
        request_id: str,
        started_at: datetime,
        started_clock: float,
        status: str,
        usage: UsageData,
        response_content: str,
        error: BaseException | None = None,
    ) -> None:
        if row_id is None:
            return
        safe_response = sanitize_payload(response_content)
        try:
            with self.session_factory() as db:
                row = db.get(AIUsageLog, row_id)
                if row is None:
                    return
                row.request_id = request_id
                row.status = status
                row.completed_at = datetime.now()
                row.latency_ms = max(0, int((time.monotonic() - started_clock) * 1000))
                row.input_tokens = usage.input_tokens
                row.output_tokens = usage.output_tokens
                row.cached_input_tokens = usage.cached_input_tokens
                row.reasoning_tokens = usage.reasoning_tokens
                row.total_tokens = usage.total_tokens
                row.token_source = usage.token_source
                row.response_content = safe_response.content
                row.response_sha256 = safe_response.sha256
                if error is not None:
                    row.error_type = error.__class__.__name__
                    row.error_message = sanitize_payload(str(error), max_length=1000).content
                row.estimated_cost = calculate_cost(
                    usage.input_tokens,
                    usage.output_tokens,
                    row.input_price_per_million,
                    row.output_price_per_million,
                )
                db.commit()
        except Exception:
            logger.exception("Unable to finish AI usage audit row %s", row_id)

    @staticmethod
    def _apply_price_snapshot(db: Any, row: AIUsageLog, context: AIUsageContext, at: datetime) -> None:
        provider_id = context.get("provider_id")
        model_name = context.get("model_name", "")
        rows = db.scalars(
            select(AIModelPricing).where(
                AIModelPricing.is_active.is_(True),
                AIModelPricing.effective_from <= at,
                (AIModelPricing.effective_to.is_(None) | (AIModelPricing.effective_to > at)),
            )
        ).all()
        candidates: list[tuple[int, AIModelPricing]] = []
        for pricing in rows:
            exact_model = pricing.model_name == model_name
            default_model = pricing.model_name in ("", "*")
            exact_provider = pricing.provider_id == provider_id if provider_id else pricing.provider_id is None
            no_provider = pricing.provider_id is None
            rank = None
            if exact_provider and exact_model:
                rank = 0
            elif no_provider and exact_model:
                rank = 1
            elif exact_provider and default_model:
                rank = 2
            elif no_provider and default_model:
                rank = 3
            if rank is not None:
                candidates.append((rank, pricing))
        if not candidates:
            return
        candidates.sort(key=lambda item: (item[0], item[1].effective_from), reverse=False)
        pricing = sorted(candidates, key=lambda item: (item[0], -item[1].effective_from.timestamp()))[0][1]
        row.input_price_per_million = pricing.input_price_per_million
        row.output_price_per_million = pricing.output_price_per_million
        row.currency = pricing.currency
