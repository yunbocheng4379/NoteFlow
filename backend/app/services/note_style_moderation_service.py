from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import desc

from app.db.engine import SessionLocal
from app.db.models.note_style import NoteStyle
from app.db.models.note_style_reviews import NoteStyleReview
from app.db.models.note_style_versions import NoteStyleVersion
from app.db.models.users import User
from app.db.note_style_dao import _to_dict, _version_dict, _visible_dict
from app.db.models.notifications import (
    Notification,
    NOTIFICATION_CATEGORY_NOTE_STYLE_REVIEW,
    NOTIFICATION_SEVERITY_INFO,
    NOTIFICATION_SEVERITY_WARNING,
    NOTIFICATION_STATUS_HANDLED,
    NOTIFICATION_STATUS_PENDING,
)
from app.services.content_moderation_service import ContentModerationService
from app.services.notification_service import NotificationService
from app.services.user_notification_service import UserNotificationService


class NoteStyleModerationError(ValueError):
    pass


class NoteStyleModerationService:
    @staticmethod
    def _next_version_no(db, style_id: int) -> int:
        latest = (
            db.query(NoteStyleVersion.version_no)
            .filter(NoteStyleVersion.style_id == style_id)
            .order_by(NoteStyleVersion.version_no.desc())
            .first()
        )
        return int(latest[0] if latest else 0) + 1

    @staticmethod
    def _get_style(db, style_id: int, user_id: Optional[int] = None) -> NoteStyle:
        query = db.query(NoteStyle).filter(NoteStyle.id == style_id, NoteStyle.is_deleted.is_(False))
        if user_id is not None:
            query = query.filter(NoteStyle.user_id == user_id, NoteStyle.source == "user")
        style = query.first()
        if style is None:
            raise NoteStyleModerationError("样式不存在或无权操作")
        return style

    @staticmethod
    def _pending_version(db, style: NoteStyle) -> Optional[NoteStyleVersion]:
        if style.pending_version_id:
            return db.query(NoteStyleVersion).filter(NoteStyleVersion.id == style.pending_version_id).first()
        return (
            db.query(NoteStyleVersion)
            .filter(NoteStyleVersion.style_id == style.id, NoteStyleVersion.status == "PENDING_REVIEW")
            .order_by(NoteStyleVersion.version_no.desc())
            .first()
        )

    @staticmethod
    def _record(
        db,
        *,
        style: NoteStyle,
        version: NoteStyleVersion,
        action: str,
        from_status: Optional[str],
        to_status: str,
        reviewer_id: Optional[int] = None,
        reason: Optional[str] = None,
    ):
        db.add(NoteStyleReview(
            style_id=style.id,
            version_id=version.id,
            action=action,
            from_status=from_status,
            to_status=to_status,
            reviewer_id=reviewer_id,
            reason=reason,
            ai_status=version.ai_status,
            ai_risk_level=version.ai_risk_level,
            ai_categories=version.ai_categories,
            ai_summary=version.ai_summary,
            ai_recommendations=version.ai_recommendations,
        ))

    @staticmethod
    def _safe_admin_notification(*, title: str, content: str, source_id: str, severity: str):
        try:
            record, _ = NotificationService.publish(
                category=NOTIFICATION_CATEGORY_NOTE_STYLE_REVIEW,
                severity=severity,
                title=title,
                content=content,
                source_type="note_style",
                source_id=source_id,
                dedup_window_seconds=30,
            )
            return record
        except Exception:
            # 通知/邮件属于旁路能力，不能让审核状态回滚。
            return None

    @staticmethod
    def _mark_review_notifications_handled(
        db,
        *,
        style_id: int,
        version_id: int,
        admin_id: int,
        handler_note: str,
    ) -> None:
        """同步处理该审核版本产生的后台系统通知。"""
        source_prefix = f"{style_id}:{version_id}:"
        rows = (
            db.query(Notification)
            .filter(
                Notification.category == NOTIFICATION_CATEGORY_NOTE_STYLE_REVIEW,
                Notification.source_type == "note_style",
                Notification.source_id.like(f"{source_prefix}%"),
                Notification.status == NOTIFICATION_STATUS_PENDING,
            )
            .all()
        )
        handled_at = datetime.now()
        for row in rows:
            row.status = NOTIFICATION_STATUS_HANDLED
            row.handled_by = admin_id
            row.handled_at = handled_at
            row.handler_note = handler_note

    @staticmethod
    def _notify_author(*, style: NoteStyle, version: NoteStyleVersion, title: str, content: str, severity: str = "info"):
        if not style.user_id:
            return
        try:
            UserNotificationService.publish(
                user_id=style.user_id,
                category="note_style_review",
                title=title,
                content=content,
                source_type="note_style_version",
                source_id=f"{version.id}:{title}",
                link="/note-style",
                severity=severity,
            )
        except Exception:
            pass

    @staticmethod
    def submit(style_id: int, user_id: int) -> dict:
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id, user_id=user_id)
            old_status = style.moderation_status
            version = NoteStyleModerationService._pending_version(db, style)
            if version is None:
                version = NoteStyleVersion(
                    style_id=style.id,
                    version_no=NoteStyleModerationService._next_version_no(db, style.id),
                    name=style.name,
                    value=style.value,
                    description=style.description,
                    prompt=style.prompt,
                    icon=style.icon,
                    status="PENDING_REVIEW",
                )
                db.add(version)
                db.flush()

            result = ContentModerationService.screen(
                name=version.name,
                description=version.description,
                prompt=version.prompt,
            )
            version.status = "PENDING_REVIEW"
            version.submitted_at = datetime.now()
            version.ai_status = result["status"]
            version.ai_risk_level = result["risk_level"]
            version.ai_categories = ContentModerationService.serialize_categories(result["categories"])
            version.ai_summary = result["summary"]
            version.ai_recommendations = ContentModerationService.serialize_categories(result["recommendations"])
            version.ai_provider = result.get("provider")
            version.ai_checked_at = result.get("checked_at")
            style.pending_version_id = version.id
            style.moderation_status = "PENDING_REVIEW"
            style.is_public = bool(style.published_version_id)
            action = "resubmit" if style.review_reason or version.version_no > 1 else "submit"
            NoteStyleModerationService._record(
                db,
                style=style,
                version=version,
                action=action,
                from_status=old_status,
                to_status="PENDING_REVIEW",
            )
            db.commit()
            db.refresh(style)
            result_style = _visible_dict(db, style, user_id)
            source_id = f"{style.id}:{version.id}:{action}"
            publisher = db.query(User.username).filter(User.id == style.user_id).scalar()
            publisher_name = publisher or f"用户 {style.user_id}"
            NoteStyleModerationService._safe_admin_notification(
                title="有新的笔记风格待审核",
                content=f"用户 {publisher_name} 提交了笔记风格《{version.name}》第 {version.version_no} 版，请及时审核。AI 初筛：{result['status']}。",
                source_id=source_id,
                severity=NOTIFICATION_SEVERITY_WARNING if result["status"] in {"risk", "failed"} else NOTIFICATION_SEVERITY_INFO,
            )
            return result_style
        finally:
            db.close()

    @staticmethod
    def approve(style_id: int, admin_id: int) -> dict:
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id)
            version = NoteStyleModerationService._pending_version(db, style)
            if version is None or version.status != "PENDING_REVIEW":
                raise NoteStyleModerationError("当前没有待审核版本")
            old_status = style.moderation_status
            if style.published_version_id and style.published_version_id != version.id:
                old = db.query(NoteStyleVersion).filter(NoteStyleVersion.id == style.published_version_id).first()
                if old:
                    old.status = "UNPUBLISHED"
            version.status = "PUBLISHED"
            style.name = version.name
            style.value = version.value[:64]
            style.description = version.description
            style.prompt = version.prompt
            style.icon = version.icon
            style.published_version_id = version.id
            style.pending_version_id = None
            style.is_public = True
            style.moderation_status = "PUBLISHED"
            style.review_reason = None
            style.reviewed_at = datetime.now()
            NoteStyleModerationService._record(
                db, style=style, version=version, action="approve", from_status=old_status,
                to_status="PUBLISHED", reviewer_id=admin_id,
            )
            NoteStyleModerationService._mark_review_notifications_handled(
                db,
                style_id=style.id,
                version_id=version.id,
                admin_id=admin_id,
                handler_note="审核通过并上架",
            )
            db.commit()
            db.refresh(style)
            NoteStyleModerationService._notify_author(
                style=style, version=version, title="笔记风格审核通过",
                content=f"你的笔记风格《{version.name}》第 {version.version_no} 版已审核通过，现已上架公开广场。",
            )
            return _visible_dict(db, style, style.user_id)
        finally:
            db.close()

    @staticmethod
    def reject(style_id: int, admin_id: int, reason: str) -> dict:
        reason = (reason or "").strip()
        if not reason:
            raise NoteStyleModerationError("驳回原因不能为空")
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id)
            version = NoteStyleModerationService._pending_version(db, style)
            if version is None or version.status != "PENDING_REVIEW":
                raise NoteStyleModerationError("当前没有待审核版本")
            old_status = style.moderation_status
            version.status = "REJECTED"
            style.pending_version_id = None
            style.moderation_status = "PUBLISHED" if style.published_version_id else "REJECTED"
            style.is_public = bool(style.published_version_id)
            style.review_reason = reason
            style.reviewed_at = datetime.now()
            NoteStyleModerationService._record(
                db, style=style, version=version, action="reject", from_status=old_status,
                to_status="REJECTED", reviewer_id=admin_id, reason=reason,
            )
            NoteStyleModerationService._mark_review_notifications_handled(
                db,
                style_id=style.id,
                version_id=version.id,
                admin_id=admin_id,
                handler_note=f"审核驳回：{reason}",
            )
            db.commit()
            db.refresh(style)
            NoteStyleModerationService._notify_author(
                style=style, version=version, title="笔记风格审核未通过",
                content=f"你的笔记风格《{version.name}》第 {version.version_no} 版暂未通过审核。原因：{reason}",
                severity="warning",
            )
            return _visible_dict(db, style, style.user_id)
        finally:
            db.close()

    @staticmethod
    def unpublish(style_id: int, admin_id: int, reason: str) -> dict:
        reason = (reason or "").strip()
        if not reason:
            raise NoteStyleModerationError("下架原因不能为空")
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id)
            version = db.query(NoteStyleVersion).filter(NoteStyleVersion.id == style.published_version_id).first()
            if version is None or version.status != "PUBLISHED":
                raise NoteStyleModerationError("当前没有已上架版本")
            old_status = style.moderation_status
            version.status = "UNPUBLISHED"
            style.published_version_id = None
            style.is_public = False
            style.moderation_status = "UNPUBLISHED"
            style.review_reason = reason
            style.reviewed_at = datetime.now()
            NoteStyleModerationService._record(
                db, style=style, version=version, action="unpublish", from_status=old_status,
                to_status="UNPUBLISHED", reviewer_id=admin_id, reason=reason,
            )
            db.commit()
            db.refresh(style)
            NoteStyleModerationService._notify_author(
                style=style, version=version, title="笔记风格已下架",
                content=f"你的笔记风格《{version.name}》已被管理员下架。原因：{reason}",
                severity="warning",
            )
            notification = NoteStyleModerationService._safe_admin_notification(
                title="笔记风格已下架",
                content=f"笔记风格《{version.name}》已被管理员下架。原因：{reason}",
                source_id=f"{style.id}:{version.id}:unpublish:{int(datetime.now().timestamp())}",
                severity=NOTIFICATION_SEVERITY_WARNING,
            )
            if notification:
                NotificationService.update_status(
                    notification_id=notification["id"],
                    status=NOTIFICATION_STATUS_HANDLED,
                    handler_note=f"已下架：{reason}",
                    handled_by=admin_id,
                )
            return _visible_dict(db, style, style.user_id)
        finally:
            db.close()

    @staticmethod
    def republish(style_id: int, admin_id: int) -> dict:
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id)
            version = (
                db.query(NoteStyleVersion)
                .filter(NoteStyleVersion.style_id == style.id, NoteStyleVersion.status == "UNPUBLISHED")
                .order_by(NoteStyleVersion.version_no.desc())
                .first()
            )
            if version is None:
                raise NoteStyleModerationError("没有可恢复的审核版本")
            old_status = style.moderation_status
            version.status = "PUBLISHED"
            style.published_version_id = version.id
            style.is_public = True
            style.moderation_status = "PUBLISHED"
            style.review_reason = None
            style.reviewed_at = datetime.now()
            NoteStyleModerationService._record(
                db, style=style, version=version, action="republish", from_status=old_status,
                to_status="PUBLISHED", reviewer_id=admin_id,
            )
            NoteStyleModerationService._mark_review_notifications_handled(
                db,
                style_id=style.id,
                version_id=version.id,
                admin_id=admin_id,
                handler_note="已恢复上架",
            )
            db.commit()
            db.refresh(style)
            NoteStyleModerationService._notify_author(
                style=style, version=version, title="笔记风格已恢复上架",
                content=f"你的笔记风格《{version.name}》已恢复上架公开广场。",
            )
            return _visible_dict(db, style, style.user_id)
        finally:
            db.close()

    @staticmethod
    def list_admin(*, status: Optional[str] = None, keyword: Optional[str] = None, page: int = 1, page_size: int = 20):
        db = SessionLocal()
        try:
            query = db.query(NoteStyle).filter(NoteStyle.source == "user", NoteStyle.is_deleted.is_(False))
            if status:
                query = query.filter(NoteStyle.moderation_status == status)
            if keyword:
                like = f"%{keyword.strip()}%"
                query = query.filter(NoteStyle.name.like(like) | NoteStyle.description.like(like))
            total = query.count()
            styles = query.order_by(NoteStyle.updated_at.desc(), NoteStyle.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
            items = []
            for style in styles:
                version = NoteStyleModerationService._pending_version(db, style)
                if version is None and style.published_version_id:
                    version = db.query(NoteStyleVersion).filter(NoteStyleVersion.id == style.published_version_id).first()
                item = _to_dict(style, version=version)
                owner = db.query(User).filter(User.id == style.user_id).first()
                item["owner"] = {"id": owner.id, "username": owner.username, "email": owner.email} if owner else None
                item["ai_categories"] = json.loads(version.ai_categories or "[]") if version else []
                item["ai_recommendations"] = json.loads(version.ai_recommendations or "[]") if version else []
                items.append(item)
            return items, total
        finally:
            db.close()

    @staticmethod
    def detail(style_id: int) -> dict:
        db = SessionLocal()
        try:
            style = NoteStyleModerationService._get_style(db, style_id)
            versions = db.query(NoteStyleVersion).filter(NoteStyleVersion.style_id == style.id).order_by(NoteStyleVersion.version_no.desc()).all()
            reviews = db.query(NoteStyleReview).filter(NoteStyleReview.style_id == style.id).order_by(NoteStyleReview.created_at.desc(), NoteStyleReview.id.desc()).all()
            data = _to_dict(style, version=NoteStyleModerationService._pending_version(db, style))
            data["versions"] = [_version_dict(version) for version in versions]
            data["reviews"] = [
                {
                    "id": review.id,
                    "version_id": review.version_id,
                    "action": review.action,
                    "from_status": review.from_status,
                    "to_status": review.to_status,
                    "reviewer_id": review.reviewer_id,
                    "reason": review.reason,
                    "ai_status": review.ai_status,
                    "ai_risk_level": review.ai_risk_level,
                    "ai_categories": json.loads(review.ai_categories or "[]"),
                    "ai_summary": review.ai_summary,
                    "ai_recommendations": json.loads(review.ai_recommendations or "[]"),
                    "created_at": review.created_at.isoformat() if review.created_at else None,
                }
                for review in reviews
            ]
            return data
        finally:
            db.close()

    @staticmethod
    def pending_count() -> int:
        db = SessionLocal()
        try:
            return db.query(NoteStyle).filter(NoteStyle.source == "user", NoteStyle.is_deleted.is_(False), NoteStyle.moderation_status == "PENDING_REVIEW").count()
        finally:
            db.close()
