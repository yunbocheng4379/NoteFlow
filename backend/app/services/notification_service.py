"""
通知服务的「门面」层. 业务侧只需要和 NotificationService 打交道,
DAO 细节 (含 ORM、session 管理) 不外泄.

特别强调 ``publish()`` 的幂等性 — 同 dedup_key + 窗口内多次调用,
只会刷新 last_seen_at / occurrence_count, 不会创建新行,
也绝不会发重复通知.
"""
from __future__ import annotations

from typing import Optional

from app.db import notification_dao
from app.db.models.notifications import (
    NOTIFICATION_CATEGORY_COOKIE_FAILURE,
    NOTIFICATION_CATEGORY_POOL_EXHAUSTED,
    NOTIFICATION_SEVERITY_INFO,
    NOTIFICATION_SEVERITY_WARNING,
    NOTIFICATION_SEVERITY_ERROR,
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_HANDLED,
    NOTIFICATION_STATUS_CLOSED,
    NOTIFICATION_STATUS_IGNORED,
)


class NotificationService:
    # ===== 发布 =====

    @staticmethod
    def publish(
        *,
        category: str,
        title: str,
        content: str,
        severity: str = "warning",
        source_type: Optional[str] = None,
        source_id: Optional[str] = None,
        platform: Optional[str] = None,
        dedup_window_seconds: int = 60,
    ) -> tuple:
        """
        返回 ``(record_dict, state)``, state ∈ ``"created" | "merged"``.

        dedup_key 自动从 (category, source_type, source_id) 推算.

        调用方 (例如 CookiePoolManager) 通常不需要 state, 但 Service
        仍然返回出来便于单元测试断言.
        """
        if not source_type or not source_id:
            # 没 source 关联的通知没有去重意义, 直接返回 dict 不入库
            raise ValueError("publish() 必须传 source_type + source_id 才能去重")

        dedup_key = f"{category}:{source_type}:{source_id}"
        row, state = notification_dao.upsert_for_publish(
            dedup_key=dedup_key,
            category=category,
            severity=severity,
            title=title,
            content=content,
            source_type=source_type,
            source_id=str(source_id),
            platform=platform,
            dedup_window_seconds=dedup_window_seconds,
        )
        return _row_to_dict(row), state

    @staticmethod
    def publish_cookie_failure(
        *,
        cookie_id: int,
        platform: str,
        cookie_name: str,
        error_msg: str,
    ) -> tuple:
        """包装 publish, 用于 cookie 单条失效通知 (通常失败到阈值才发)."""
        return NotificationService.publish(
            category=NOTIFICATION_CATEGORY_COOKIE_FAILURE,
            severity=NOTIFICATION_SEVERITY_WARNING,
            title=f"{platform} 平台 Cookie 失效: {cookie_name}",
            content=(
                f"Cookie (id={cookie_id}, name={cookie_name}) 在连续下载失败中"
                f"被自动标记为失效.\n\n最近错误: {error_msg[:500]}"
            ),
            source_type="platform_cookie",
            source_id=str(cookie_id),
            platform=platform,
        )

    @staticmethod
    def publish_pool_exhausted(*, platform: str) -> tuple:
        return NotificationService.publish(
            category=NOTIFICATION_CATEGORY_POOL_EXHAUSTED,
            severity=NOTIFICATION_SEVERITY_ERROR,
            title=f"{platform} 平台 Cookie 池已耗尽",
            content=(
                f"平台 {platform} 的所有可用 Cookie 都被标记为失效, "
                "用户下载请求会一直 401/412. 请尽快在管理员后台补充 Cookie."
            ),
            source_type="platform",
            source_id=platform,
            platform=platform,
            dedup_window_seconds=300,
        )

    # ===== 查询 =====

    @staticmethod
    def list(*, status=None, category=None, platform=None, keyword=None,
             page: int = 1, page_size: int = 20):
        items, total = notification_dao.list_filter(
            status=status, category=category, platform=platform,
            keyword=keyword, page=page, page_size=page_size,
        )
        return items, total

    @staticmethod
    def get(notification_id: int):
        row = notification_dao.get_by_id(notification_id)
        return _row_to_dict(row) if row else None

    @staticmethod
    def count_by_status() -> dict:
        return notification_dao.count_by_status()

    @staticmethod
    def count_unread() -> int:
        return notification_dao.count_unread()

    @staticmethod
    def update_status(*, notification_id: int, status: str,
                      handler_note=None, handled_by=None):
        row = notification_dao.update_status(
            notification_id=notification_id,
            status=status,
            handler_note=handler_note,
            handled_by=handled_by,
        )
        return _row_to_dict(row) if row else None


def _row_to_dict(row) -> dict:
    if row is None:
        return {}
    def _fmt(v):
        return v.isoformat() if hasattr(v, "isoformat") and v else v
    return {
        "id": row.id,
        "category": row.category,
        "severity": row.severity,
        "title": row.title,
        "content": row.content,
        "source_type": row.source_type,
        "source_id": row.source_id,
        "platform": row.platform,
        "status": row.status,
        "dedup_key": row.dedup_key,
        "first_seen_at": _fmt(row.first_seen_at),
        "last_seen_at": _fmt(row.last_seen_at),
        "occurrence_count": row.occurrence_count,
        "handled_by": row.handled_by,
        "handled_at": _fmt(row.handled_at),
        "handler_note": row.handler_note,
        "created_at": _fmt(row.created_at),
        "updated_at": _fmt(row.updated_at),
    }
