"""
Cookie 池集成测试 — 验证 downloader 持有的 ``_active_cookie_id``
能被精确上报到 ``platform_cookie_dao`` 并触发自动失效.

这个测试不依赖真实业务代码的 downloader 链路, 直接用 ``CookiePoolManager`` +
``platform_cookie_dao`` 验证核心契约.

跑法:
  cd backend
  python -m tests.test_cookie_id_reporting -v
"""
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch


# === 同 smoke test: 避开 SQLite pool 兼容问题 ===
import sqlalchemy as _sa

_original_create_engine = _sa.create_engine


def _patched_create_engine(url, *args, **kwargs):
    url_str = str(url) if not isinstance(url, str) else url
    if url_str.startswith("sqlite"):
        for k in ("max_overflow", "pool_size", "pool_pre_ping"):
            kwargs.pop(k, None)
    return _original_create_engine(url, *args, **kwargs)


_sa.create_engine = _patched_create_engine
try:
    import sqlalchemy.engine.create as _sa_create_mod
    _sa_create_mod.create_engine = _patched_create_engine
except Exception:
    pass


os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-for-tests-only-12345")
os.environ.setdefault("COOKIE_POOL_FAILURE_THRESHOLD", "3")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_tmpdir = tempfile.mkdtemp()
os.chdir(_tmpdir)


class TestCookieIdReporting(unittest.TestCase):
    """验证: report_failure(cookie_id=X) 会真的让 X 的 failure_count 增长,
    达到阈值后 is_marked_invalid 变为 True."""

    def setUp(self):
        # 重置单例, 避免上一次测试的缓存.
        from app.services import cookie_pool_manager
        cookie_pool_manager.CookiePoolManager._instance = None

        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        # 用假的 platform_cookie_dao, 不真连 DB.
        # 我们要观察调用序列: increment_failure(cookie_id, threshold) 是否用了正确的 id.
        self.dao = MagicMock()
        self.dao.list_available.return_value = [
            {"id": 1, "platform": "bilibili", "name": "A",
             "cookie": "a=1", "weight": 100, "is_enabled": True, "is_marked_invalid": False},
            {"id": 2, "platform": "bilibili", "name": "B",
             "cookie": "b=2", "weight": 100, "is_enabled": True, "is_marked_invalid": False},
        ]
        self.dao.get_by_id.return_value = {
            "id": 1, "platform": "bilibili", "name": "A",
        }
        # 默认: increment_failure 返回 False (还没到阈值).
        self.dao.increment_failure.return_value = False

        self._dao_patcher = patch(
            "app.services.cookie_pool_manager.platform_cookie_dao", self.dao
        )
        self._dao_patcher.start()

        # NotificationService.publish_cookie_failure 也不要真发通知.
        self._notif_patcher = patch(
            "app.services.notification_service.NotificationService.publish_cookie_failure"
        )
        self._notif_patcher.start()

    def tearDown(self):
        self._dao_patcher.stop()
        self._notif_patcher.stop()

    def test_pick_returns_cookie_id(self):
        """pick() 必须返回真实 id, downloader 才能在失败时上报给具体那条."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        picked = pool.pick("bilibili")
        self.assertIsNotNone(picked)
        self.assertIn(picked.id, (1, 2))
        # 明文 cookie 也得有, downloader 写入文件用.
        self.assertTrue(picked.cookie)
        self.assertEqual(picked.platform, "bilibili")

    def test_report_failure_uses_real_cookie_id(self):
        """模拟 downloader 失败 → 拿到 picked.id, 调 report_failure(id).
        验证 dao.increment_failure 收到的 cookie_id 等于 downloader 拿到的 id,
        而不是 None 或 0.
        """
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        picked = pool.pick("bilibili")
        self.assertIsNotNone(picked)

        # downloader 的失败处理
        pool.report_failure(
            cookie_id=picked.id,
            error_msg="HTTP 412 Precondition Failed",
            publish_notification=False,
            threshold=3,
        )
        # 验证 dao 收到的是 picked.id
        call_args = self.dao.increment_failure.call_args
        self.assertEqual(call_args[0][0], picked.id,
                         f"increment_failure 收到的 id={call_args[0][0]} 不等于 picked.id={picked.id}")
        # threshold 也传了
        self.assertEqual(call_args[1].get("threshold"), 3)

    def test_repeated_failures_eventually_mark_invalid(self):
        """连续 N 次 (阈值=3) 失败 → dao.increment_failure 最终返回 True."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        picked = pool.pick("bilibili")
        self.assertIsNotNone(picked)

        # 模拟: 前两次 False, 第三次 True
        side_effects = [False, False, True]
        self.dao.increment_failure.side_effect = side_effects

        # 第 1 次
        r1 = pool.report_failure(cookie_id=picked.id, error_msg="412",
                                 publish_notification=True, threshold=3)
        self.assertFalse(r1)
        # 第 2 次
        r2 = pool.report_failure(cookie_id=picked.id, error_msg="412",
                                 publish_notification=True, threshold=3)
        self.assertFalse(r2)
        # 第 3 次 — 应该 is_marked_invalid = True
        r3 = pool.report_failure(cookie_id=picked.id, error_msg="412",
                                 publish_notification=True, threshold=3)
        self.assertTrue(r3, "第 3 次失败后应该返回 True (被标记为失效)")

    def test_pick_skips_invalid_cookies(self):
        """被标记为失效的 cookie 不会再出现在 list_available 里."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()

        # 第 1 次: 两个 cookie 都可用
        items1 = pool._fetch("bilibili")
        self.assertEqual(len(items1), 2)

        # 模拟: cookie id=1 失效, list_available 不再返回它
        self.dao.list_available.return_value = [
            {"id": 2, "platform": "bilibili", "name": "B",
             "cookie": "b=2", "weight": 100, "is_enabled": True, "is_marked_invalid": False},
        ]
        # 失效后需要 reload
        pool.reload()
        items2 = pool._fetch("bilibili")
        self.assertEqual(len(items2), 1)
        self.assertEqual(items2[0]["id"], 2)

    def test_get_with_meta_returns_cookie_id_from_pool(self):
        """CookieConfigManager.get_with_meta 走池子时, cookie_id 必须非空."""
        from app.services import cookie_manager

        # pool 已在 setUp 被 patch, 直接调 get_with_meta 即可
        mgr = cookie_manager.CookieConfigManager(user_id=None)
        meta = mgr.get_with_meta("bilibili")
        self.assertIsNotNone(meta.cookie, "应该有 cookie 明文")
        self.assertIsNotNone(meta.cookie_id, f"应该有 cookie_id, 实际: {meta.cookie_id}")
        self.assertEqual(meta.source, "pool")
        self.assertIn(meta.cookie_id, (1, 2))

    def test_get_with_meta_falls_back_to_none_source(self):
        """池子空 + 都没配 → source='none', cookie=None, cookie_id=None."""
        self.dao.list_available.return_value = []
        from app.services import cookie_manager
        with patch.object(cookie_manager.CookieConfigManager, "_get_from_pool", return_value=None), \
             patch.object(cookie_manager.CookieConfigManager, "_read", return_value={}):
            mgr = cookie_manager.CookieConfigManager(user_id=None)
            meta = mgr.get_with_meta("kuaishou")
            self.assertIsNone(meta.cookie)
            self.assertIsNone(meta.cookie_id)
            self.assertEqual(meta.source, "none")

    def test_report_success_resets_state(self):
        """成功会调 dao.increment_success(cookie_id) 而不是 failure."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        picked = pool.pick("bilibili")
        self.assertIsNotNone(picked)

        pool.report_success(picked.id)
        # 验证调的是 increment_success
        self.dao.increment_success.assert_called_once_with(picked.id)
        # 失败计数 DAO 不会被调用
        self.dao.increment_failure.assert_not_called()

    def test_report_failure_with_invalid_id_does_not_crash(self):
        """传入不存在的 cookie_id → dao 抛错, 不应让上层崩, 静默 warn."""
        self.dao.increment_failure.side_effect = Exception("no such id")
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        # 不应抛
        result = pool.report_failure(cookie_id=999, error_msg="412",
                                     publish_notification=False, threshold=3)
        self.assertFalse(result)


class TestDownloaderActiveCookieId(unittest.TestCase):
    """验证: 4 个 downloader 在 __init__ 后都把 _active_cookie_id 设上了."""

    def setUp(self):
        # 准备一个固定的 pool mock
        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        self.fake_pool = MagicMock()
        picked = MagicMock()
        picked.id = 42
        picked.cookie = "fake_cookie=value"
        picked.name = "fake"
        picked.platform = "bilibili"
        self.fake_pool.pick.return_value = picked

        # Patch CookiePoolManager.instance() 用我们的 fake
        # 注: cookie_manager 用 lazy import, 真正访问的路径是
        # app.services.cookie_pool_manager.CookiePoolManager
        self._pool_patcher = patch(
            "app.services.cookie_pool_manager.CookiePoolManager.instance",
            return_value=self.fake_pool,
        )
        self._pool_patcher.start()

    def tearDown(self):
        self._pool_patcher.stop()

    def test_bilibili_downloader_records_cookie_id(self):
        from app.downloaders.bilibili_downloader import BilibiliDownloader
        dl = BilibiliDownloader()
        self.assertEqual(dl._active_cookie_id, 42,
                         f"bilibili downloader 应当记录 _active_cookie_id=42, 实际: {dl._active_cookie_id}")
        self.assertEqual(dl._active_cookie_source, "pool")
        self.assertEqual(dl._cookie, "fake_cookie=value")

    def test_bilibili_subtitle_records_cookie_id(self):
        from app.downloaders.bilibili_subtitle import BilibiliSubtitleFetcher
        fetcher = BilibiliSubtitleFetcher()
        self.assertEqual(fetcher._active_cookie_id, 42)
        self.assertEqual(fetcher._active_cookie_source, "pool")
        self.assertEqual(fetcher._cookie, "fake_cookie=value")

    def test_douyin_downloader_records_cookie_id(self):
        from app.downloaders.douyin_downloader import DouyinDownloader
        dl = DouyinDownloader()
        self.assertEqual(dl._active_cookie_id, 42)
        self.assertEqual(dl._active_cookie_source, "pool")
        self.assertEqual(dl.headers_config.get("Cookie"), "fake_cookie=value")

    def test_kuaishou_helper_records_cookie_id(self):
        # kuaishou helper 在 get_temp_cookies 时才取 cookie, 实例化时不取
        from app.downloaders.kuaishou_helper.kuaishou import KuaiShou
        ks = KuaiShou()
        ks.get_temp_cookies()  # 触发 cookie 拉取
        self.assertEqual(ks._active_cookie_id, 42)
        self.assertEqual(ks._active_cookie_source, "pool")


if __name__ == "__main__":
    unittest.main(verbosity=2)
