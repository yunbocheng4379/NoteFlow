"""
平台状态相关异常与工具函数.
"""


class PlatformDisabledError(Exception):
    """平台已被管理员禁用."""

    def __init__(self, platform: str, platform_name: str | None = None):
        self.platform = platform
        self.platform_name = platform_name or platform
        self.message = f"{self.platform_name} 当前已暂停服务，请稍后再试或联系管理员"
        super().__init__(self.message)


def check_platform_enabled(platform: str) -> None:
    """
    检查平台是否已启用。未启用则抛出 PlatformDisabledError。

    读取 platforms 表 is_enabled 字段，仅对非 local 平台做检查。
    """
    if platform == "local":
        return
    from app.db.engine import SessionLocal
    from app.db.models.platforms import Platform

    db = SessionLocal()
    try:
        row = db.query(Platform).filter(Platform.platform_id == platform).first()
        if row is None:
            return
        if not row.is_enabled:
            raise PlatformDisabledError(platform=platform, platform_name=row.name)
    finally:
        db.close()
