"""
LLM Provider fallback 辅助逻辑。

当主 Provider 因 402 / 401 / 网络错误等"可恢复"原因失败时，
抛出 LLMFallbackableError，由上层 `_summarize_with_fallback`
捕获并尝试下一个启用的 Provider，避免任务直接失败。
"""
from __future__ import annotations


# 这些异常信号都视为"Provider 临时不可用"，可以切换到下一个 Provider
# - 402 Insufficient Balance: 中转/平台账户余额耗尽
# - 401 / unauthorized: API Key 失效
# - 403: API Key 权限不足
# - 429: 限流
# - 5xx / timeout / connection: 网络或上游服务问题
_FALLBACK_KEYWORDS = (
    "402",
    "401",
    "403",
    "429",
    "insufficient balance",
    "insufficient_balance",
    "unauthorized",
    "authentication",
    "invalid api key",
    "incorrect api key",
    "rate limit",
    "too many requests",
    "timeout",
    "timed out",
    "connection",
    "refused",
    "network",
    "service unavailable",
    "bad gateway",
    "internal server error",
)


class LLMFallbackableError(Exception):
    """Provider 可恢复错误信号，触发上层 fallback 到下一个 Provider。"""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    @staticmethod
    def is_fallbackable(exc: BaseException) -> bool:
        """判断原始异常是否属于"可切换 Provider 重试"的类型。"""
        raw = str(exc).lower()
        return any(kw in raw for kw in _FALLBACK_KEYWORDS)
