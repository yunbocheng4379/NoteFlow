from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.credit_pricing_dao import CreditPricingDAO
from app.db.engine import Base
from app.db.models.credit_pricing import CreditPricing
from app.db.models.models import Model


def test_model_rates_only_list_registered_models_and_default_rate():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[Model.__table__, CreditPricing.__table__])

    with Session(engine) as db:
        db.add(Model(provider_id="deepseek", model_name="deepseek-v4-pro", tier="pro"))
        db.add_all([
            CreditPricing(model_name="__default__", rate_per_minute=3, is_default=1, is_active=1),
            CreditPricing(model_name="deepseek-v4-pro", rate_per_minute=4, is_active=1),
            CreditPricing(model_name="pytest_sync_debug", rate_per_minute=3, is_active=1),
        ])
        db.commit()

        names = [row.model_name for row in CreditPricingDAO(db).get_all()]

        assert names == ["__default__", "deepseek-v4-pro"]
        assert db.scalar(select(CreditPricing).where(CreditPricing.model_name == "pytest_sync_debug")) is not None
        assert CreditPricingDAO(db).prune_orphan_model_rates() == 1
        assert db.scalar(select(CreditPricing).where(CreditPricing.model_name == "pytest_sync_debug")) is None
