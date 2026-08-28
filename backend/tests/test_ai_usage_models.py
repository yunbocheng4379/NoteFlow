from sqlalchemy import inspect

from app.db.engine import Base, get_engine
from app.db.models.ai_usage import AIModelPricing, AIUsageLog


def test_ai_usage_models_define_expected_tables_and_indexes():
    assert AIUsageLog.__tablename__ == "ai_usage_logs"
    assert AIModelPricing.__tablename__ == "ai_model_pricing"
    assert "request_id" in AIUsageLog.__table__.columns
    assert "input_tokens" in AIUsageLog.__table__.columns
    assert "estimated_cost" in AIUsageLog.__table__.columns
    assert "effective_from" in AIModelPricing.__table__.columns


def test_ai_usage_tables_can_be_created_by_metadata():
    engine = get_engine()
    Base.metadata.create_all(bind=engine, tables=[AIUsageLog.__table__, AIModelPricing.__table__])
    inspector = inspect(engine)
    assert "ai_usage_logs" in inspector.get_table_names()
    assert "ai_model_pricing" in inspector.get_table_names()
