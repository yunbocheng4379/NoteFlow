import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict


logger = logging.getLogger(__name__)


@dataclass
class CookieWithMeta:
    """cookie 字符串 + 来源元信息.

    Attributes:
        cookie: 明文 cookie (Netscape 格式), 失败时为 None
        cookie_id: 若来自 ``platform_cookies`` 池子, 这里填对应的 id; 否则为 None
        source: ``"pool"`` / ``"file"`` / ``"none"`` — 用于日志与上报路由
    """
    cookie: Optional[str]
    cookie_id: Optional[int]
    source: str


class CookieConfigManager:
    """Cookie 配置管理器 — 只读自「平台 Cookie 池」或 ``config/downloader.json`` 旧文件.

    历史:
    - 旧版有 ``user_cookies`` 表 (按用户隔离), 已被平台池取代, 2026-07-10 下线.
    - ``user_id`` 参数保留 (可选, 兼容历史调用方), 但不再影响读取路径.

    优先级 (从高到低):
      1. ``CookiePoolManager.platform_cookies`` — 池子里的多 cookie 共享池.
      2. ``config/downloader.json`` — legacy 文件 fallback.

    写入: 池子由 admin 后台维护, 业务代码不去写池, 也不写文件.
    """

    def __init__(self, filepath: str = "config/downloader.json", user_id: Optional[int] = None):
        # user_id 参数保留, 仅兼容旧调用方签名. 读取时不再区分用户.
        self.path = Path(filepath)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.user_id = user_id
        if not self.path.exists():
            self._write({})

    def _read(self) -> Dict[str, Dict[str, str]]:
        try:
            with self.path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write(self, data: Dict[str, Dict[str, str]]):
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _get_from_pool(self, platform: str) -> Optional[CookieWithMeta]:
        """优先从平台的 cookie 池里抽一条可用 cookie.
        池空 / 出错时返回 None, 让调用方继续走 fallback.
        """
        try:
            from app.services.cookie_pool_manager import CookiePoolManager
            picked = CookiePoolManager.instance().pick(platform)
            if picked is None:
                return None
            return CookieWithMeta(
                cookie=picked.cookie, cookie_id=picked.id, source="pool"
            )
        except Exception as e:
            logger.warning("[cookie] pool pick failed for %s: %s", platform, e)
            return None

    def get(self, platform: str) -> Optional[str]:
        """向后兼容: 只返回 cookie 字符串. 上报需要 cookie_id 时请改用 get_with_meta."""
        return self.get_with_meta(platform).cookie

    def get_with_meta(self, platform: str) -> CookieWithMeta:
        """返回 (cookie, cookie_id, source) 的完整元信息.

        优先级 (从高到低):
          1. ``platform_cookies`` 池子 — source='pool', 带 cookie_id
          2. ``config/downloader.json`` — source='file', cookie_id=None
        """
        from_pool = self._get_from_pool(platform)
        if from_pool:
            return from_pool

        data = self._read()
        legacy = data.get(platform, {}).get("cookie")
        return CookieWithMeta(cookie=legacy, cookie_id=None, source="file") if legacy \
            else CookieWithMeta(cookie=None, cookie_id=None, source="none")

    def list_all(self) -> Dict[str, str]:
        """列出所有可用 cookie. 优先用池 (pick 一条), 没有再退回文件."""
        result: Dict[str, str] = {}
        try:
            from app.db import platform_cookie_dao
            summary = platform_cookie_dao.summary_by_platform()
            for platform in summary.keys():
                from app.services.cookie_pool_manager import CookiePoolManager
                picked = CookiePoolManager.instance().pick(platform)
                if picked:
                    result[platform] = picked.cookie
        except Exception as e:
            logger.warning("[cookie] pool list_all failed: %s", e)

        # 文件路径补充
        for platform, payload in self._read().items():
            result.setdefault(platform, payload.get("cookie", ""))
        return result

    def exists(self, platform: str) -> bool:
        return self.get(platform) is not None
