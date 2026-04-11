from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, time, timezone

from aiohttp import web
from sqlalchemy import case, func, select

from bot.api.common import iso_utc, persist_session_if_current, verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import AttendanceLog, User
from bot.services.crypto import get_crypto
from bot.services.mirea_acs import MireaACS

logger = logging.getLogger(__name__)

VALID_THEMES = {"dark", "light", "ocean"}
KNOWN_TABS = {"scanner", "schedule", "grades", "passes", "maps", "esports"}
FIXED_TABS = {"scanner", "schedule", "grades", "passes"}
MAX_TABS = 6


def _parse_visible_tabs(raw: str | None) -> list[str] | None:
    """Parse JSON-encoded visible_tabs, return None if unset."""
    if not raw:
        return None
    try:
        tabs = json.loads(raw)
        if isinstance(tabs, list):
            return [t for t in tabs if t in KNOWN_TABS]
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _resolve_theme_mode(user) -> str:
    """Return effective theme_mode, falling back to light_theme_enabled."""
    tm = getattr(user, "theme_mode", None)
    if tm and tm in VALID_THEMES:
        return tm
    return "light" if bool(getattr(user, "light_theme_enabled", False)) else "dark"


def _validate_visible_tabs(tabs: list) -> list[str] | None:
    """Validate and normalize a visible_tabs list from user input."""
    if not isinstance(tabs, list):
        return None
    cleaned = []
    seen = set()
    for t in tabs:
        if isinstance(t, str) and t in KNOWN_TABS and t not in seen:
            cleaned.append(t)
            seen.add(t)
    # Ensure fixed tabs are present
    for ft in FIXED_TABS:
        if ft not in seen:
            cleaned.append(ft)
    # Enforce max
    return cleaned[:MAX_TABS]


async def handle_get_profile(request: web.Request) -> web.Response:
    """Профиль пользователя + статистика отметок посещаемости."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

    first_name = (tg_user.get("first_name") or "").strip()
    last_name = (tg_user.get("last_name") or "").strip()
    tg_full_name = f"{first_name} {last_name}".strip() or (tg_user.get("username") or "").strip()

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if not user:
            return web.json_response({"success": False, "message": "User not found"}, status=404)

        def _to_rate(success_count: int, total_count: int) -> float:
            if total_count <= 0:
                return 0.0
            return round((float(success_count) / float(total_count)) * 100.0, 1)

        # "Сегодня" считаем по Москве, но в БД храним UTC.
        now_utc = datetime.utcnow()
        now_msk = now_utc + timedelta(hours=3)
        start_utc = datetime.combine(now_msk.date(), time.min) - timedelta(hours=3)
        end_utc = start_utc + timedelta(days=1)

        stats_row = (
            await session.execute(
                select(
                    func.count(AttendanceLog.id),
                    func.sum(case((AttendanceLog.success.is_(True), 1), else_=0)),
                    func.max(AttendanceLog.created_at),
                    func.max(case((AttendanceLog.success.is_(True), AttendanceLog.created_at), else_=None)),
                ).where(AttendanceLog.user_id == user.id)
            )
        ).one()

        total_attempts = int(stats_row[0] or 0)
        success_attempts = int(stats_row[1] or 0)
        failed_attempts = total_attempts - success_attempts
        last_attempt_at = iso_utc(stats_row[2]) if stats_row[2] else None
        last_success_at = iso_utc(stats_row[3]) if stats_row[3] else None

        today_row = (
            await session.execute(
                select(
                    func.count(AttendanceLog.id),
                    func.sum(case((AttendanceLog.success.is_(True), 1), else_=0)),
                ).where(
                    AttendanceLog.user_id == user.id,
                    AttendanceLog.created_at >= start_utc,
                    AttendanceLog.created_at < end_utc,
                )
            )
        ).one()
        today_attempts = int(today_row[0] or 0)
        today_success = int(today_row[1] or 0)

        window_7_start = now_utc - timedelta(days=7)
        row_7 = (
            await session.execute(
                select(
                    func.count(AttendanceLog.id),
                    func.sum(case((AttendanceLog.success.is_(True), 1), else_=0)),
                ).where(
                    AttendanceLog.user_id == user.id,
                    AttendanceLog.created_at >= window_7_start,
                )
            )
        ).one()
        attempts_7d = int(row_7[0] or 0)
        success_7d = int(row_7[1] or 0)
        failed_7d = attempts_7d - success_7d

        window_30_start = now_utc - timedelta(days=30)
        row_30 = (
            await session.execute(
                select(
                    func.count(AttendanceLog.id),
                    func.sum(case((AttendanceLog.success.is_(True), 1), else_=0)),
                ).where(
                    AttendanceLog.user_id == user.id,
                    AttendanceLog.created_at >= window_30_start,
                )
            )
        ).one()
        attempts_30d = int(row_30[0] or 0)
        success_30d = int(row_30[1] or 0)
        failed_30d = attempts_30d - success_30d

        history_rows = (
            await session.execute(
                select(
                    AttendanceLog.id,
                    AttendanceLog.success,
                    AttendanceLog.error_message,
                    AttendanceLog.created_at,
                )
                .where(AttendanceLog.user_id == user.id)
                .order_by(AttendanceLog.created_at.desc())
                .limit(10)
            )
        ).all()

        recent_scans = [
            {
                "id": int(row[0]),
                "created_at": iso_utc(row[3]) if row[3] else None,
                "status": "success" if bool(row[1]) else "error",
                "success": bool(row[1]),
                "subject": None,
                "message": "Отметка выполнена" if bool(row[1]) else (row[2] or "Ошибка отметки"),
                "error_message": None if bool(row[1]) else (row[2] or "Ошибка отметки"),
            }
            for row in history_rows
        ]

        last_sync_at = iso_utc(user.last_mirea_sync_at) if getattr(user, "last_mirea_sync_at", None) else None
        sync_state = "not_authorized"
        if user.mirea_session:
            sync_state = "ok" if last_sync_at else "unknown"

        return web.json_response(
            {
                "success": True,
                "telegram": {
                    "id": telegram_id,
                    "username": tg_user.get("username"),
                    "full_name": tg_full_name or user.full_name,
                    "photo_url": tg_user.get("photo_url"),
                },
                "account": {
                    "authorized": user.mirea_session is not None,
                    "login": user.mirea_login,
                    "share_mirea_login": bool(getattr(user, "share_mirea_login", False)),
                    "mark_with_friends_default": bool(getattr(user, "mark_with_friends_default", False)),
                    "auto_select_favorites": bool(getattr(user, "auto_select_favorites", True)),
                    "haptics_enabled": bool(getattr(user, "haptics_enabled", True)),
                    "light_theme_enabled": bool(getattr(user, "light_theme_enabled", False)),
                    "theme_mode": _resolve_theme_mode(user),
                    "visible_tabs": _parse_visible_tabs(getattr(user, "visible_tabs", None)),
                    "last_sync_at": last_sync_at,
                    "sync_state": sync_state,
                },
                "attendance_stats": {
                    "total_attempts": total_attempts,
                    "success_attempts": success_attempts,
                    "failed_attempts": failed_attempts,
                    "success_rate_total": _to_rate(success_attempts, total_attempts),
                    "today_attempts": today_attempts,
                    "today_success": today_success,
                    "today_success_rate": _to_rate(today_success, today_attempts),
                    "attempts_7d": attempts_7d,
                    "success_7d": success_7d,
                    "failed_7d": failed_7d,
                    "success_rate_7d": _to_rate(success_7d, attempts_7d),
                    "attempts_30d": attempts_30d,
                    "success_30d": success_30d,
                    "failed_30d": failed_30d,
                    "success_rate_30d": _to_rate(success_30d, attempts_30d),
                    "error_rate_30d": _to_rate(failed_30d, attempts_30d),
                    "last_attempt_at": last_attempt_at,
                    "last_success_at": last_success_at,
                },
                "recent_scans": recent_scans,
            }
        )


async def handle_update_profile_settings(request: web.Request) -> web.Response:
    """Обновить настройки профиля (например, что можно показывать друзьям)."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

    try:
        data = await request.json()
    except Exception:
        data = {}

    user: User | None = None
    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if not user:
            return web.json_response({"success": False, "message": "User not found"}, status=404)

        if "share_mirea_login" in data:
            user.share_mirea_login = bool(data.get("share_mirea_login"))
        if "mark_with_friends_default" in data:
            user.mark_with_friends_default = bool(data.get("mark_with_friends_default"))
        if "auto_select_favorites" in data:
            user.auto_select_favorites = bool(data.get("auto_select_favorites"))
        if "haptics_enabled" in data:
            user.haptics_enabled = bool(data.get("haptics_enabled"))
        if "light_theme_enabled" in data:
            user.light_theme_enabled = bool(data.get("light_theme_enabled"))
        if "theme_mode" in data:
            tm = data.get("theme_mode")
            if tm in VALID_THEMES:
                user.theme_mode = tm
                user.light_theme_enabled = (tm == "light")
        if "visible_tabs" in data:
            validated = _validate_visible_tabs(data.get("visible_tabs"))
            user.visible_tabs = json.dumps(validated) if validated else None
        await session.commit()

    return web.json_response(
        {
            "success": True,
            "settings": {
                "share_mirea_login": bool(getattr(user, "share_mirea_login", False)),
                "mark_with_friends_default": bool(getattr(user, "mark_with_friends_default", False)),
                "auto_select_favorites": bool(getattr(user, "auto_select_favorites", True)),
                "haptics_enabled": bool(getattr(user, "haptics_enabled", True)),
                "light_theme_enabled": bool(getattr(user, "light_theme_enabled", False)),
                "theme_mode": _resolve_theme_mode(user),
                "visible_tabs": _parse_visible_tabs(getattr(user, "visible_tabs", None)),
            },
        }
    )


async def handle_profile_connection_check(request: web.Request) -> web.Response:
    """Явная проверка доступности сервисов МИРЭА для текущей сессии."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if not user:
            return web.json_response({"success": False, "message": "User not found"}, status=404)
        if not user.mirea_session:
            return web.json_response(
                {"success": False, "message": "Требуется авторизация", "needs_auth": True},
            )

        crypto = get_crypto()
        stored_session = user.mirea_session
        cookies, rotated_session = crypto.decrypt_session_for_db(stored_session)
        session_blob_for_update = stored_session
        rotated_saved = False
        if rotated_session and rotated_session != stored_session:
            rotated_saved = await persist_session_if_current(
                session,
                user_id=user.id,
                previous_session=stored_session,
                updated_session=rotated_session,
            )
            if rotated_saved:
                session_blob_for_update = rotated_session

        if not cookies:
            return web.json_response({"success": False, "message": "Ошибка сессии. Перелогинься."})

        cookies_before = dict(cookies)
        acs_service = MireaACS(cookies)
        ok, message = await acs_service.check_connection()
        await acs_service.close()

        try:
            session_changed = bool(rotated_saved)
            if cookies != cookies_before:
                updated_session = crypto.encrypt_session(cookies)
                session_changed = await persist_session_if_current(
                    session,
                    user_id=user.id,
                    previous_session=session_blob_for_update,
                    updated_session=updated_session,
                )
            if ok:
                user.last_mirea_sync_at = datetime.utcnow()
            if ok or session_changed:
                await session.commit()
        except Exception:
            try:
                await session.rollback()
            except Exception:
                pass

        return web.json_response(
            {
                "success": bool(ok),
                "message": message,
                "checked_at": iso_utc(datetime.utcnow()),
                "last_sync_at": iso_utc(user.last_mirea_sync_at) if user.last_mirea_sync_at else None,
            }
        )

