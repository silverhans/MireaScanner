"""JWT authentication and password hashing utilities."""

from __future__ import annotations

import time

import bcrypt
import jwt

from bot.config import settings

_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_S = 30 * 24 * 3600  # 30 days


def _get_secret() -> str:
    secret = settings.jwt_secret
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured")
    return secret


def create_jwt(user_id: int) -> str:
    payload = {
        "sub": user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + _JWT_EXPIRY_S,
    }
    return jwt.encode(payload, _get_secret(), algorithm=_JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, _get_secret(), algorithms=[_JWT_ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False
