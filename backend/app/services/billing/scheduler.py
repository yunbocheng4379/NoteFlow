"""
定时任务调度
- 每日 02:00 → run_monthly_grant_tick   (会员月度电力发放)
- 每日 02:05 → expire_outdated_subscriptions (到期订阅置 EXPIRED)
- 每日 02:10 → cleanup_stale_pending_orders  (清理 24h 未支付订单)

使用 apscheduler BackgroundScheduler, 单进程内存, MVP 不依赖 redis/celery.
"""
from apscheduler.schedulers.background import BackgroundScheduler

from app.db.engine import SessionLocal
from app.services.billing import subscription_service, order_service
from app.utils.logger import get_logger

logger = get_logger(__name__)

_scheduler: BackgroundScheduler | None = None


def _run_in_session(fn, *args, **kwargs):
    """通用包装: 开 session, 单事务跑 fn, 出错记日志不抛出 (定时任务不能挂)"""
    s = SessionLocal()
    try:
        with s.begin():
            fn(s, *args, **kwargs)
    except Exception:
        logger.exception(f"定时任务 {fn.__name__} 失败, 已回滚")
    finally:
        s.close()


def _job_monthly_grant():
    _run_in_session(subscription_service.run_monthly_grant_tick)


def _job_expire_subs():
    _run_in_session(subscription_service.expire_outdated_subscriptions)


def _job_cleanup_orders():
    _run_in_session(order_service.cleanup_stale_pending_orders)


def start_scheduler():
    """在 FastAPI lifespan 启动时调用一次"""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    sch = BackgroundScheduler(daemon=True, timezone="Asia/Shanghai")
    sch.add_job(_job_monthly_grant,  "cron", hour=2, minute=0,  id="billing_monthly_grant")
    sch.add_job(_job_expire_subs,    "cron", hour=2, minute=5,  id="billing_expire_subs")
    sch.add_job(_job_cleanup_orders, "cron", hour=2, minute=10, id="billing_cleanup_orders")
    sch.start()
    _scheduler = sch
    logger.info("[scheduler] billing scheduler started (3 daily cron jobs)")
    return sch


def shutdown_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[scheduler] billing scheduler stopped")
