"""Email delivery workflow for pending administrator system notifications."""

from __future__ import annotations

import html
import os
import time
from datetime import datetime
from typing import Iterable
from zoneinfo import ZoneInfo

from app.db import notification_email_dao
from app.utils.logger import get_logger
from app.utils.mailer import SmtpCheckResult, send_email_detailed

logger = get_logger(__name__)
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


class NotificationEmailService:
    RETRY_DELAY_SECONDS = 5

    @staticmethod
    def _send_with_one_retry(to: str, subject: str, html_body: str) -> tuple[bool, int, str | None]:
        attempts = 0
        failure_result: SmtpCheckResult | None = None
        for attempt in range(2):
            attempts += 1
            try:
                result: SmtpCheckResult = send_email_detailed(
                    to=to, subject=subject, html_body=html_body
                )
                if result.ok:
                    return True, attempts, None
                failure_result = result
                error = result.error or "SMTP 未确认发送成功"
            except Exception as exc:  # send_email is defensive, but keep this boundary safe
                logger.exception("管理员系统通知邮件发送异常: to=%s", to)
                error = str(exc)[:500]
                failure_result = SmtpCheckResult(ok=False, kind="unknown", error=error)

            if attempt == 0:
                time.sleep(NotificationEmailService.RETRY_DELAY_SECONDS)

        from app.services.smtp_health_service import SmtpHealthService

        try:
            SmtpHealthService.report_failure(failure_result or SmtpCheckResult(
                ok=False, kind="unknown", error=error
            ))
        except Exception:
            logger.exception("SMTP 故障告警写入系统通知失败")
        return False, attempts, error

    @staticmethod
    def _render_items(items: Iterable[dict]) -> str:
        rendered = []
        for item in items:
            title = html.escape(str(item.get("title") or "系统通知"))
            content = html.escape(str(item.get("content") or "")).replace("\n", "<br>")
            platform = html.escape(str(item.get("platform") or ""))
            platform_html = (
                f'<span style="color:#167a6e;">[{platform}]</span> '
                if platform else ""
            )
            rendered.append(
                "<article style=\"padding:12px 0;border-bottom:1px solid #e5efeb;\">"
                f"<h3 style=\"margin:0 0 6px;color:#243447;\">{platform_html}{title}</h3>"
                f"<p style=\"margin:0;color:#56716b;line-height:1.6;\">{content}</p>"
                "</article>"
            )
        return "".join(rendered)

    @staticmethod
    def _wrap_body(*, heading: str, items: list[dict], link_path: str = "/settings/notifications") -> str:
        frontend_url = html.escape(
            os.getenv("FRONTEND_URL", "http://127.0.0.1:3015"), quote=True
        )
        return f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;color:#243447;">
          <h2 style="color:#167a6e;">{html.escape(heading)}</h2>
          {NotificationEmailService._render_items(items)}
          <p style="margin-top:20px;"><a href="{frontend_url}{html.escape(link_path, quote=True)}" style="color:#167a6e;">打开处理页面</a></p>
          <p style="color:#999;font-size:12px;">来自 NoteFlow AI 系统通知</p>
        </div>
        """

    @staticmethod
    def _finish_batch(*, batch_id: int, deliveries: list[dict], attempted: int) -> dict:
        sent = sum(1 for item in deliveries if item["status"] == "sent")
        failed = sum(1 for item in deliveries if item["status"] == "failed")
        if not deliveries:
            status = "skipped"
        elif failed == 0:
            status = "sent"
        elif sent:
            status = "partial"
        else:
            status = "failed"
        notification_email_dao.update_batch_status(batch_id=batch_id, status=status)
        return {
            "batch_id": batch_id,
            "recipients": len(deliveries),
            "attempted": attempted,
            "sent": sent,
            "failed": failed,
        }

    @staticmethod
    def _deliver_batch(*, batch: dict, subject: str, body: str, recipients: list[dict]) -> dict:
        deliveries = []
        attempted = 0
        for recipient in recipients:
            delivery = notification_email_dao.get_or_create_delivery(
                batch_id=batch["id"],
                recipient_user_id=recipient["id"],
                recipient_email=recipient["email"],
            )
            if delivery.get("status") == "sent":
                deliveries.append(delivery)
                continue

            ok, attempts, error = NotificationEmailService._send_with_one_retry(
                recipient["email"], subject, body
            )
            attempted += 1
            status = "sent" if ok else "failed"
            saved = notification_email_dao.mark_delivery_result(
                delivery_id=delivery["id"],
                status=status,
                attempt_count=int(delivery.get("attempt_count") or 0) + attempts,
                last_error=error,
            )
            deliveries.append(
                saved if isinstance(saved, dict) else {**delivery, "status": status}
            )

        return NotificationEmailService._finish_batch(
            batch_id=batch["id"], deliveries=deliveries, attempted=attempted
        )

    @staticmethod
    def send_immediate(notification: dict) -> dict:
        if notification.get("status", "pending") != "pending":
            return {"notifications": 0, "recipients": 0, "attempted": 0, "sent": 0, "failed": 0}

        event_key = notification.get("last_seen_at") or notification.get("created_at") or notification["id"]
        batch = notification_email_dao.create_batch(
            batch_key=f"instant:{notification['id']}:{event_key}",
            batch_type="instant",
        )
        notification_email_dao.add_batch_items(batch_id=batch["id"], notifications=[notification])
        # 笔记风格审核是用户公开内容治理事件，按产品约定默认发送到所有已绑定邮箱的管理员；
        # 其它系统通知继续遵循管理员的待处理邮件开关。
        recipients = notification_email_dao.list_eligible_admins(
            require_pending_preference=notification.get("category") != "note_style_review"
        )
        if not recipients:
            notification_email_dao.update_batch_status(batch_id=batch["id"], status="skipped")
            return {"batch_id": batch["id"], "notifications": 1, "recipients": 0, "attempted": 0, "sent": 0, "failed": 0}

        result = NotificationEmailService._deliver_batch(
            batch=batch,
            subject=f"系统通知：{notification.get('title') or '新的待处理通知'}",
            body=NotificationEmailService._wrap_body(
                heading=notification.get("title") or "新的待处理系统通知",
                items=[notification],
                link_path="/settings/note-styles" if notification.get("category") == "note_style_review" else "/settings/notifications",
            ),
            recipients=recipients,
        )
        return {"notifications": 1, **result}

    @staticmethod
    def send_daily_digest(now: datetime | None = None) -> dict:
        notifications = notification_email_dao.list_pending_notifications()
        if not notifications:
            return {"notifications": 0, "recipients": 0, "attempted": 0, "sent": 0, "failed": 0}

        now = now or datetime.now(SHANGHAI_TZ)
        batch = notification_email_dao.create_batch(
            batch_key=f"daily:{now.date().isoformat()}",
            batch_type="daily",
        )
        notification_email_dao.add_batch_items(batch_id=batch["id"], notifications=notifications)
        items = notification_email_dao.get_batch_items(batch["id"]) or notifications
        recipients = notification_email_dao.list_eligible_admins()
        if not recipients:
            notification_email_dao.update_batch_status(batch_id=batch["id"], status="skipped")
            return {"batch_id": batch["id"], "notifications": len(items), "recipients": 0, "attempted": 0, "sent": 0, "failed": 0}

        result = NotificationEmailService._deliver_batch(
            batch=batch,
            subject=f"待处理系统通知汇总（{len(items)} 条）",
            body=NotificationEmailService._wrap_body(
                heading=f"待处理系统通知汇总（{len(items)} 条）",
                items=items,
            ),
            recipients=recipients,
        )
        return {"notifications": len(items), **result}
