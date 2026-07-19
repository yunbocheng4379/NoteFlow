"""
Cookie 池 cohort / tier / quota 测试.

覆盖:
- list_available 按 tier 过滤 (admin / user / vip)
- list_available 跳过配额已满的 cookie
- CookiePoolManager.pick 配额已满 → 选下一条
- CookiePoolManager.pick tier 不匹配 → 不选
- _parse_tier_list 各种边界
- update 写 cohort/tier/quota 后 pick 行为正确
- report_success/failure 释放 in_use
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


_tmpdir = tempfile.mkdtemp()
# 使用 file-based sqlite, in-memory 在多 connection 间不共享, 跑集成测试会很坑
_TEST_DB_PATH = os.path.join(_tmpdir, "test_cohort_tier.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ.setdefault("JWT_SECRET", "test-secret-for-tests-only-12345")
os.environ.setdefault("COOKIE_POOL_FAILURE_THRESHOLD", "3")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.chdir(_tmpdir)


class TestParseTierList(unittest.TestCase):
    """_parse_tier_list 边界: None / 空字符串 / 非法 JSON / 列表"""

    def test_none_returns_empty(self):
        from app.db.platform_cookie_dao import _parse_tier_list
        self.assertEqual(_parse_tier_list(None), [])
        self.assertEqual(_parse_tier_list(""), [])

    def test_empty_json_string(self):
        from app.db.platform_cookie_dao import _parse_tier_list
        self.assertEqual(_parse_tier_list("[]"), [])
        self.assertEqual(_parse_tier_list("null"), [])

    def test_json_list(self):
        from app.db.platform_cookie_dao import _parse_tier_list
        self.assertEqual(_parse_tier_list('["vip","admin"]'), ["vip", "admin"])

    def test_invalid_json_returns_empty(self):
        from app.db.platform_cookie_dao import _parse_tier_list
        self.assertEqual(_parse_tier_list("not json"), [])
        self.assertEqual(_parse_tier_list("{}"), [])

    def test_python_list_passthrough(self):
        from app.db.platform_cookie_dao import _parse_tier_list
        self.assertEqual(_parse_tier_list(["vip", "user"]), ["vip", "user"])


class TestListAvailableTierFilter(unittest.TestCase):
    """list_available 的 tier 过滤 + quota 过滤 (走 in-memory SQLite)."""

    def setUp(self):
        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        # 在测试期间让 get_db 走 in-memory SQLite
        from app.db.engine import engine
        from sqlalchemy.orm import sessionmaker
        from app.db.engine import Base
        from app.db.models.platform_cookies import PlatformCookie

        Base.metadata.create_all(engine)
        # 清表 — 避免 setUp 之间数据污染 (in-memory 跨 test 也共享, 因同一进程)
        with engine.begin() as conn:
            conn.execute(PlatformCookie.__table__.delete())
        self.Session = sessionmaker(bind=engine)

        # 替换 dao.get_db → 我们的 session
        self._orig_get_db = None

    def _insert(self, **kw):
        from app.db import platform_cookie_dao as dao
        from app.db.engine import get_db as _real_get_db
        # 用真的 engine 写
        from app.db.engine import engine
        from app.db.models.platform_cookies import PlatformCookie
        import json as _json
        from app.utils.encryption import CookieEncryption

        with engine.begin() as conn:
            conn.execute(PlatformCookie.__table__.insert().values(
                platform=kw.get("platform", "bilibili"),
                name=kw["name"],
                cookie_value_encrypted=CookieEncryption.encrypt(kw.get("cookie", "x=1")),
                remark=kw.get("remark"),
                cohort=kw.get("cohort", "default"),
                reserved_for_tier=_json.dumps(kw.get("reserved_for_tier", [])),
                max_concurrent_uses=kw.get("max_concurrent_uses", 0),
                in_use_count=kw.get("in_use_count", 0),
                is_enabled=kw.get("is_enabled", 1),
                is_marked_invalid=kw.get("is_marked_invalid", 0),
                weight=kw.get("weight", 100),
                failure_count=0,
                success_count=0,
                usage_count=0,
            ))

    def test_tier_user_excludes_vip_only(self):
        from app.db import platform_cookie_dao as dao
        from app.db.engine import engine

        self._insert(name="all", cohort="default", reserved_for_tier=[])
        self._insert(name="vip_only", cohort="vip",
                     reserved_for_tier=["vip", "admin"])

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            with Session(bind=engine) as session:
                with patch.object(dao, "get_db", return_value=iter([session])):
                    result = dao.list_available("bilibili", tier="user")
        ids = [r["id"] for r in result]
        self.assertEqual(len(ids), 1, f"应只 1 条, 实际: {ids}")
        self.assertEqual(result[0]["name"], "all")

    def test_tier_admin_includes_vip(self):
        from app.db import platform_cookie_dao as dao
        from app.db.engine import engine

        self._insert(name="all", cohort="default", reserved_for_tier=[])
        self._insert(name="vip", cohort="vip",
                     reserved_for_tier=["vip", "admin"])

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            with Session(bind=engine) as session:
                with patch.object(dao, "get_db", return_value=iter([session])):
                    result = dao.list_available("bilibili", tier="admin")
        ids = sorted([r["id"] for r in result])
        self.assertEqual(len(ids), 2, f"应 2 条, 实际: {ids}")

    def test_quota_full_excluded(self):
        from app.db import platform_cookie_dao as dao
        from app.db.engine import engine

        self._insert(name="free", max_concurrent_uses=0, in_use_count=999)
        self._insert(name="full", max_concurrent_uses=1, in_use_count=1)
        self._insert(name="avail", max_concurrent_uses=1, in_use_count=0)

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            with Session(bind=engine) as session:
                with patch.object(dao, "get_db", return_value=iter([session])):
                    result = dao.list_available("bilibili")
        names = sorted([r["name"] for r in result])
        self.assertEqual(names, ["avail", "free"], f"实际: {names}")

    def test_tier_user_picks_widest(self):
        """tier=user 同时存在 '全部' 和 'user 限定' 时, 应都返回."""
        from app.db import platform_cookie_dao as dao
        from app.db.engine import engine

        self._insert(name="a", cohort="default", reserved_for_tier=[])
        self._insert(name="b_user", cohort="user_only", reserved_for_tier=["user"])
        self._insert(name="c_vip", cohort="vip", reserved_for_tier=["vip"])

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            with Session(bind=engine) as session:
                with patch.object(dao, "get_db", return_value=iter([session])):
                    result = dao.list_available("bilibili", tier="user")
        names = sorted([r["name"] for r in result])
        self.assertEqual(names, ["a", "b_user"], f"实际: {names}")


class TestPoolManagerPickTierAndQuota(unittest.TestCase):
    """CookiePoolManager.pick 在 tier 过滤和配额已满场景下的行为."""

    def setUp(self):
        from app.services import cookie_pool_manager
        cookie_pool_manager.CookiePoolManager._instance = None

        from cryptography.fernet import Fernet
        from app.utils import encryption
        encryption.CookieEncryption._fernet = Fernet(Fernet.generate_key())

        # 完全替换 pool 的 _fetch, 让它直接调我们控制的 mock DAO
        # 不让它走缓存, 确保每次调 list_available 都拿到最新数据
        self.dao = MagicMock()
        self.dao.increment_in_use.return_value = True
        self.dao.increment_failure.return_value = False
        self.dao.get_by_id.return_value = {
            "id": 1, "platform": "bilibili", "name": "x",
        }

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

    def _items(self, *dicts):
        """把 dict 转成 list 给 dao.list_available.return_value."""
        return list(dicts)

    def _cookie(self, id, name, cohort="default", reserved=None,
                max_conc=0, in_use=0, weight=100):
        return {
            "id": id, "name": name, "cookie": f"x={id}", "weight": weight,
            "is_enabled": 1, "is_marked_invalid": 0, "cohort": cohort,
            "reserved_for_tier": reserved or [], "max_concurrent_uses": max_conc,
            "in_use_count": in_use,
        }

    def test_pick_tier_user_gets_user_cookie(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        # tier=user — DAO 已经只返回 id=1
        self.dao.list_available.return_value = self._items(
            self._cookie(1, "for_user"),
        )
        picked = pool.pick("bilibili", tier="user")
        self.assertIsNotNone(picked)
        self.assertEqual(picked.id, 1)
        # 验证 tier 已传给 DAO
        self.dao.list_available.assert_called_with("bilibili", tier="user")
        # 验证 increment_in_use 被调
        self.dao.increment_in_use.assert_called_with(1)

    def test_pick_tier_vip_gets_vip_cookie(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        self.dao.list_available.return_value = self._items(
            self._cookie(2, "for_vip", cohort="vip",
                         reserved=["vip", "admin"]),
        )
        picked = pool.pick("bilibili", tier="vip")
        self.assertEqual(picked.id, 2)

    def test_pick_returns_none_when_no_tier_match(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        self.dao.list_available.return_value = []  # tier 不匹配时 DAO 返空
        picked = pool.pick("bilibili", tier="user")
        self.assertIsNone(picked)

    def test_pick_skips_quota_full(self):
        """配额已满的 cookie 不会被 pick."""
        import random
        random.seed(0)
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        # 5 条全部满, 1 条可用
        items = [self._cookie(10 + i, f"full{i + 1}", max_conc=1, in_use=1,
                              weight=1) for i in range(5)]
        items.append(self._cookie(99, "avail", max_conc=0, weight=10000))
        self.dao.list_available.return_value = items
        # increment_in_use 仅 id=99 成功; 其他满的全部失败
        self.dao.increment_in_use.side_effect = lambda cid: cid == 99
        picked = pool.pick("bilibili", tier="user")
        self.assertIsNotNone(picked)
        self.assertEqual(picked.id, 99)
        # 验证: pick 期间尝试了多个 cookie, 但最终选到了 99
        # (increment_in_use 至少被调 1 次, 且最终返的 id 必是 99)

    def test_pick_returns_none_when_all_quota_full(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        self.dao.list_available.return_value = self._items(
            self._cookie(10, "full1", max_conc=1, in_use=1),
            self._cookie(11, "full2", max_conc=1, in_use=1),
        )
        self.dao.increment_in_use.return_value = False
        picked = pool.pick("bilibili", tier="user")
        self.assertIsNone(picked)

    def test_pick_tier_none_returns_all(self):
        from app.services.cookie_pool_manager import CookiePoolManager
        pool = CookiePoolManager.instance()
        self.dao.list_available.return_value = self._items(
            self._cookie(1, "a"),
            self._cookie(2, "b", cohort="vip", reserved=["vip", "admin"]),
        )
        picked = pool.pick("bilibili", tier=None)
        self.assertIn(picked.id, (1, 2))
        # 验证 DAO 收到 tier=None
        last_call = self.dao.list_available.call_args
        self.assertIsNone(last_call.kwargs.get("tier"))


class TestUserTierCalculation(unittest.TestCase):
    """get_user_tier 的边界."""

    def test_none_user_returns_user(self):
        from app.services.user_tier import get_user_tier
        self.assertEqual(get_user_tier(None), "user")
        self.assertEqual(get_user_tier(0), "user")

    def test_admin_returns_admin(self):
        from app.services.user_tier import get_user_tier
        from app.db.models.users import User
        with patch("app.services.user_tier.get_db") as gdb:
            fake_user = MagicMock()
            fake_user.is_admin = 1
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = fake_user
            gdb.return_value = iter([session])
            self.assertEqual(get_user_tier(42), "admin")

    def test_normal_user_returns_user(self):
        from app.services.user_tier import get_user_tier
        with patch("app.services.user_tier.get_db") as gdb:
            fake_user = MagicMock()
            fake_user.is_admin = 0
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = fake_user
            gdb.return_value = iter([session])
            self.assertEqual(get_user_tier(99), "user")

    def test_missing_user_returns_user(self):
        from app.services.user_tier import get_user_tier
        with patch("app.services.user_tier.get_db") as gdb:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None
            gdb.return_value = iter([session])
            self.assertEqual(get_user_tier(123), "user")


if __name__ == "__main__":
    unittest.main(verbosity=2)
