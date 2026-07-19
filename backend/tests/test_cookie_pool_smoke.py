"""
脱离 DB 的纯单元测试 — 用 SQLite + 直连 engine.

跑法:
  cd backend
  python -m tests.test_cookie_pool_smoke -v

覆盖:
- CookieEncryption encrypt/decrypt 往返一致
- Fernet wrong-key decrypt → InvalidToken
- CookieFailureDetector 关键词 / HTTP 状态判定
- NotificationService.publish dedup 行为 (走 fake DAO, 不接真 DB)
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch


# === 让 import 不去真连 DB ===
# 真实 Notification / Base 仍在; 我们只 mock create_engine.
import sqlalchemy as _sa

_original_create_engine = _sa.create_engine


def _patched_create_engine(url, *args, **kwargs):
    # SQLite 不接受 max_overflow / pool_size / pool_pre_ping, 过滤掉
    url_str = str(url) if not isinstance(url, str) else url
    if url_str.startswith("sqlite"):
        for k in ("max_overflow", "pool_size", "pool_pre_ping"):
            kwargs.pop(k, None)
    return _original_create_engine(url, *args, **kwargs)


# 关键: sqlalchemy.create_engine 才是 engine.py 里 import 的那个.
# 我们同时 monkey-patch sqlalchemy.create_engine 和 sqlalchemy.engine.create.create_engine.
_sa.create_engine = _patched_create_engine
try:
    import sqlalchemy.engine.create as _sa_create_mod
    _sa_create_mod.create_engine = _patched_create_engine
except Exception:
    pass

# 一定要先设置环境变量再 sys.path, 否则 engine.py 启动会判断 DATABASE_URL 不存在.
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-for-tests-only-12345")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_tmpdir = tempfile.mkdtemp()
os.chdir(_tmpdir)


class TestCookieEncryption(unittest.TestCase):
    """不需要 SQLAlchemy, 测的是对称加密的纯逻辑."""

    def setUp(self):
        """直接给一个稳定 Fernet key, 避开 .env 读写 — 测试不依赖文件系统."""
        from cryptography.fernet import Fernet
        from app.utils import encryption

        # 重置类级 Fernet cache, 避免上一次测试泄漏.
        encryption.CookieEncryption._fernet = None
        # 固定测试用 key (44 字符 url-safe base64, 32 字节).
        self._test_key = Fernet.generate_key()
        encryption.CookieEncryption._fernet = Fernet(self._test_key)

    def test_roundtrip(self):
        from app.utils.encryption import CookieEncryption

        plain = "buvid3=abc; SESSDATA=def; DedeUserID=123"
        enc = CookieEncryption.encrypt(plain)
        self.assertNotEqual(enc, plain)
        self.assertEqual(CookieEncryption.decrypt(enc), plain)

    def test_repeated_encryptions_differ(self):
        """Fernet IV 随机, 同样 plaintext 每次密文不同."""
        from app.utils.encryption import CookieEncryption

        plain = "x=y"
        a = CookieEncryption.encrypt(plain)
        b = CookieEncryption.encrypt(plain)
        self.assertNotEqual(a, b)
        # 但都能解开成原文
        self.assertEqual(CookieEncryption.decrypt(a), plain)
        self.assertEqual(CookieEncryption.decrypt(b), plain)

    def test_empty_raises(self):
        from app.utils.encryption import CookieEncryption, CookieEncryptionError

        with self.assertRaises(CookieEncryptionError):
            CookieEncryption.encrypt(None)  # type: ignore

    def test_wrong_key_raises_invalid_token(self):
        from cryptography.fernet import Fernet, InvalidToken

        original = Fernet.generate_key()
        f1 = Fernet(original)
        ciphertext = f1.encrypt(b"hello world").decode("utf-8")

        other_key = Fernet.generate_key()
        f2 = Fernet(other_key)

        with self.assertRaises(InvalidToken):
            f2.decrypt(ciphertext.encode("utf-8"))


class TestCookieFailureDetector(unittest.TestCase):
    """纯函数, 不接 DB."""

    def test_http_status_codes(self):
        from app.services.cookie_failure_detector import CookieFailureDetector

        self.assertTrue(CookieFailureDetector.is_cookie_failure("", http_status=412))
        self.assertTrue(CookieFailureDetector.is_cookie_failure("", http_status=403))
        self.assertTrue(CookieFailureDetector.is_cookie_failure("", http_status=401))
        self.assertFalse(CookieFailureDetector.is_cookie_failure("", http_status=404))
        self.assertFalse(CookieFailureDetector.is_cookie_failure("", http_status=500))

    def test_keywords(self):
        from app.services.cookie_failure_detector import CookieFailureDetector

        for msg in [
            "Need login",
            "Sign in to continue",
            "登录后才能下载",
            "cloudflare challenge",
            "需要登录验证",
            "ERROR: cookie expired",
            "captcha required",
            "认证失败",
            "verify needed",
        ]:
            with self.subTest(msg=msg):
                self.assertTrue(
                    CookieFailureDetector.is_cookie_failure(msg),
                    f"should detect as cookie failure: {msg!r}",
                )

        for msg in [
            "video not found",
            "no subtitles available",
            "ffmpeg error",
            "openai rate limit",
            "context length exceeded",
        ]:
            with self.subTest(msg=msg):
                self.assertFalse(
                    CookieFailureDetector.is_cookie_failure(msg),
                    f"should NOT detect: {msg!r}",
                )

    def test_empty_msg(self):
        from app.services.cookie_failure_detector import CookieFailureDetector
        self.assertFalse(CookieFailureDetector.is_cookie_failure(""))


class TestPublishDedupKey(unittest.TestCase):
    """只测 NotificationService.publish 的 dedup_key 派生逻辑 + dedup 行为 (用 patch)."""

    def test_dedup_key_derivation(self):
        from app.services.notification_service import NotificationService

        captured = {}

        def fake_upsert_for_publish(**kwargs):
            captured.update(kwargs)
            row = MagicMockLite()
            for k in (
                "id", "dedup_key", "category", "severity", "title",
                "content", "source_type", "source_id", "platform",
                "first_seen_at", "last_seen_at", "occurrence_count",
                "status", "handler_note", "handled_by", "handled_at",
                "created_at", "updated_at",
            ):
                setattr(row, k, kwargs.get(k))
            return row, "created"

        import app.services.notification_service as ns
        ns.notification_dao.upsert_for_publish = fake_upsert_for_publish

        NotificationService.publish(
            category="cookie_failure",
            title="t",
            content="c",
            source_type="platform_cookie",
            source_id="42",
            platform="bilibili",
        )
        self.assertEqual(
            captured["dedup_key"], "cookie_failure:platform_cookie:42"
        )

    def test_publish_dedup_window_behavior(self):
        """60s 内重复 publish → 第 2 次是 'merged'."""
        from app.services.notification_service import NotificationService

        records = {}

        def fake_upsert(**kwargs):
            dk = kwargs["dedup_key"]
            now = datetime.now()
            if dk in records:
                if (now - records[dk]["last_seen_at"]) < timedelta(seconds=60):
                    records[dk]["last_seen_at"] = now
                    records[dk]["occurrence_count"] += 1
                    row = MagicMockLite()
                    for k, v in records[dk].items():
                        setattr(row, k, v)
                    return row, "merged"
                records[dk]["last_seen_at"] = now
                records[dk]["occurrence_count"] = 1
            else:
                records[dk] = {
                    "last_seen_at": now,
                    "occurrence_count": 1,
                    "category": kwargs["category"],
                    "severity": kwargs["severity"],
                    "title": kwargs["title"],
                    "content": kwargs["content"],
                    "source_type": kwargs["source_type"],
                    "source_id": kwargs.get("source_id"),
                    "platform": kwargs.get("platform"),
                    "dedup_key": dk,
                    "id": len(records) + 1,
                    "first_seen_at": now,
                    "handler_note": None,
                    "handled_by": None,
                    "handled_at": None,
                    "status": "pending",
                    "created_at": now,
                    "updated_at": now,
                }
            row = MagicMockLite()
            for k, v in records[dk].items():
                setattr(row, k, v)
            return row, "created"

        import app.services.notification_service as ns
        ns.notification_dao.upsert_for_publish = fake_upsert

        d1, s1 = NotificationService.publish(
            category="cookie_failure",
            title="x",
            content="y",
            source_type="platform_cookie",
            source_id="42",
            platform="bilibili",
        )
        d2, s2 = NotificationService.publish(
            category="cookie_failure",
            title="x",
            content="y2",
            source_type="platform_cookie",
            source_id="42",
            platform="bilibili",
        )
        self.assertEqual(s1, "created")
        self.assertEqual(s2, "merged")
        self.assertEqual(
            records["cookie_failure:platform_cookie:42"]["occurrence_count"],
            2,
        )

        # 不同 source_id 各自新建
        d3, s3 = NotificationService.publish(
            category="cookie_failure",
            title="x",
            content="y",
            source_type="platform_cookie",
            source_id="43",
            platform="bilibili",
        )
        self.assertEqual(s3, "created")
        self.assertEqual(len(records), 2)


class MagicMockLite:
    """轻量级 mock row, 允许 setattr."""
    pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
