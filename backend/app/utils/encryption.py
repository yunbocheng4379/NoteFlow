"""
Fernet 对称加密工具 — 用于 platform_cookies 表 cookie_value_encrypted 字段.

key 来源 (.env 的 COOKIE_ENCRYPT_KEY):
1. 启动时读取 .env, 找到就用.
2. 找不到: 由 get_or_create_encrypt_key() 自动生成一个安全的 Fernet key,
   自动追加到 .env (创建一个备份 .env.bak.YYYYMMDD_HHMMSS 后再写),
   然后启动继续.

安全注意:
- key 是 Fernet.generate_key() 生成的 url-safe base64 32B 密钥,
  丢失等于明文被锁 — 备份 .env.
- 错误密钥调用 decrypt 抛 ``InvalidToken``, 不应 leak 出去;
  业务层把它当 500 处理, 不要把原始 cookie 给前端.
"""
from __future__ import annotations

import base64
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

ENV_KEY_NAME = "COOKIE_ENCRYPT_KEY"
_DEFAULT_KEY_LEN_BYTES = 32


class CookieEncryptionError(RuntimeError):
    """加密 / 解密流程出错 (除 InvalidToken 之外的统一错误)."""


def _get_env_file_path() -> Path:
    """定位 .env. 默认走 backend/.env; 找不到再退到项目根."""
    candidates = [
        Path(__file__).resolve().parents[2] / ".env",
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[2] / ".." / ".env",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


def _write_key_to_env(key: str) -> None:
    """把 key 追加或替换到 .env. 先备份再写."""
    env_path = _get_env_file_path()
    backup_path = env_path.with_suffix(
        f".bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    line_re = re.compile(rf"^{re.escape(ENV_KEY_NAME)}\s*=")
    try:
        if env_path.exists():
            original = env_path.read_text(encoding="utf-8")
            env_path.rename(backup_path)
        else:
            env_path.parent.mkdir(parents=True, exist_ok=True)
            original = ""

        if line_re.search(original):
            new_lines = [
                line if not line_re.match(line) else f"{ENV_KEY_NAME}={key}\n"
                for line in original.splitlines(keepends=True)
            ]
            new_content = "".join(new_lines)
        else:
            sep = "" if not original or original.endswith("\n") else "\n"
            new_content = (
                original
                + sep
                + f"# 自动写入于 {datetime.now().isoformat(timespec='seconds')}\n"
                + f"{ENV_KEY_NAME}={key}\n"
            )

        env_path.write_text(new_content, encoding="utf-8")
        os.chmod(env_path, 0o600)
        logger.info("[encryption] %s 已生成并写入 %s (备份: %s)", ENV_KEY_NAME, env_path, backup_path)
    except Exception as e:
        raise CookieEncryptionError(f"写入 .env 失败: {e}") from e


def get_or_create_encrypt_key() -> bytes:
    """读取现有 key; 没有则生成一个新的并写入 .env.

    返回 **url-safe base64 字符串** (Fernet 期待的格式), 长度为 44 字符左右;
    内部 ``Fernet(key)`` 时直接用此字符串. 不要做 urlsafe_b64decode,
    否则 Fernet 会再次 decode, 触发 ``Fernet key must be 32 bytes`` 错误.
    """
    raw = os.getenv(ENV_KEY_NAME)
    if raw and raw.strip():
        v = raw.strip()
        # 简单 sanity: Fernet key 是 32 byte raw 的 url-safe base64 = 44 字符.
        # 太短就当格式坏, 让调用方走 fallback 生成新 key.
        if len(v) < 40:
            logger.warning("[encryption] %s 长度异常 (len=%d), 重新生成", ENV_KEY_NAME, len(v))
        else:
            return v.encode("utf-8")

    key = Fernet.generate_key()  # bytes (url-safe base64, 44 字符)
    key_str = key.decode("utf-8")
    _write_key_to_env(key_str)
    os.environ[ENV_KEY_NAME] = key_str
    return key


class CookieEncryption:
    """线程不敏感的 Fernet 加解密封装 (Fernet 本身是线程安全的)."""

    _fernet: Optional[Fernet] = None

    @classmethod
    def _get_fernet(cls) -> Fernet:
        if cls._fernet is None:
            cls._fernet = Fernet(get_or_create_encrypt_key())
        return cls._fernet

    @classmethod
    def encrypt(cls, plaintext: str) -> str:
        """返回 url-safe base64 字符串 (可入库 TEXT)."""
        if plaintext is None:
            raise CookieEncryptionError("不能加密 None")
        return cls._get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")

    @classmethod
    def decrypt(cls, ciphertext: str) -> str:
        """解错 (key 不匹配 / 密文损坏) 抛 InvalidToken, 不吞."""
        if not ciphertext:
            raise CookieEncryptionError("不能解密空字符串")
        try:
            return cls._get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except InvalidToken as e:
            raise InvalidToken("cookie 解密失败, 可能加密 key 已变更") from e

    @classmethod
    def reload(cls) -> None:
        """强制重读 ENV 的 key, 用于测试或换 key 后重置."""
        os.environ.pop(ENV_KEY_NAME, None)
        cls._fernet = None
        cls._get_fernet()
