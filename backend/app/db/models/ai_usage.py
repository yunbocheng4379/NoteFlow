from sqlalchemy import BigInteger, Boolean, CHAR, Column, DateTime, Index, Integer, Numeric, String, Text, func

from app.db.engine import Base


class AIUsageLog(Base):
    """One provider request attempt made by any AI-powered feature."""

    __tablename__ = "ai_usage_logs"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    request_id = Column(String(64), nullable=False, unique=True, index=True)
    trace_id = Column(String(64), nullable=False, index=True)
    parent_log_id = Column(BigInteger().with_variant(Integer, "sqlite"), nullable=True, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    user_snapshot = Column(String(160), nullable=True)
    scene = Column(String(48), nullable=False, index=True)
    operation = Column(String(80), nullable=False)
    resource_type = Column(String(48), nullable=True)
    resource_id = Column(String(128), nullable=True)
    provider_id = Column(String(64), nullable=True)
    provider_name = Column(String(120), nullable=False, default="")
    model_id = Column(Integer, nullable=True)
    model_name = Column(String(160), nullable=False, default="")
    key_alias = Column(String(120), nullable=True)
    key_fingerprint = Column(CHAR(64), nullable=True, index=True)
    key_masked = Column(String(32), nullable=True)
    request_mode = Column(String(16), nullable=False, default="sync")
    attempt_no = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="started", index=True)
    error_type = Column(String(80), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, index=True)
    completed_at = Column(DateTime, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    input_tokens = Column(BigInteger, nullable=True)
    output_tokens = Column(BigInteger, nullable=True)
    cached_input_tokens = Column(BigInteger, nullable=True)
    reasoning_tokens = Column(BigInteger, nullable=True)
    total_tokens = Column(BigInteger, nullable=True)
    token_source = Column(String(20), nullable=False, default="unavailable")
    input_price_per_million = Column(Numeric(18, 8), nullable=True)
    output_price_per_million = Column(Numeric(18, 8), nullable=True)
    currency = Column(CHAR(3), nullable=False, default="CNY")
    estimated_cost = Column(Numeric(18, 8), nullable=True)
    prompt_content = Column(Text, nullable=True)
    response_content = Column(Text, nullable=True)
    prompt_sha256 = Column(CHAR(64), nullable=True)
    response_sha256 = Column(CHAR(64), nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_ai_usage_logs_time_status", "started_at", "status"),
        Index("ix_ai_usage_logs_user_time", "user_id", "started_at"),
        Index("ix_ai_usage_logs_scene_time", "scene", "started_at"),
        Index("ix_ai_usage_logs_model_time", "model_name", "started_at"),
        Index("ix_ai_usage_logs_key_time", "key_fingerprint", "started_at"),
    )


class AIModelPricing(Base):
    """Effective-dated model pricing used to snapshot estimated AI costs."""

    __tablename__ = "ai_model_pricing"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    provider_id = Column(String(64), nullable=True, index=True)
    provider_name = Column(String(120), nullable=False, default="")
    model_name = Column(String(160), nullable=False, index=True)
    input_price_per_million = Column(Numeric(18, 8), nullable=False)
    output_price_per_million = Column(Numeric(18, 8), nullable=False)
    currency = Column(CHAR(3), nullable=False, default="CNY")
    effective_from = Column(DateTime, nullable=False, index=True)
    effective_to = Column(DateTime, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    note = Column(String(500), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_ai_model_pricing_match", "provider_id", "model_name", "effective_from"),
    )
