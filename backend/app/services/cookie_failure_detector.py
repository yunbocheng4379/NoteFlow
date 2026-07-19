"""
Cookie 失败判定器.

输入: 异常对象 / 错误字符串 / HTTP 状态码.
输出: bool — 是不是 cookie 引起的失败.

判定规则: 任一匹配即返回 True
- HTTP 状态码 412 / 403 / 401 (B 站 412 极常见)
- 错误文本含 cookie/login/sign_in/登录/认证/verify/cloudflare/风控/waf/captcha/人机
"""
from __future__ import annotations

from typing import Optional


# 匹配关键词 — 大小写不敏感
_COOKIE_FAILURE_KEYWORDS = (
    "cookie",
    "login",
    "log in",
    "sign in",
    "sign_in",
    "登录",
    "认证",
    "verify",
    "verification",
    "cloudflare",
    "waf",
    "风控",
    "人机",
    "captcha",
    "认证失败",
    "鉴权失败",
)

_COOKIE_FAILURE_HTTP_CODES = (401, 403, 412)


class CookieFailureDetector:
    @staticmethod
    def is_cookie_failure(
        error_msg: Optional[str] = None,
        http_status: Optional[int] = None,
    ) -> bool:
        if http_status in _COOKIE_FAILURE_HTTP_CODES:
            return True
        if not error_msg:
            return False
        msg = error_msg.lower()
        return any(kw.lower() in msg for kw in _COOKIE_FAILURE_KEYWORDS)
