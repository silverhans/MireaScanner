from __future__ import annotations

import time

from bot.services.mirea_auth import MireaAuth


def get_authorization_header(session_cookies: dict | None) -> str | None:
    """
    Build Authorization header value from stored Keycloak tokens (if present).
    Returns e.g. "Bearer <access_token>" or None.
    """
    cookies = session_cookies or {}
    access_token = (cookies.get("access_token") or "").strip()
    if not access_token:
        return None
    token_type = (cookies.get("token_type") or "Bearer").strip() or "Bearer"
    return f"{token_type} {access_token}"


async def try_refresh_tokens(session_cookies: dict | None) -> bool:
    """
    Best-effort refresh for Keycloak tokens. Updates `session_cookies` in-place.
    Returns True on successful refresh, otherwise False.
    """
    if not session_cookies:
        return False
    refresh_token = (session_cookies.get("refresh_token") or "").strip()
    if not refresh_token:
        return False

    auth = MireaAuth()
    try:
        tokens = await auth.refresh_tokens(refresh_token)
    finally:
        try:
            await auth.close()
        except Exception:
            pass

    if not tokens:
        return False

    session_cookies.update(tokens)
    session_cookies["__token_refreshed_at"] = int(time.time())
    return True

