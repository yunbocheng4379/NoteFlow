"""
云盘 token 生命周期管理.

职责:
- 从 DB 读加密的 access_token, 解密后返回
- 如果 token 快过期, 自动用 refresh_token 换新的并写回 DB
- 提供统一的 ensure_valid_token(user_id, platform) 入口

上层 (router / downloader) 只该调 ensure_valid_token, 不该直接碰
CloudCredential 或 encryption 细节.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.db.cloud_credentials_dao import (
    get_credential,
    update_tokens,
)
from app.db.models.cloud_credentials import CloudCredential
from app.services.cloud_drive import baidu_client
from app.utils.encryption import CookieEncryption

logger = logging.getLogger(__name__)

# 提前 5 分钟触发刷新, 避免请求打到一半 token 失效
REFRESH_LEEWAY = timedelta(minutes=5)


class NoCredentialError(Exception):
    """用户未登录该平台."""


class TokenRefreshFailed(Exception):
    """refresh_token 也失效, 需要用户重新 OAuth."""


def ensure_valid_token(db: Session, *, user_id: int, platform: str) -> str:
    """
    返回一个当前有效的 access_token (明文).

    :raises NoCredentialError: 用户从未绑定过该平台
    :raises TokenRefreshFailed: refresh_token 失效, 需重新授权
    """
    row = get_credential(db, user_id=user_id, platform=platform)
    if not row:
        raise NoCredentialError(f"用户 {user_id} 未绑定 {platform}")

    now = datetime.utcnow()
    needs_refresh = row.expires_at is None or (row.expires_at - now) < REFRESH_LEEWAY

    if not needs_refresh:
        return CookieEncryption.decrypt(row.access_token_encrypted)

    # 需要刷新
    if not row.refresh_token_encrypted:
        raise TokenRefreshFailed("无 refresh_token, 请重新登录")

    refresh_token = CookieEncryption.decrypt(row.refresh_token_encrypted)
    try:
        new_tok = baidu_client.refresh_access_token(refresh_token)
    except Exception as e:
        logger.warning(f"刷新 {platform} token 失败: {e}")
        raise TokenRefreshFailed(f"refresh_token 失效: {e}")

    update_tokens(
        db,
        row=row,
        access_token_encrypted=CookieEncryption.encrypt(new_tok.access_token),
        refresh_token_encrypted=(
            CookieEncryption.encrypt(new_tok.refresh_token)
            if new_tok.refresh_token else None
        ),
        expires_at=new_tok.expires_at,
    )
    logger.info(f"已刷新 {platform} token for user_id={user_id}")
    return new_tok.access_token
