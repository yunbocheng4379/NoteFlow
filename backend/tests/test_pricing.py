"""pricing.py 集成测试 - fixture 内插入需要的费率行, 不依赖 init.sql 的默认 seed"""
import pytest

import app.db.init_db  # noqa: F401
from app.db.credit_pricing_dao import CreditPricingDAO
from app.services.billing import pricing


# 测试用模型: 保证跟真实 seed / 用户配置不冲突, 用 __test_* 前缀
_TEST_MODELS = [
    {"model_name": "__test_gpt-4o", "rate_per_minute": 5, "description": "test-gpt-4o"},
    {"model_name": "__test_deepseek-v3", "rate_per_minute": 1, "description": "test-deepseek"},
]


@pytest.fixture
def db():
    # 在 fixture 执行时读取当前 SessionLocal，避免被其他测试模块在收集阶段
    # 临时切换数据库环境后遗留的旧引擎污染。
    from app.db.engine import SessionLocal

    s = SessionLocal()
    dao = CreditPricingDAO(s)
    # 插入测试用模型 (若已有则跳过, 确保幂等)
    for m in _TEST_MODELS:
        if not dao.get_by_model_name(m["model_name"]):
            dao.create(**m)
    try:
        yield s
    finally:
        # 清理: 只删测试插入的行, 不动 __default__ / 真实模型
        for m in _TEST_MODELS:
            dao.delete(m["model_name"])
        s.close()


def test_gpt_4o_rate_is_5_per_min(db):
    assert pricing.get_model_rate(db, "__test_gpt-4o") == 5


def test_unknown_model_uses_default_3(db):
    assert pricing.get_model_rate(db, "some-random-model-xyz") == 3


def test_calc_150_credits_for_30min_gpt4o(db):
    """30 分钟 * gpt-4o (5/min) = 150"""
    assert pricing.calculate_required_credits(db, "__test_gpt-4o", 30 * 60) == 150


def test_calc_deepseek_1_5min_ceil_2min(db):
    """deepseek-v3 (1/min), 1.5 分钟向上取整到 2 分钟 = 2 电力"""
    assert pricing.calculate_required_credits(db, "__test_deepseek-v3", 90) == 2


def test_calc_zero_duration_min_1_credit(db):
    """0 秒或负数 duration 按 1 分钟 * rate, 但不少于 1 电力"""
    assert pricing.calculate_required_credits(db, "__test_deepseek-v3", 0) == 1
    assert pricing.calculate_required_credits(db, "__test_gpt-4o", 0) == 5  # 1min * 5


def test_calc_none_model_uses_default(db):
    """None model_name 走 __default__ (rate=3)"""
    assert pricing.calculate_required_credits(db, None, 120) == 6  # 2min * 3


# ============================================================================
# 格式费率叠加 (credit_format_pricing seed: toc=1, link=1, screenshot=3, summary=1)
# ============================================================================

def test_format_rate_map_empty_returns_empty(db):
    """空/None formats 参数不查表, 返回空 dict (不叠加任何格式费)"""
    assert pricing.get_format_rate_map(db, None) == {}
    assert pricing.get_format_rate_map(db, []) == {}


def test_format_rate_map_screenshot(db):
    """screenshot seed=3"""
    m = pricing.get_format_rate_map(db, ["screenshot"])
    assert m == {"screenshot": 3}


def test_calc_with_screenshot_format(db):
    """30 分钟 * (gpt-4o 5/min + screenshot 3/min) = 30*8 = 240"""
    assert pricing.calculate_required_credits(db, "__test_gpt-4o", 30 * 60, ["screenshot"]) == 240


def test_calc_with_multiple_formats(db):
    """2 分钟 * (deepseek-v3 1/min + toc 1 + link 1 + summary 1) = 2*4 = 8"""
    fmts = ["toc", "link", "summary"]
    assert pricing.calculate_required_credits(db, "__test_deepseek-v3", 120, fmts) == 8


def test_calc_with_unknown_format_ignored(db):
    """未知格式 (未在表中或 is_active=0) 按 0 处理, 不影响总费"""
    # 只 toc(1) + gpt-4o(5) = 6/min, 1 分钟 = 6
    assert pricing.calculate_required_credits(db, "__test_gpt-4o", 30, ["toc", "nonexistent"]) == 6


def test_calc_empty_format_equals_no_format(db):
    """空 format 列表 == 不传 format, 仍按模型费率算"""
    a = pricing.calculate_required_credits(db, "__test_gpt-4o", 60, [])
    b = pricing.calculate_required_credits(db, "__test_gpt-4o", 60)
    assert a == b == 5


# ============================================================================
# sync_add_model_rate / sync_remove_model_rate_if_orphan
# ============================================================================

def test_sync_add_creates_row_with_default_rate(db):
    """新增模型后自动建对应费率行, 单价 = DEFAULT_MODEL_INITIAL_RATE (3).
    注: sync_add_model_rate 走自己的 session, MySQL REPEATABLE READ 下外层 session
    需要 expire 才能看到新提交, 因此测试里显式 expire_all."""
    from app.db.credit_pricing_dao import (
        CreditPricingDAO,
        DEFAULT_MODEL_INITIAL_RATE,
        sync_add_model_rate,
    )
    name = "pytest_sync_new_model"
    dao = CreditPricingDAO(db)
    dao.delete(name)
    sync_add_model_rate(name)
    # MySQL 默认 REPEATABLE READ 下, expire_all 只会刷新对象, 不会结束
    # 外层会话已经建立的事务快照; 先 rollback 才能看到独立会话的新提交。
    db.rollback()
    db.expire_all()
    row = dao.get_by_model_name(name)
    assert row is not None
    assert row.rate_per_minute == DEFAULT_MODEL_INITIAL_RATE
    assert row.is_default == 0
    dao.delete(name)


def test_sync_add_is_idempotent_and_preserves_existing_rate(db):
    """再次调用不会覆盖管理员已改过的单价"""
    from app.db.credit_pricing_dao import CreditPricingDAO, sync_add_model_rate
    name = "pytest_sync_existing_model"
    dao = CreditPricingDAO(db)
    dao.delete(name)
    dao.create(model_name=name, rate_per_minute=99)
    sync_add_model_rate(name)
    db.rollback()
    db.expire_all()
    row = dao.get_by_model_name(name)
    assert row.rate_per_minute == 99  # 未被覆盖
    dao.delete(name)


def test_sync_skips_dunder_names(db):
    """__default__ / __test_* 等下划线开头的名字不参与镜像同步"""
    from app.db.credit_pricing_dao import CreditPricingDAO, sync_add_model_rate
    name = "__pytest_dunder_skipped"
    dao = CreditPricingDAO(db)
    dao.delete(name)
    sync_add_model_rate(name)
    db.rollback()
    db.expire_all()
    assert dao.get_by_model_name(name) is None
