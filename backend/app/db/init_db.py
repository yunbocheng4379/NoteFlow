from app.db.models.users import User
from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask
from app.db.models.user_transcriber_configs import UserTranscriberConfig
from app.db.models.note_style import NoteStyle
from app.db.models.note_share import NoteShare
from app.db.models.note_collections import NoteCollection, NoteCollectionItem
from app.db.models.collection_share import CollectionShare
from app.db.models.flashcards import FlashcardSet, Flashcard
from app.db.models.feedbacks import Feedback
from app.db.models.platform_cookies import PlatformCookie
from app.db.models.notifications import Notification
from app.db.models.platforms import Platform
from app.db.models.update_logs import UpdateLog

# === 电力 / 计费 / 订阅 / 推荐相关模型 ===
from app.db.models.credit_pricing import CreditPricing
from app.db.models.credit_transactions import CreditTransaction
from app.db.models.recharge_packages import RechargePackage
from app.db.models.subscription_plans import SubscriptionPlan
from app.db.models.orders import Order
from app.db.models.subscriptions import Subscription
from app.db.models.referral_rewards import ReferralReward

from app.db.engine import get_engine, Base

def init_db():
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
