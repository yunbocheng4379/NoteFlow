"""
用户级云盘 OAuth 凭据存储.

与 platform_cookies (管理员共享池) 不同, 此表是 per-user:
每个 NoteFlow 用户可以绑定自己的百度网盘账号, access_token / refresh_token
用 Fernet 加密后入库, 只在向网盘 API 发请求时短暂解密使用.

字段说明:
- ``expires_at``: access_token 的过期时间 (百度 access_token 通常 30 天),
  过期前调用 refresh_token 换新的; 若 refresh_token 也过期需要重新 OAuth 授权.
- ``account_name``: 展示给用户的账号昵称, 例如 "张三@baidu";
  从网盘 /getuinfo 拿, 只用于 UI 展示, 不参与鉴权.
- ``platform`` + ``user_id`` 唯一约束: 一个 NoteFlow 用户在同一网盘平台
  只能绑一个网盘账号 (再次登录覆盖旧凭据).
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint, func

from app.db.engine import Base


class CloudCredential(Base):
    """用户 OAuth 凭据 (百度网盘, 未来可扩展其他平台)."""
    __tablename__ = "cloud_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True, comment="绑定的 NoteFlow 用户 ID")
    platform = Column(
        String(32),
        nullable=False,
        comment="网盘平台标识, 目前只有 'baidu_pan'",
    )
    access_token_encrypted = Column(
        Text,
        nullable=False,
        comment="Fernet 加密后的 access_token",
    )
    refresh_token_encrypted = Column(
        Text,
        nullable=True,
        comment="Fernet 加密后的 refresh_token (百度返回, 用于自动续期)",
    )
    expires_at = Column(
        DateTime,
        nullable=True,
        comment="access_token 过期时间",
    )
    scope = Column(
        String(255),
        nullable=True,
        comment="授权范围, 例如 'basic,netdisk'",
    )
    account_name = Column(
        String(128),
        nullable=True,
        comment="用户网盘账号昵称, 仅 UI 展示",
    )
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "platform", name="uk_user_platform"),
    )
