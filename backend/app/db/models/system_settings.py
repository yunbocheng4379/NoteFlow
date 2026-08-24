"""System-wide key/value settings managed by administrators."""

from sqlalchemy import Column, DateTime, Integer, String, Text, func

from app.db.engine import Base


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(128), primary_key=True, comment="系统配置键")
    value = Column(Text, nullable=True, comment="系统配置值，可存储 JSON")
    updated_by = Column(Integer, nullable=True, comment="最近更新管理员 ID")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
