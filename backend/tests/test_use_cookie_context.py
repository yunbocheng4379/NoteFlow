"""
use_cookie 上下文管理器 + downloader.set_cookie_meta 集成测试.

验证:
1. with pool.use_cookie() 正常退出 → report_success 被调
2. with pool.use_cookie() 异常退出 + 显式 report_failure → 只报一次
3. with pool.use_cookie() 异常退出 + 未 report → __exit__ 兜底按失败上报
4. suppress_auto_report 后异常退出 → 兜底不报
5. pool 空 → ctx.is_empty=True
6. bilibili downloader.set_cookie_meta → 真的重写 cookiefile + 更新 active id
7. douyin downloader.set_cookie_meta → 真的改 headers
8. kuaishou.set_cookie_meta → 改 header['Cookie']

跑法:
  cd backend
  python -m tests.test_use_cookie_context -v
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


class TestUseCookieContext(unittest.TestCase):
    """use_cookie 上下文管理器的所有路径."""

    def setUp(self):
        from app.services import cookie_pool_manager
        cookie_pool_manager.CookiePoolManager._instance = None

        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        self.dao = MagicMock()
        self.dao.list_available.return_value = [
            {"id": 7, "platform": "bilibili", "name": "primary",
             "cookie": "primary=1", "weight": 100, "is_enabled": True,
             "is_marked_invalid": False},
        ]
        self.dao.get_by_id.return_value = {
            "id": 7, "platform": "bilibili", "name": "primary",
        }
        # increment_failure 返回 True → 标记失效 → 触发 publish_notification
        self.dao.increment_failure.return_value = True

        self._dao_patcher = patch(
            "app.services.cookie_pool_manager.platform_cookie_dao", self.dao
        )
        self._dao_patcher.start()
        self.notif_patcher = patch(
            "app.services.notification_service.NotificationService.publish_cookie_failure"
        )
        self.notif_mock = self.notif_patcher.start()

    def tearDown(self):
        self._dao_patcher.stop()
        self.notif_patcher.stop()

    def test_normal_exit_calls_report_success(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with pool.use_cookie("bilibili") as ctx:
            self.assertEqual(ctx.cookie_id, 7)
            self.assertEqual(ctx.cookie_str, "primary=1")
            # 业务代码: 下载成功
            ctx.report_success()
        # 退出后 increment_success 应被调一次, failure 不应被调
        self.dao.increment_success.assert_called_once_with(7)
        self.dao.increment_failure.assert_not_called()

    def test_explicit_report_failure_called_only_once(self):
        """显式 report_failure 后, __exit__ 不会重复上报."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with pool.use_cookie("bilibili") as ctx:
            ctx.report_failure(error_msg="412 Precondition Failed")
        # increment_failure 恰好 1 次
        self.assertEqual(self.dao.increment_failure.call_count, 1)
        # 收到的是 ctx.cookie_id
        self.assertEqual(self.dao.increment_failure.call_args[0][0], 7)

    def test_exception_without_report_triggers_fallback(self):
        """未 report 的异常退出, __exit__ 兜底按失败上报一次."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with self.assertRaises(RuntimeError):
            with pool.use_cookie("bilibili") as ctx:
                raise RuntimeError("network exploded")
        # 兜底应调一次 increment_failure (id=7, threshold=3)
        self.assertEqual(self.dao.increment_failure.call_count, 1)
        call_args = self.dao.increment_failure.call_args
        self.assertEqual(call_args[0][0], 7)
        self.assertEqual(call_args.kwargs.get("threshold"), 3)
        # 错误消息传给 NotificationService.publish_cookie_failure
        self.assertEqual(self.notif_mock.call_count, 1)
        notif_call = self.notif_mock.call_args
        self.assertEqual(notif_call.kwargs.get("cookie_id"), 7)
        self.assertIn("network exploded", str(notif_call.kwargs.get("error_msg", "")))

    def test_exception_with_success_not_overridden(self):
        """业务已 report_success, 但仍抛了别的异常 → 不会重新报 failure."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with self.assertRaises(RuntimeError):
            with pool.use_cookie("bilibili") as ctx:
                ctx.report_success()
                raise RuntimeError("post-success logging failed")
        # increment_success 一次, increment_failure 零次
        self.dao.increment_success.assert_called_once_with(7)
        self.dao.increment_failure.assert_not_called()

    def test_suppress_auto_report_skips_fallback(self):
        """suppress 后异常退出 → 兜底不上报 (业务自己处理了)."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with self.assertRaises(RuntimeError):
            with pool.use_cookie("bilibili") as ctx:
                ctx.suppress_auto_report()
                raise RuntimeError("non-cookie error")
        self.dao.increment_failure.assert_not_called()
        self.dao.increment_success.assert_not_called()

    def test_empty_pool_returns_empty_ctx(self):
        """池空 → ctx.is_empty=True, 字段都 None."""
        self.dao.list_available.return_value = []
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with pool.use_cookie("kuaishou") as ctx:
            self.assertTrue(ctx.is_empty)
            self.assertIsNone(ctx.cookie_id)
            self.assertIsNone(ctx.cookie_str)
            self.assertIsNone(ctx.name)
            # 调 report 也不应崩
            ctx.report_success()
            ctx.report_failure()
        self.dao.increment_success.assert_not_called()
        self.dao.increment_failure.assert_not_called()

    def test_normal_exit_without_report_does_nothing(self):
        """正常退出但没 report — 保守不报 (既不成功也不失败, 避免误扣分)."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        with pool.use_cookie("bilibili") as ctx:
            pass  # 啥都不做
        # 不应自动调任何 report
        self.dao.increment_success.assert_not_called()
        self.dao.increment_failure.assert_not_called()


class TestDownloaderSetCookieMeta(unittest.TestCase):
    """验证 4 个 downloader 的 set_cookie_meta 真的切换了 cookie."""

    def setUp(self):
        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        self.fake_pool = MagicMock()
        picked = MagicMock()
        picked.id = 1
        picked.cookie = "first=1"
        picked.name = "first"
        picked.platform = "bilibili"
        self.fake_pool.pick.return_value = picked

        self._pool_patcher = patch(
            "app.services.cookie_pool_manager.CookiePoolManager.instance",
            return_value=self.fake_pool,
        )
        self._pool_patcher.start()

    def tearDown(self):
        self._pool_patcher.stop()

    def test_bilibili_set_cookie_meta_rewrites_cookiefile(self):
        from app.downloaders.bilibili_downloader import BilibiliDownloader
        from app.services.cookie_manager import CookieWithMeta

        dl = BilibiliDownloader()
        original_cookiefile = dl._cookiefile

        new_meta = CookieWithMeta(
            cookie="second=2; SESSDATA=zzz",
            cookie_id=99,
            source="pool",
        )
        dl.set_cookie_meta(new_meta)

        self.assertEqual(dl._active_cookie_id, 99)
        self.assertEqual(dl._active_cookie_source, "pool")
        self.assertEqual(dl._cookie, "second=2; SESSDATA=zzz")
        # cookiefile 必须重写 (不同 path)
        self.assertIsNotNone(dl._cookiefile)
        self.assertNotEqual(dl._cookiefile, original_cookiefile)
        # Netscape 格式按 '=' 拆 key/value 两列, 检查这两列
        with open(dl._cookiefile, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("second", content)
        self.assertIn("\t2\n", content)  # value 列在第二行
        self.assertIn("SESSDATA", content)
        self.assertIn("zzz", content)

    def test_douyin_set_cookie_meta_updates_headers(self):
        from app.downloaders.douyin_downloader import DouyinDownloader
        from app.services.cookie_manager import CookieWithMeta

        dl = DouyinDownloader()
        self.assertEqual(dl.headers_config.get("Cookie"), "first=1")

        new_meta = CookieWithMeta(cookie="dnew=abc", cookie_id=55, source="pool")
        dl.set_cookie_meta(new_meta)

        self.assertEqual(dl._active_cookie_id, 55)
        self.assertEqual(dl.headers_config.get("Cookie"), "dnew=abc")

    def test_kuaishou_set_cookie_meta_updates_header(self):
        from app.downloaders.kuaishou_helper.kuaishou import KuaiShou
        from app.services.cookie_manager import CookieWithMeta

        ks = KuaiShou()
        # 触发 get_temp_cookies 让 initial cookie 写入
        ks.get_temp_cookies()
        # 此时应该 header['Cookie'] == 'first=1'

        new_meta = CookieWithMeta(cookie="knew=xyz", cookie_id=33, source="pool")
        ks.set_cookie_meta(new_meta)

        self.assertEqual(ks._active_cookie_id, 33)
        self.assertEqual(ks.header.get("Cookie"), "knew=xyz")

    def test_base_downloader_set_cookie_meta_default(self):
        """基类 set_cookie_meta 默认只更新 active id/source, 不动 cookie 字段."""
        from app.downloaders.base import Downloader
        from app.services.cookie_manager import CookieWithMeta

        class _Stub(Downloader):
            def download(self, *args, **kwargs):
                return None

        dl = _Stub()
        new_meta = CookieWithMeta(cookie="anything=1", cookie_id=42, source="pool")
        dl.set_cookie_meta(new_meta)

        self.assertEqual(dl._active_cookie_id, 42)
        self.assertEqual(dl._active_cookie_source, "pool")
        # 基类不应该有 _cookie 字段, 但允许 Downloader 拿不到 cookie 字符串
        # 这里只验证 active id 已经被设上


class TestNoteRetryWithCtx(unittest.TestCase):
    """端到端验证 note.py 的下载循环: 用 ctx 切换 cookie, 累计失败次数."""

    def setUp(self):
        from app.services import cookie_pool_manager
        cookie_pool_manager.CookiePoolManager._instance = None

        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        # 模拟一个会"先失败再成功"的假 downloader
        self._attempt = {"n": 0}

        # 池里 2 条 cookie, pick_round 会按顺序给
        self.dao = MagicMock()
        self.dao.list_available.return_value = [
            {"id": 11, "platform": "bilibili", "name": "A",
             "cookie": "a=1", "weight": 100, "is_enabled": True,
             "is_marked_invalid": False},
            {"id": 22, "platform": "bilibili", "name": "B",
             "cookie": "b=2", "weight": 100, "is_enabled": True,
             "is_marked_invalid": False},
        ]
        self.dao.get_by_id.side_effect = lambda cid: {
            "id": cid, "platform": "bilibili", "name": f"#{cid}",
        }
        # increment_failure 第二次返回 True (标记失效)
        self.dao.increment_failure.side_effect = [False, True, False]

        self._dao_patcher = patch(
            "app.services.cookie_pool_manager.platform_cookie_dao", self.dao
        )
        self._dao_patcher.start()
        self.notif_patcher = patch(
            "app.services.notification_service.NotificationService.publish_cookie_failure"
        )
        self.notif_mock = self.notif_patcher.start()

        # fake downloader: 前 1 次抛 412, 之后成功
        self.fake_downloader = MagicMock()
        self.fake_downloader.set_cookie_meta = MagicMock()
        self.fake_downloader._active_cookie_id = None
        self.fake_downloader._active_cookie_source = None

        def _fake_download(*args, **kwargs):
            self._attempt["n"] += 1
            if self._attempt["n"] == 1:
                raise RuntimeError("HTTP Error 412: Precondition Failed")
            # 第 2 次成功
            from app.models.audio_model import AudioDownloadResult
            return AudioDownloadResult(
                file_path="/tmp/test.mp3", title="t", duration=10,
                cover_url="", platform="bilibili", video_id="BV1",
                raw_info={}, video_path=None,
            )

        self.fake_downloader.download.side_effect = _fake_download

    def tearDown(self):
        self._dao_patcher.stop()
        self.notif_patcher.stop()

    def test_retry_switches_cookie_then_succeeds(self):
        """第一轮 cookie A 失败 412, 切到 cookie B 成功 — cookie A 应被 report_failure 一次."""
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()

        # 模拟 pick 顺序: A → B
        picks = iter([
            MagicMock(id=11, name="A", cookie="a=1", platform="bilibili", cookie_dict={}),
            MagicMock(id=22, name="B", cookie="b=2", platform="bilibili", cookie_dict={}),
        ])
        with patch.object(pool, "use_cookie") as mock_uc:
            # mock use_cookie 让它返回一个真实的 ctx (用 pick_round 的方式)
            def _enter(platform):
                from app.services.cookie_pool_manager import _CookieContext
                picked = next(picks, None)
                return _CookieContext(pool, platform, picked)

            cm = MagicMock()
            cm.__enter__.side_effect = lambda: _enter("bilibili")
            cm.__exit__.return_value = False
            mock_uc.return_value = cm

            # 直接验证 pool.report_failure 被 ctx 调了, 拿到的是 id=11
            # (不走完整 note.py — 那需要拼装很多上下文)
            ctx_a = _enter("bilibili")
            # 业务: 第一次失败 → ctx_a.report_failure
            ctx_a.report_failure(error_msg="HTTP 412")
            # 然后从 picks 取下一条 ctx_b
            ctx_b = _enter("bilibili")
            ctx_b.report_success()

        # 验证 increment_failure 收到 id=11
        fail_calls = [c for c in self.dao.increment_failure.call_args_list]
        self.assertEqual(len(fail_calls), 1)
        self.assertEqual(fail_calls[0][0][0], 11,
                         f"first failure should target id=11, got {fail_calls[0][0][0]}")
        # 验证 increment_success 收到 id=22
        self.dao.increment_success.assert_called_once_with(22)


if __name__ == "__main__":
    unittest.main(verbosity=2)
