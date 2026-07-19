"""
平台配置的 DAO 层，提供 CRUD + 代理查询能力.
"""
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models.platforms import Platform


class PlatformDAO:
    def __init__(self, db: Session):
        self.db = db

    # ---- 查询 ----

    def get_all(self) -> list[Platform]:
        """返回所有平台，按 sort_order 升序."""
        stmt = select(Platform).order_by(Platform.sort_order.asc())
        return list(self.db.execute(stmt).scalars().all())

    def get_all_enabled(self) -> list[Platform]:
        """返回所有已启用的平台，按 sort_order 升序."""
        stmt = select(Platform).where(Platform.is_enabled == 1).order_by(Platform.sort_order.asc())
        return list(self.db.execute(stmt).scalars().all())

    def get_by_platform_id(self, platform_id: str) -> Optional[Platform]:
        """按 platform_id 精确查找."""
        stmt = select(Platform).where(Platform.platform_id == platform_id)
        return self.db.execute(stmt).scalars().first()

    def get_proxy_url(self, platform_id: str) -> Optional[str]:
        """返回该平台的专属代理（如果有），否则 None（走全局代理）."""
        p = self.get_by_platform_id(platform_id)
        if p and p.proxy_url:
            return p.proxy_url
        return None

    # ---- 增 ----

    def create(
        self,
        platform_id: str,
        name: str,
        icon_url: Optional[str] = None,
        proxy_url: Optional[str] = None,
        is_enabled: int = 1,
        sort_order: int = 0,
    ) -> Platform:
        p = Platform(
            platform_id=platform_id,
            name=name,
            icon_url=icon_url,
            proxy_url=proxy_url,
            is_enabled=is_enabled,
            sort_order=sort_order,
        )
        self.db.add(p)
        self.db.commit()
        self.db.refresh(p)
        return p

    # ---- 改 ----

    def update(
        self,
        platform_id: str,
        *,
        name: Optional[str] = None,
        icon_url: Optional[str] = None,
        proxy_url: Optional[str] = None,  # None=不修改, ""=清空
        is_enabled: Optional[int] = None,
        sort_order: Optional[int] = None,
    ) -> Optional[Platform]:
        p = self.get_by_platform_id(platform_id)
        if not p:
            return None
        if name is not None:
            p.name = name
        if icon_url is not None:
            p.icon_url = icon_url
        # proxy_url: None=不修改, ""=清空
        if proxy_url is not None:
            p.proxy_url = proxy_url or None
        if is_enabled is not None:
            p.is_enabled = is_enabled
        if sort_order is not None:
            p.sort_order = sort_order
        self.db.commit()
        self.db.refresh(p)
        return p

    # ---- 删 ----

    def delete(self, platform_id: str) -> bool:
        p = self.get_by_platform_id(platform_id)
        if not p:
            return False
        self.db.delete(p)
        self.db.commit()
        return True

    # ---- 批量初始化（仅当表为空时） ----

    def seed_default_if_empty(self) -> list[Platform]:
        """如果表为空，插入默认平台；返回当前所有平台."""
        if self.get_all():
            return self.get_all()
        defaults = [
            {"platform_id": "bilibili", "name": "哔哩哔哩", "sort_order": 10},
            {"platform_id": "youtube", "name": "YouTube", "sort_order": 20},
            {"platform_id": "douyin", "name": "抖音", "sort_order": 30},
            {"platform_id": "kuaishou", "name": "快手", "sort_order": 40},
        ]
        for d in defaults:
            self.create(**d)
        return self.get_all()
