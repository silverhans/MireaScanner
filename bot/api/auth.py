from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time as time_module
from dataclasses import dataclass, field
from datetime import datetime, timezone

from aiohttp import web
from sqlalchemy import select, text

from bot.api.common import build_full_name_from_tg_user, get_or_create_user, verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import AttendanceLog, Friend, User
from bot.services.crypto import get_crypto
from bot.services.mirea_auth import AuthChallenge, MireaAuth

logger = logging.getLogger(__name__)


_PENDING_2FA_TTL_S = 5 * 60
_PENDING_2FA_MAX_ATTEMPTS = 5


@dataclass
class _Pending2FA:
    telegram_id: int
    created_at: float
    attempts: int
    login: str
    cookies: dict
    action_url: str
    field_name: str
    hidden_fields: dict[str, str]
    referer: str | None = None
    pkce_verifier: str | None = None
    redirect_uri: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False, compare=False)


_PENDING_2FA: dict[str, _Pending2FA] = {}


def _purge_pending_2fa(now: float | None = None) -> None:
    now_ts = float(now if now is not None else time_module.time())
    expired = [
        key for key, item in list(_PENDING_2FA.items()) if now_ts - float(item.created_at) > _PENDING_2FA_TTL_S
    ]
    for key in expired:
        _PENDING_2FA.pop(key, None)


def _new_2fa_state() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Redis-backed 2FA state (shared across worker processes)
# ---------------------------------------------------------------------------

_REDIS_2FA_PREFIX = "2fa:"
_redis_2fa_client = None


async def _get_2fa_redis():
    global _redis_2fa_client
    if _redis_2fa_client is not None:
        try:
            await _redis_2fa_client.ping()
            return _redis_2fa_client
        except Exception:
            _redis_2fa_client = None
    url = getattr(settings, "redis_url", None)
    if not url:
        return None
    try:
        import redis.asyncio as aioredis
        _redis_2fa_client = aioredis.from_url(url, socket_connect_timeout=1.0, socket_timeout=1.0)
        await _redis_2fa_client.ping()
        return _redis_2fa_client
    except Exception:
        _redis_2fa_client = None
        return None


def _pending_to_json(p):
    return json.dumps({
        "telegram_id": p.telegram_id, "created_at": p.created_at,
        "attempts": p.attempts, "login": p.login,
        "cookies": p.cookies, "action_url": p.action_url,
        "field_name": p.field_name, "hidden_fields": p.hidden_fields,
        "referer": p.referer, "pkce_verifier": p.pkce_verifier,
        "redirect_uri": p.redirect_uri,
    })


def _json_to_pending(raw):
    d = json.loads(raw)
    return _Pending2FA(
        telegram_id=d["telegram_id"], created_at=d["created_at"],
        attempts=d["attempts"], login=d["login"],
        cookies=d["cookies"], action_url=d["action_url"],
        field_name=d["field_name"], hidden_fields=d["hidden_fields"],
        referer=d.get("referer"), pkce_verifier=d.get("pkce_verifier"),
        redirect_uri=d.get("redirect_uri"),
    )


async def _store_2fa(state, pending):
    r = await _get_2fa_redis()
    if r:
        try:
            await r.setex(f"{_REDIS_2FA_PREFIX}{state}", _PENDING_2FA_TTL_S, _pending_to_json(pending))
            return
        except Exception as e:
            logger.warning("Redis 2FA store failed, using in-memory: %s", e)
    _PENDING_2FA[state] = pending


async def _load_2fa(state):
    r = await _get_2fa_redis()
    if r:
        try:
            raw = await r.get(f"{_REDIS_2FA_PREFIX}{state}")
            if raw:
                return _json_to_pending(raw if isinstance(raw, str) else raw.decode())
            return None
        except Exception as e:
            logger.warning("Redis 2FA load failed, using in-memory: %s", e)
    _purge_pending_2fa()
    return _PENDING_2FA.get(state)


async def _update_2fa(state, pending):
    r = await _get_2fa_redis()
    if r:
        try:
            ttl = await r.ttl(f"{_REDIS_2FA_PREFIX}{state}")
            if ttl > 0:
                await r.setex(f"{_REDIS_2FA_PREFIX}{state}", ttl, _pending_to_json(pending))
            return
        except Exception as e:
            logger.warning("Redis 2FA update failed, using in-memory: %s", e)
    _PENDING_2FA[state] = pending


async def _delete_2fa(state):
    r = await _get_2fa_redis()
    if r:
        try:
            await r.delete(f"{_REDIS_2FA_PREFIX}{state}")
        except Exception:
            pass
    _PENDING_2FA.pop(state, None)


async def handle_auth_status(request: web.Request) -> web.Response:
    """Проверить статус авторизации пользователя в МИРЭА"""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if not user:
            user = await get_or_create_user(session, tg_user)
            if not user:
                return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

        return web.json_response(
            {
                "success": True,
                "authorized": user.mirea_session is not None,
                "user_name": user.full_name,
                "login": user.mirea_login,
                "telegram_username": user.username,
            }
        )


async def handle_auth_login(request: web.Request) -> web.Response:
    """Авторизация в МИРЭА"""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        login = (data.get("login") or "").strip()
        password = data.get("password") or ""
        if not login or not password:
            return web.json_response({"success": False, "message": "Введите логин и пароль"}, status=400)

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")
        if not telegram_id:
            return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

        auth = MireaAuth()
        try:
            result = await auth.login(login, password)
        finally:
            await auth.close()

        if not result.success:
            challenge_kind = getattr(result.challenge, "kind", None) if result.challenge else None
            if challenge_kind in ("otp", "email_code"):
                state = _new_2fa_state()
                cookies = result.cookies or {}
                challenge = result.challenge
                await _store_2fa(state, _Pending2FA(
                    telegram_id=int(telegram_id),
                    created_at=time_module.time(),
                    attempts=0,
                    login=login,
                    cookies=cookies,
                    action_url=challenge.action_url,
                    field_name=challenge.field_name,
                    hidden_fields=challenge.hidden_fields or {},
                    referer=challenge.referer,
                    pkce_verifier=getattr(challenge, "pkce_verifier", None),
                    redirect_uri=getattr(challenge, "redirect_uri", None),
                ))
                return web.json_response(
                    {
                        "success": False,
                        "needs_2fa": True,
                        "state": state,
                        "challenge_kind": challenge_kind,
                        "message": result.message or "Требуется код подтверждения (2FA)",
                    }
                )

            return web.json_response({"success": False, "message": result.message})

        crypto = get_crypto()
        encrypted_session = crypto.encrypt_session(result.cookies)

        async with async_session() as session:
            db_result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = db_result.scalar_one_or_none()

            if not user:
                user = User(
                    telegram_id=telegram_id,
                    username=tg_user.get("username"),
                    full_name=build_full_name_from_tg_user(tg_user),
                )
                session.add(user)
            else:
                username = tg_user.get("username")
                full_name = build_full_name_from_tg_user(tg_user)
                if user.username != username:
                    user.username = username
                if full_name and user.full_name != full_name:
                    user.full_name = full_name

            user.mirea_session = encrypted_session
            user.mirea_login = login
            user.last_mirea_sync_at = datetime.utcnow()
            await session.commit()

        return web.json_response({"success": True, "message": "Авторизация успешна"})

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_auth_2fa(request: web.Request) -> web.Response:
    """Продолжение авторизации в МИРЭА для аккаунтов с 2FA (OTP)"""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
    except Exception:
        data = {}

    state = (data.get("state") or "").strip()
    code = (data.get("code") or "").strip()
    if not state or not code:
        return web.json_response({"success": False, "message": "Введите код подтверждения"}, status=400)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

    pending = await _load_2fa(state)
    if not pending or int(pending.telegram_id) != int(telegram_id):
        return web.json_response({"success": False, "message": "Сессия 2FA истекла. Войдите заново."}, status=400)

    if pending.attempts >= _PENDING_2FA_MAX_ATTEMPTS:
        await _delete_2fa(state)
        return web.json_response({"success": False, "message": "Слишком много попыток. Войдите заново."}, status=400)

    pending.attempts += 1

    challenge = AuthChallenge(
        kind="otp",
        action_url=pending.action_url,
        field_name=pending.field_name,
        hidden_fields=pending.hidden_fields or {},
        referer=pending.referer,
        pkce_verifier=pending.pkce_verifier,
        redirect_uri=pending.redirect_uri,
    )

    auth = MireaAuth()
    try:
        result = await auth.submit_otp(challenge, code, cookies=pending.cookies or {})
    finally:
        await auth.close()

    if not result.success:
        retry_kind = getattr(result.challenge, "kind", None) if result.challenge else None
        if retry_kind in ("otp", "email_code"):
            pending.cookies = result.cookies or pending.cookies
            pending.action_url = result.challenge.action_url
            pending.field_name = result.challenge.field_name
            pending.hidden_fields = result.challenge.hidden_fields or {}
            pending.referer = result.challenge.referer
            pending.pkce_verifier = getattr(result.challenge, "pkce_verifier", pending.pkce_verifier)
            pending.redirect_uri = getattr(result.challenge, "redirect_uri", pending.redirect_uri)
            await _update_2fa(state, pending)

        resp_data: dict = {
            "success": False,
            "needs_2fa": True,
            "state": state,
            "message": result.message or "Не удалось подтвердить вход (2FA)",
        }
        if retry_kind:
            resp_data["challenge_kind"] = retry_kind
        return web.json_response(resp_data)

    await _delete_2fa(state)
    pending_login = pending.login
    otp_result_cookies = result.cookies or {}

    crypto = get_crypto()
    encrypted_session = crypto.encrypt_session(otp_result_cookies)

    async with async_session() as session:
        db_result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = db_result.scalar_one_or_none()

        if not user:
            user = User(
                telegram_id=telegram_id,
                username=tg_user.get("username"),
                full_name=build_full_name_from_tg_user(tg_user),
            )
            session.add(user)
        else:
            username = tg_user.get("username")
            full_name = build_full_name_from_tg_user(tg_user)
            if user.username != username:
                user.username = username
            if full_name and user.full_name != full_name:
                user.full_name = full_name

        user.mirea_session = encrypted_session
        user.mirea_login = pending_login
        user.last_mirea_sync_at = datetime.utcnow()
        await session.commit()

    return web.json_response({"success": True, "message": "Авторизация успешна", "login": pending_login})


async def handle_auth_logout(request: web.Request) -> web.Response:
    """Выход из аккаунта МИРЭА"""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if user:
            user.mirea_session = None
            user.mirea_login = None
            await session.commit()

    return web.json_response({"success": True, "message": "Вы вышли из аккаунта"})


async def handle_delete_account(request: web.Request) -> web.Response:
    """Полное удаление аккаунта и всех данных пользователя"""

    try:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
        if not user_data:
            return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()
            if not user:
                return web.json_response({"success": False, "message": "Пользователь не найден"})

            await session.execute(AttendanceLog.__table__.delete().where(AttendanceLog.user_id == user.id))
            await session.execute(
                Friend.__table__.delete().where((Friend.user_id == user.id) | (Friend.friend_id == user.id))
            )

            # Legacy cleanup: older versions had local "groups" for marking attendance together.
            try:
                async with session.begin_nested():
                    await session.execute(
                        text(
                            "UPDATE users SET group_id = NULL "
                            "WHERE group_id IN (SELECT id FROM groups WHERE owner_id = :uid)"
                        ),
                        {"uid": user.id},
                    )
                    await session.execute(text("DELETE FROM groups WHERE owner_id = :uid"), {"uid": user.id})
                    await session.execute(text("UPDATE users SET group_id = NULL WHERE id = :uid"), {"uid": user.id})
            except Exception:
                pass

            await session.delete(user)
            await session.commit()

        return web.json_response({"success": True, "message": "Аккаунт и все данные удалены"})

    except Exception as e:
        logger.error("Delete account error: %s", e, exc_info=True)
        return web.json_response({"success": False, "message": "Не удалось удалить аккаунт"}, status=500)

