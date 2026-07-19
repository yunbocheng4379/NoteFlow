"""
验证码 (登录/绑定手机号) 核心模块
=====================================
统一走 Redis 存储 + TTL 过期. 一次性消费: 校验成功立即删除 key, 防重放.

Key 设计:
  verify_code:{purpose}:{target}          -> 6 位数字码, TTL 300s
  verify_code_cooldown:{target}           -> 当前 purpose 字符串, TTL 60s
                                              (Lua script 原子比较并设置: 与已存 purpose
                                              相同则拒绝, 不同则覆盖写入并放行; 实际语义为
                                              同一 target 对同一 purpose 60s 内限 1 次,
                                              不同 purpose 互不影响)
  verify_code_daily:{target}:{YYYYMMDD}   -> 计数器, TTL 到当天结束

purpose: "login" | "bind"
target: 手机号或邮箱原始字符串 (调用方需自行 strip/normalize)
"""
import random
from datetime import datetime, timedelta

from app.db.redis_client import get_redis
from app.utils.logger import get_logger

logger = get_logger(__name__)

CODE_TTL_SECONDS = 300
COOLDOWN_SECONDS = 60
DAILY_LIMIT = 10


class RateLimitedError(Exception):
    """发送过于频繁 (冷却期内或超过每日上限)"""


class CodeExpiredError(Exception):
    """验证码不存在或已过期"""


class CodeInvalidError(Exception):
    """验证码不匹配"""


def _code_key(purpose: str, target: str) -> str:
    return f"verify_code:{purpose}:{target}"


def _cooldown_key(target: str) -> str:
    return f"verify_code_cooldown:{target}"


# 原子"比较并设置": 若已存 purpose 与本次 purpose 相同则拒绝(命中冷却),
# 否则覆盖写入本次 purpose 并放行. 用 EVAL 保证 GET+SET 不被并发请求打断.
_COOLDOWN_CHECK_SCRIPT = """
local existing = redis.call('GET', KEYS[1])
if existing == ARGV[1] then
    return 0
else
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return 1
end
"""


def _daily_key(target: str) -> str:
    today = datetime.now().strftime("%Y%m%d")
    return f"verify_code_daily:{target}:{today}"


def _seconds_until_midnight() -> int:
    now = datetime.now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds())


def generate_and_store(target: str, purpose: str) -> str:
    """生成 6 位验证码, 写入 Redis, 触发限流检查. 限流不通过抛 RateLimitedError."""
    r = get_redis()

    cooldown_key = _cooldown_key(target)
    allowed = r.eval(_COOLDOWN_CHECK_SCRIPT, 1, cooldown_key, purpose, COOLDOWN_SECONDS)
    if allowed == 0:
        logger.warning(f"验证码发送被冷却限流拦截: target={target}, purpose={purpose}")
        raise RateLimitedError("发送过于频繁，请稍后再试")

    daily_key = _daily_key(target)
    count = r.incr(daily_key)
    if count == 1:
        r.expire(daily_key, _seconds_until_midnight())
    if count > DAILY_LIMIT:
        logger.warning(f"验证码发送被每日上限拦截: target={target}, purpose={purpose}, count={count}")
        raise RateLimitedError("今日发送次数已达上限，请明天再试")

    code = str(random.randint(0, 999999)).zfill(6)
    r.set(_code_key(purpose, target), code, ex=CODE_TTL_SECONDS)
    return code


def verify_and_consume(target: str, purpose: str, code: str) -> bool:
    """校验验证码. 成功返回 True 并删除 key (一次性消费).
    不存在/已过期抛 CodeExpiredError, 存在但不匹配抛 CodeInvalidError."""
    r = get_redis()
    key = _code_key(purpose, target)
    stored = r.get(key)

    if stored is None:
        raise CodeExpiredError("验证码已过期或不存在，请重新获取")

    if stored != code:
        raise CodeInvalidError("验证码错误")

    r.delete(key)
    return True
