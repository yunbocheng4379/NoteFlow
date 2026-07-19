"""pricing.py 集成测试 - 走真实 DB 上的 seed 数据"""
import pytest

import app.db.init_db  # noqa: F401
from app.db.engine import SessionLocal
from app.services.billing import pricing


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def test_gpt_4o_rate_is_5_per_min(db):
    assert pricing.get_model_rate(db, "gpt-4o") == 5


def test_unknown_model_uses_default_3(db):
    assert pricing.get_model_rate(db, "some-random-model-xyz") == 3


def test_calc_150_credits_for_30min_gpt4o(db):
    """30 分钟 * gpt-4o (5/min) = 150"""
    assert pricing.calculate_required_credits(db, "gpt-4o", 30 * 60) == 150


def test_calc_deepseek_1_5min_ceil_2min(db):
    """deepseek-v3 (1/min), 1.5 分钟向上取整到 2 分钟 = 2 电力"""
    assert pricing.calculate_required_credits(db, "deepseek-v3", 90) == 2


def test_calc_zero_duration_min_1_credit(db):
    """0 秒或负数 duration 按 1 分钟 * rate, 但不少于 1 电力"""
    assert pricing.calculate_required_credits(db, "deepseek-v3", 0) == 1
    assert pricing.calculate_required_credits(db, "gpt-4o", 0) == 5  # 1min * 5


def test_calc_none_model_uses_default(db):
    """None model_name 走 __default__ (rate=3)"""
    assert pricing.calculate_required_credits(db, None, 120) == 6  # 2min * 3
