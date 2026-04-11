"""
Encryption helpers for safe storage of user sessions (MIREA cookies) in the DB.

Goals:
- Authenticated encryption at rest (confidentiality + integrity).
- Support key rotation without breaking existing sessions.
- Backward compatible with the legacy scheme (key derived from BOT_TOKEN).

Recommended configuration:
- Set SESSION_KEYS in .env (comma-separated). First key is used for encryption,
  all keys are tried for decryption. Keep the old key(s) during a rotation.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from bot.config import settings

logger = logging.getLogger(__name__)

_HKDF_SALT = b"qrscaner.session.v1"
_HKDF_INFO = b"mirea-session-cookies"


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    items = [part.strip() for part in value.split(",")]
    return [item for item in items if item]


def _looks_like_fernet_key(value: str) -> bool:
    try:
        raw = base64.urlsafe_b64decode(value.encode("ascii"))
        return len(raw) == 32
    except Exception:
        return False


def _legacy_fernet_key_from_secret(secret: str) -> bytes:
    """
    Legacy derivation used by older versions of this project:
    urlsafe_b64encode(sha256(secret)).
    """
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())


def _hkdf_fernet_key_from_secret(secret: str) -> bytes:
    """
    HKDF-based deterministic derivation for arbitrary secrets.
    Security depends on the entropy of `secret`.
    """
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    )
    raw_key = hkdf.derive(secret.encode("utf-8"))
    return base64.urlsafe_b64encode(raw_key)


def _fernet_key_from_config_entry(entry: str) -> bytes:
    # Allow passing either a raw secret or a proper Fernet key.
    if _looks_like_fernet_key(entry):
        return entry.encode("ascii")
    return _hkdf_fernet_key_from_secret(entry)


@dataclass(frozen=True)
class _DecryptedSession:
    cookies: dict
    key_index: int


class SessionCrypto:
    """Encryption wrapper with key rotation support."""

    def __init__(self, session_keys: str | None = None, *, legacy_bot_token: str | None = None):
        keys: list[bytes] = []

        for entry in _split_csv(session_keys):
            try:
                key = _fernet_key_from_config_entry(entry)
            except Exception:
                continue
            if key not in keys:
                keys.append(key)

        # Always include legacy BOT_TOKEN-derived key as a decryption fallback,
        # so old DB rows keep working after enabling SESSION_KEYS.
        if legacy_bot_token:
            legacy_key = _legacy_fernet_key_from_secret(legacy_bot_token)
            if legacy_key not in keys:
                keys.append(legacy_key)

        if not keys:
            raise RuntimeError("No session encryption keys available (configure SESSION_KEYS).")

        self._fernets = [Fernet(k) for k in keys]
        self._primary = self._fernets[0]

    def encrypt_session(self, cookies: dict) -> str:
        """
        Encrypt cookies dict into a string suitable for DB storage.
        """
        # Stable JSON helps during debugging and avoids edge-cases around non-UTF payloads.
        json_data = json.dumps(cookies, ensure_ascii=False, separators=(",", ":"))
        encrypted = self._primary.encrypt(json_data.encode("utf-8"))
        return encrypted.decode("ascii")

    def _decrypt_with_key_index(self, encrypted_data: str) -> _DecryptedSession | None:
        if not encrypted_data:
            return None

        token = encrypted_data.encode("ascii", errors="ignore")
        for idx, f in enumerate(self._fernets):
            try:
                decrypted = f.decrypt(token)
                cookies = json.loads(decrypted.decode("utf-8"))
                if isinstance(cookies, dict):
                    return _DecryptedSession(cookies=cookies, key_index=idx)
                return None
            except InvalidToken:
                continue
            except Exception:
                return None
        return None

    def decrypt_session(self, encrypted_data: str) -> dict | None:
        """
        Decrypt cookies from DB. Returns None on any error.
        """
        res = self._decrypt_with_key_index(encrypted_data)
        return res.cookies if res else None

    def decrypt_session_for_db(self, encrypted_data: str) -> tuple[dict | None, str | None]:
        """
        Decrypt cookies, and if they were encrypted with a non-primary key, also return a
        rotated ciphertext (encrypted with the primary key) so callers can persist it back to DB.
        """
        res = self._decrypt_with_key_index(encrypted_data)
        if not res:
            return None, None
        rotated = None
        if res.key_index != 0:
            rotated = self.encrypt_session(res.cookies)
        return res.cookies, rotated


# Global instance
_crypto: SessionCrypto | None = None


def get_crypto() -> SessionCrypto:
    """Get singleton crypto instance."""
    global _crypto
    if _crypto is None:
        if settings.session_keys:
            logger.info("Session encryption: SESSION_KEYS configured (rotation enabled).")
        else:
            logger.warning(
                "SESSION_KEYS is not set; falling back to BOT_TOKEN-derived key. "
                "Set SESSION_KEYS to improve security and enable key rotation."
            )
        _crypto = SessionCrypto(settings.session_keys, legacy_bot_token=settings.bot_token)
    return _crypto

