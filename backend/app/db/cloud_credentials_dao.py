"""
用户网盘凭据 DAO.

关键方法:
- ``upsert_credential``: OAuth 成功后写入或覆盖 (同一用户 + 平台唯一)
- ``get_credential``: 读取指定用户 + 平台的凭据
- ``delete_credential``: 用户主动登出
- ``update_tokens``: refresh_token 换新时更新
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.db.models.cloud_credentials import CloudCredential


def upsert_credential(
    db: Session,
    *,
    user_id: int,
    platform: str,
    access_token_encrypted: str,
    refresh_token_encrypted: Optional[str],
    expires_at: Optional[datetime],
    scope: Optional[str],
    account_name: Optional[str] = None,
) -> CloudCredential:
    """OAuth 成功后调用. 如果已存在 (user_id, platform) 记录, 覆盖 token 字段."""
    row = (
        db.query(CloudCredential)
        .filter_by(user_id=user_id, platform=platform)
        .first()
    )
    if row:
        row.access_token_encrypted = access_token_encrypted
        row.refresh_token_encrypted = refresh_token_encrypted
        row.expires_at = expires_at
        row.scope = scope
        if account_name is not None:
            row.account_name = account_name
    else:
        row = CloudCredential(
            user_id=user_id,
            platform=platform,
            access_token_encrypted=access_token_encrypted,
            refresh_token_encrypted=refresh_token_encrypted,
            expires_at=expires_at,
            scope=scope,
            account_name=account_name,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_credential(
    db: Session, *, user_id: int, platform: str
) -> Optional[CloudCredential]:
    return (
        db.query(CloudCredential)
        .filter_by(user_id=user_id, platform=platform)
        .first()
    )


def update_tokens(
    db: Session,
    *,
    row: CloudCredential,
    access_token_encrypted: str,
    refresh_token_encrypted: Optional[str],
    expires_at: Optional[datetime],
) -> CloudCredential:
    """token 刷新后写回."""
    row.access_token_encrypted = access_token_encrypted
    if refresh_token_encrypted is not None:
        row.refresh_token_encrypted = refresh_token_encrypted
    row.expires_at = expires_at
    db.commit()
    db.refresh(row)
    return row


def delete_credential(db: Session, *, user_id: int, platform: str) -> bool:
    row = get_credential(db, user_id=user_id, platform=platform)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
