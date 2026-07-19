"""verification_code.py 单测 — 直连本地 Redis, 每个测试用独立 target 避免互相污染."""
import time
import pytest

from app.db.redis_client import get_redis
from app.services.verification_code import (
    generate_and_store,
    verify_and_consume,
    RateLimitedError,
    CodeExpiredError,
    CodeInvalidError,
)


@pytest.fixture(autouse=True)
def cleanup_redis():
    r = get_redis()
    yield
    for pattern in ("verify_code:*test_target*", "verify_code_cooldown:*test_target*", "verify_code_daily:*test_target*"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


def test_generate_and_store_returns_six_digit_code():
    code = generate_and_store("test_target_1@example.com", "login")
    assert len(code) == 6
    assert code.isdigit()


def test_verify_and_consume_success():
    target = "test_target_2@example.com"
    code = generate_and_store(target, "login")
    assert verify_and_consume(target, "login", code) is True
    # 一次性消费: 再校验同一个码应该报过期(已删除)
    with pytest.raises(CodeExpiredError):
        verify_and_consume(target, "login", code)


def test_verify_and_consume_wrong_code_raises_invalid():
    target = "test_target_3@example.com"
    generate_and_store(target, "login")
    with pytest.raises(CodeInvalidError):
        verify_and_consume(target, "login", "000000")


def test_verify_and_consume_no_code_raises_expired():
    with pytest.raises(CodeExpiredError):
        verify_and_consume("test_target_never_sent@example.com", "login", "123456")


def test_purpose_isolation():
    """同一 target 不同 purpose 的码互不影响"""
    target = "test_target_4@example.com"
    login_code = generate_and_store(target, "login")
    bind_code = generate_and_store(target, "bind")
    assert verify_and_consume(target, "login", login_code) is True
    assert verify_and_consume(target, "bind", bind_code) is True


def test_cooldown_blocks_second_send_within_60s():
    target = "test_target_5@example.com"
    generate_and_store(target, "login")
    with pytest.raises(RateLimitedError):
        generate_and_store(target, "login")


def test_daily_limit_blocks_after_ten_sends():
    target = "test_target_6@example.com"
    r = get_redis()
    # 直接把冷却 key 清掉, 只测每日上限
    for i in range(10):
        r.delete(f"verify_code_cooldown:{target}")
        generate_and_store(target, "login")
    r.delete(f"verify_code_cooldown:{target}")
    with pytest.raises(RateLimitedError):
        generate_and_store(target, "login")
