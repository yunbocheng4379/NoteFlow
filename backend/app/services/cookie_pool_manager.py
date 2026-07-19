"""
Cookie 池管理器 (单例).

提供两个核心接口:
- ``pick(platform)`` — 加权随机返回一条可用 cookie; 全失效返回 ``PickResult(status='empty')``.
- ``report_success(cookie_id) / report_failure(cookie_id, error_msg)`` — 下载器回调.

**重要**: pick() 不消费 cookie (只是「拿」); 上层必须自己捕获异常,
再决定是否调用 report_failure. 这是为了避免「上下文管理器里抛异常就回滚
使用计数」之类的副作用序列问题, 也方便 downloader 在重试 cookie 之间穿插
业务逻辑 (如记录 url / 选择不同音视频源).

为了让 downloader 代码更清晰, 提供 ``use_cookie()`` 上下文管理器:
    with pool.use_cookie('bilibili') as ctx:
        download(url, cookie_str=ctx.cookie_str)
        ctx.report_success()
"""
from __future__ import annotations

import logging
import os
import random
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Generator, List, Optional

from app.db import platform_cookie_dao

logger = logging.getLogger(__name__)

# 触发「cookie 通知」所需的连续失败次数. DAO 也会用同样的阈值.
DEFAULT_FAILURE_THRESHOLD = int(os.getenv("COOKIE_POOL_FAILURE_THRESHOLD", "3"))
# Cookie 池内存缓存 TTL. 后台修改后等够秒数才会被重新读到.
DEFAULT_CACHE_TTL_SECONDS = int(os.getenv("COOKIE_POOL_CACHE_TTL", "600"))


@dataclass
class PickResult:
    id: int
    name: str
    platform: str
    cookie: str  # 明文
    weight: int
    cookie_dict: dict  # 完整 DAO 输出, 便于 extend


@dataclass
class PickEmpty:
    platform: str


def _is_pick_result(x) -> bool:
    return isinstance(x, PickResult)


class _PoolSnapshot:
    """内存索引, 按平台分组存「可用」cookie + TTL."""
    def __init__(self, ttl: int = DEFAULT_CACHE_TTL_SECONDS):
        self._by_platform: dict = {}
        self._loaded_at: float = 0
        self._ttl = ttl
        self._lock = threading.RLock()

    def get(self, platform: str, tier: Optional[str] = None) -> Optional[List[dict]]:
        import time
        with self._lock:
            if time.time() - self._loaded_at > self._ttl:
                return None  # 过期
            return self._by_platform.get(platform)

    def set(self, platform: str, items: List[dict]) -> None:
        import time
        with self._lock:
            self._by_platform[platform] = items
            self._loaded_at = time.time()

    def invalidate(self) -> None:
        import time
        with self._lock:
            self._loaded_at = 0


class CookiePoolManager:
    """进程内单例 (顶层模块级变量)."""

    _instance: Optional["CookiePoolManager"] = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._snapshot = _PoolSnapshot()

    @classmethod
    def instance(cls) -> "CookiePoolManager":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def is_platform_exhausted(self, platform: str, *, tier: Optional[str] = None) -> bool:
        items = self._fetch(platform, tier=tier)
        return len(items) == 0

    def pick(self, platform: str, *, tier: Optional[str] = None):
        """加权随机抽一条可用 cookie. 全失效 / 不匹配 tier 返回 ``None``.
        pick 后会原子地 ``increment_in_use`` (+1), 满配额的 cookie 会被跳过.
        """
        items = self._fetch(platform, tier=tier)
        if not items:
            return None

        for _ in range(5):
            weights = [max(1, int(it.get("weight") or 100)) for it in items]
            chosen = random.choices(items, weights=weights, k=1)[0]
            ok = platform_cookie_dao.increment_in_use(chosen["id"])
            if ok:
                return PickResult(
                    id=chosen["id"],
                    name=chosen.get("name") or "",
                    platform=platform,
                    cookie=chosen.get("cookie") or "",
                    weight=chosen.get("weight") or 100,
                    cookie_dict=chosen,
                )
            # 配额满, 从候选中剔除
            items = [it for it in items if it["id"] != chosen["id"]]
            if not items:
                return None
        return None

    def pick_round(self, platform: str, max_attempts: int = 4, *, tier: Optional[str] = None):
        """pick + 在本次调用内避免重复抽到同一条 (用于「失败重试下一个 cookie」).
        注意: 这里不会调 increment_in_use — pick_round 是个轻量的"列举"接口,
        实际 in_use 计数由 ``use_cookie`` 的 pick() 内部完成.
        """
        items = self._fetch(platform, tier=tier)
        if not items:
            return None
        weights = [max(1, int(it.get("weight") or 100)) for it in items]
        # 从高到低权重里取前 max_attempts 个, 再随机; 不够就放宽.
        indexed = sorted(
            range(len(items)), key=lambda i: weights[i], reverse=True
        )
        ordered = [items[i] for i in indexed[:max_attempts]] or items

        for chosen_data in ordered:
            yield PickResult(
                id=chosen_data["id"],
                name=chosen_data.get("name") or "",
                platform=platform,
                cookie=chosen_data.get("cookie") or "",
                weight=chosen_data.get("weight") or 100,
                cookie_dict=chosen_data,
            )

    def report_success(self, cookie_id: int) -> None:
        try:
            platform_cookie_dao.increment_success(cookie_id)
        except Exception as e:
            logger.warning(f"[CookiePool] report_success failed for id={cookie_id}: {e}")
            return
        # 成功会重置状态, 让该 cookie 重新出现在可用列表
        self._snapshot.invalidate()

    def report_failure(
        self,
        cookie_id: int,
        *,
        error_msg: Optional[str] = None,
        publish_notification: bool = True,
        threshold: int = DEFAULT_FAILURE_THRESHOLD,
    ) -> bool:
        """
        返回: True 表示「本次失败导致 cookie 被标记为失效」.
        当 publish_notification=True 时, 第一次被标记失效会发出 cookie_failure 通知.
        """
        try:
            newly_invalid = platform_cookie_dao.increment_failure(
                cookie_id, threshold=threshold
            )
        except Exception as e:
            logger.warning(f"[CookiePool] report_failure failed for id={cookie_id}: {e}")
            return False

        # 一旦状态变更 (失效/恢复) 需要让下次 pick 重新拉取
        self._snapshot.invalidate()

        if newly_invalid and publish_notification:
            try:
                # 通知由 NotificationService 处理, 用我们的 DAO 里读字段
                row = platform_cookie_dao.get_by_id(cookie_id)
                if row:
                    from app.services.notification_service import NotificationService
                    NotificationService.publish_cookie_failure(
                        cookie_id=cookie_id,
                        platform=row.get("platform") or "",
                        cookie_name=row.get("name") or f"#{cookie_id}",
                        error_msg=error_msg or "",
                    )
            except Exception as e:
                logger.warning(f"[CookiePool] publish notification failed: {e}")
        return newly_invalid

    def reload(self) -> None:
        self._snapshot.invalidate()

    # ===== 内部 =====

    def _fetch(self, platform: str, *, tier: Optional[str] = None) -> List[dict]:
        cached = self._snapshot.get(platform, tier=tier)
        if cached is not None:
            return cached
        items = platform_cookie_dao.list_available(platform, tier=tier)
        self._snapshot.set(platform, items)
        return items

    # ===== downloader 上下文 =====

    @contextmanager
    def use_cookie(self, platform: str, *, tier: Optional[str] = None) -> Generator:
        """
        用法::

            with pool.use_cookie('bilibili') as ctx:
                if ctx.is_empty:
                    ...  # 池空, raise or return
                # 用 ctx.cookie_str 去做下载
                try:
                    download(url, cookie_str=ctx.cookie_str)
                except Exception as e:
                    if CookieFailureDetector.is_cookie_failure(str(e)):
                        ctx.report_failure(error_msg=str(e))
                    raise

        ``ctx`` 是 ``_CookieContext`` 的实例, 字段:
          - cookie_id, cookie_str, name, platform
          - report_success() — 显式标记本次 cookie 成功
          - report_failure(error_msg=None) — 显式标记本次 cookie 失败
          - is_empty — 池空时为 True, 其它字段都 None

        ``__exit__`` 兜底: 业务代码在 with 块内抛异常退出但没调
        report_success / report_failure 时, ctx 会**默认按失败**上报
        (防呆 — 否则失败会"悄悄" 飘走, 不累计也不发通知).
        想抑制此行为可用 ``ctx.suppress_auto_report()`` 关掉.

        ``tier`` 用于按用户等级过滤 (admin / vip / user); 传 None 视为全部.
        """
        picked = self.pick(platform, tier=tier)
        ctx = _CookieContext(self, platform, picked)
        try:
            yield ctx
        except BaseException as exc:
            # 把异常先存到 ctx, 留到 __exit__ 阶段判断要不要兜底上报
            ctx._exc = exc
            raise
        finally:
            ctx._finalize()


class _CookieContext:
    def __init__(self, pool: CookiePoolManager, platform: str, picked):
        self._pool = pool
        self.platform = platform
        self._picked = picked
        if picked is None:
            self.cookie_id = None
            self.cookie_str = None
            self.name = None
            self.is_empty = True
        else:
            self.cookie_id = picked.id
            self.cookie_str = picked.cookie
            self.name = picked.name
            self.is_empty = False
        # 内部状态
        self._reported: bool = False  # 已经手动调过 report_*
        self._auto_report_suppressed: bool = False
        self._exc: Optional[BaseException] = None

    def report_success(self) -> None:
        if self.is_empty or self._reported:
            return
        self._pool.report_success(self.cookie_id)
        self._reported = True

    def report_failure(self, error_msg: Optional[str] = None) -> bool:
        if self.is_empty or self._reported:
            return False
        result = self._pool.report_failure(
            self.cookie_id, error_msg=error_msg, publish_notification=True
        )
        self._reported = True
        return result

    def suppress_auto_report(self) -> None:
        """告诉 ctx: __exit__ 时不要再兜底上报 (例: 业务已显式处理了失败)."""
        self._auto_report_suppressed = True

    # ===== 内部 =====
    def _finalize(self) -> None:
        """with 退出时被调, 兜底处理"未 report 但抛异常"的情形."""
        if self.is_empty or self._reported or self._auto_report_suppressed:
            return
        if self._exc is None:
            # 正常退出且没 report — 可能是用户忘了调, 保守按成功处理 (不扣分也不加分).
            return
        # 有异常退出 + 没 report → 默认按失败上报一次
        try:
            self._pool.report_failure(
                self.cookie_id,
                error_msg=str(self._exc),
                publish_notification=True,
            )
        except Exception:
            pass
