"""models.supports_reasoning 列 + set_model_supports_reasoning 集成测试 - 走真实 DB"""
import app.db.init_db  # noqa: F401
from app.db.model_dao import insert_model, get_model_by_provider_and_name
from app.services.model import ModelService


def test_new_model_defaults_supports_reasoning_false():
    model = insert_model(provider_id="deepseek", model_name="test-reasoning-flag-model")
    assert model["supports_reasoning"] is False


def test_set_model_supports_reasoning_true():
    model = insert_model(provider_id="deepseek", model_name="test-reasoning-flag-model-2")
    ok = ModelService.set_model_supports_reasoning(model["id"], True)
    assert ok is True

    refreshed = get_model_by_provider_and_name("deepseek", "test-reasoning-flag-model-2")
    assert refreshed["supports_reasoning"] is True
