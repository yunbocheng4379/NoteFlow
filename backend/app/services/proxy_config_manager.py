"""代理配置管理。

仅支持平台级代理（存 DB 表 platforms.proxy_url）。不再维护全局代理 JSON 文件。
每个平台独立配置代理，无值时不走代理（国内直连）。

环境变量兜底：HTTP_PROXY / HTTPS_PROXY / ALL_PROXY（大小写均认）。
"""

import os
import threading
from typing import Dict, Optional


class ProxyConfigManager:
    """平台级代理配置，来自 DB platforms 表，支持内存缓存."""

    _platform_proxy_cache: Dict[str, Optional[str]] = {}
    _cache_lock = threading.Lock()

    def get_proxy_url(self, platform: Optional[str] = None) -> Optional[str]:
        """返回当前生效的代理 URL；无值则返回 None。

        优先级：平台 DB 配置 > 环境变量（HTTP_PROXY / HTTPS_PROXY / ALL_PROXY）。
        """
        if platform:
            db_proxy = self._get_platform_proxy(platform)
            if db_proxy:
                return db_proxy

        for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
            val = os.environ.get(key)
            if val:
                return val
        return None

    @staticmethod
    def _get_platform_proxy(platform: str) -> Optional[str]:
        """从 DB platforms 表获取平台专属代理，带内存缓存."""
        with ProxyConfigManager._cache_lock:
            if platform in ProxyConfigManager._platform_proxy_cache:
                return ProxyConfigManager._platform_proxy_cache[platform]

        try:
            from app.db.engine import SessionLocal
            from app.db.platform_dao import PlatformDAO

            db = SessionLocal()
            try:
                dao = PlatformDAO(db)
                proxy = dao.get_proxy_url(platform)
                with ProxyConfigManager._cache_lock:
                    ProxyConfigManager._platform_proxy_cache[platform] = proxy
                return proxy
            finally:
                db.close()
        except Exception:
            return None

    @staticmethod
    def invalidate_platform_cache(platform: Optional[str] = None):
        """清除平台代理缓存。传 platform 则清除单个，不传则清除全部."""
        with ProxyConfigManager._cache_lock:
            if platform:
                ProxyConfigManager._platform_proxy_cache.pop(platform, None)
            else:
                ProxyConfigManager._platform_proxy_cache.clear()
