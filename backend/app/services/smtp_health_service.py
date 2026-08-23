"""SMTP availability checks and in-app administrator alerts."""

from app.services.notification_service import NotificationService
from app.db.models.notifications import NOTIFICATION_CATEGORY_SMTP_HEALTH
from app.utils.mailer import SmtpCheckResult, check_smtp_login

DEDUPE_WINDOW_SECONDS = 24 * 60 * 60


def _failure_title(kind: str) -> str:
    return {
        "auth": "SMTP 授权码可能失效",
        "config": "SMTP 配置不完整",
        "connection": "SMTP 服务连接异常",
    }.get(kind, "SMTP 邮件服务异常")


class SmtpHealthService:
    @staticmethod
    def check() -> dict:
        result: SmtpCheckResult = check_smtp_login()
        if result.ok:
            return {"healthy": True}
        return SmtpHealthService.report_failure(result)

    @staticmethod
    def report_failure(result: SmtpCheckResult) -> dict:
        if result.ok:
            return {"healthy": True}

        kind = result.kind or "unknown"
        title = _failure_title(kind)
        detail = result.error or "未返回具体错误"
        NotificationService.publish(
            category=NOTIFICATION_CATEGORY_SMTP_HEALTH,
            severity="error" if kind in {"auth", "config"} else "warning",
            title=title,
            content=(
                "系统在 SMTP 健康检查或邮件发送时发现异常。"
                f"\n\n错误类型: {kind}\n错误信息: {detail}"
                "\n\n请检查 SMTP 服务是否开启、服务器地址/端口和邮箱授权码。"
            ),
            source_type="smtp",
            source_id="delivery",
            dedup_window_seconds=DEDUPE_WINDOW_SECONDS,
        )
        return {"healthy": False, "kind": kind}
