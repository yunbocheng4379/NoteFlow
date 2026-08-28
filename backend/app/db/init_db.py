from app.db.models.users import User
from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask
from app.db.models.kb_index_status import KbIndexStatus
from app.db.models.kb_conversations import KbConversation, KbMessage
from app.db.models.user_transcriber_configs import UserTranscriberConfig
from app.db.models.system_settings import SystemSetting
from app.db.models.note_style import NoteStyle
from app.db.models.note_style_versions import NoteStyleVersion
from app.db.models.note_style_reviews import NoteStyleReview
from app.db.models.user_notifications import UserNotification
from app.db.models.note_share import NoteShare
from app.db.models.note_collections import NoteCollection, NoteCollectionItem
from app.db.models.collection_share import CollectionShare
from app.db.models.flashcards import FlashcardSet, Flashcard
from app.db.models.feedbacks import Feedback
from app.db.models.platform_cookies import PlatformCookie
from app.db.models.cloud_credentials import CloudCredential
from app.db.models.notifications import Notification
from app.db.models.platforms import Platform
from app.db.models.update_logs import UpdateLog
from app.db.models.analytics_events import AnalyticsEvent
from app.db.models.notification_email import (
    NotificationEmailBatch,
    NotificationEmailBatchItem,
    NotificationEmailDelivery,
)

# === 电力 / 计费 / 订阅 / 推荐相关模型 ===
from app.db.models.credit_pricing import CreditPricing
from app.db.models.credit_format_pricing import CreditFormatPricing
from app.db.models.credit_transactions import CreditTransaction
from app.db.models.recharge_packages import RechargePackage
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.orders import Order
from app.db.models.subscriptions import Subscription
from app.db.models.referral_rewards import ReferralReward

from sqlalchemy import inspect, text

from app.db.engine import get_engine, Base

def init_db():
    engine = get_engine()
    Base.metadata.create_all(bind=engine)

    # The AI audit tables are also created explicitly so an old installation
    # receives them even when the application imported only a subset of models.
    from app.db.models.ai_usage import AIModelPricing, AIUsageLog
    Base.metadata.create_all(bind=engine, tables=[AIUsageLog.__table__, AIModelPricing.__table__])

    # Base.metadata.create_all 不会给已有表补列；对已经存在的数据库执行轻量级、
    # 幂等的补列，避免模型升级后旧库在查询时出现 Unknown column。
    with engine.begin() as conn:
        columns = {column["name"] for column in inspect(conn).get_columns("note_styles")}
        if "is_deleted" not in columns:
            conn.execute(text(
                "ALTER TABLE note_styles ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0"
            ))
        if "moderation_status" not in columns:
            conn.execute(text(
                "ALTER TABLE note_styles ADD COLUMN moderation_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'"
            ))
            conn.execute(text(
                "UPDATE note_styles SET moderation_status = 'PUBLISHED' "
                "WHERE source = 'user' AND is_public = 1"
            ))
        if "published_version_id" not in columns:
            conn.execute(text("ALTER TABLE note_styles ADD COLUMN published_version_id INTEGER NULL"))
        if "pending_version_id" not in columns:
            conn.execute(text("ALTER TABLE note_styles ADD COLUMN pending_version_id INTEGER NULL"))
        if "review_reason" not in columns:
            conn.execute(text("ALTER TABLE note_styles ADD COLUMN review_reason TEXT NULL"))
        if "reviewed_at" not in columns:
            conn.execute(text("ALTER TABLE note_styles ADD COLUMN reviewed_at DATETIME NULL"))

        order_columns = {column["name"] for column in inspect(conn).get_columns("orders")}
        if "hidden_at" not in order_columns:
            conn.execute(text("ALTER TABLE orders ADD COLUMN hidden_at DATETIME NULL"))

        package_columns = {column["name"] for column in inspect(conn).get_columns("recharge_packages")}
        if "is_one_time" not in package_columns:
            conn.execute(text(
                "ALTER TABLE recharge_packages ADD COLUMN is_one_time INTEGER NOT NULL DEFAULT 0"
            ))

        version_columns = {column["name"] for column in inspect(conn).get_columns("note_style_versions")}
        if "ai_recommendations" not in version_columns:
            conn.execute(text("ALTER TABLE note_style_versions ADD COLUMN ai_recommendations VARCHAR(2000) NULL"))

        review_columns = {column["name"] for column in inspect(conn).get_columns("note_style_reviews")}
        if "ai_recommendations" not in review_columns:
            conn.execute(text("ALTER TABLE note_style_reviews ADD COLUMN ai_recommendations VARCHAR(2000) NULL"))

    _backfill_note_style_versions()


def _backfill_note_style_versions():
    """为升级前的用户风格创建首个快照，确保旧公开数据可继续使用。"""
    from datetime import datetime
    from app.db.engine import SessionLocal
    from app.db.models.note_style import NoteStyle
    from app.db.models.note_style_versions import NoteStyleVersion

    db = SessionLocal()
    try:
        styles = db.query(NoteStyle).filter(NoteStyle.source == "user").all()
        for style in styles:
            if db.query(NoteStyleVersion.id).filter(NoteStyleVersion.style_id == style.id).first():
                continue
            status = "PUBLISHED" if style.is_public else "DRAFT"
            version = NoteStyleVersion(
                style_id=style.id,
                version_no=1,
                name=style.name,
                value=style.value,
                description=style.description,
                prompt=style.prompt,
                icon=style.icon,
                status=status,
                submitted_at=style.created_at if status == "PUBLISHED" else None,
                created_at=style.created_at or datetime.now(),
            )
            db.add(version)
            db.flush()
            if status == "PUBLISHED":
                style.published_version_id = version.id
            style.moderation_status = status
        db.commit()
    finally:
        db.close()
