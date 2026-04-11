from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from aiohttp import web
from sqlalchemy import select

from bot.api.common import persist_session_if_current, verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import User
from bot.services.crypto import get_crypto
from bot.services.mirea_grades import MireaGrades
from bot.utils.rate_limiter import grades_limiter

logger = logging.getLogger(__name__)


async def handle_get_grades(request: web.Request) -> web.Response:
    """Получить оценки из БРС."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_grades_enabled:
        return web.json_response(
            {"success": False, "message": "БРС временно отключён. Попробуйте позже."},
            status=503,
        )

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")

    is_allowed, retry_after = await grades_limiter.is_allowed(str(telegram_id))
    if not is_allowed:
        return web.json_response(
            {"success": False, "message": f"Слишком много запросов. Попробуй через {retry_after} сек."},
            status=429,
        )

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()

        if not user or not user.mirea_session:
            return web.json_response(
                {"success": False, "message": "Требуется авторизация", "needs_auth": True},
            )

        crypto = get_crypto()
        stored_session = user.mirea_session
        cookies, rotated_session = crypto.decrypt_session_for_db(stored_session)
        session_blob_for_update = stored_session
        if rotated_session and rotated_session != stored_session:
            try:
                rotated_saved = await persist_session_if_current(
                    session,
                    user_id=user.id,
                    previous_session=stored_session,
                    updated_session=rotated_session,
                )
                if rotated_saved:
                    session_blob_for_update = rotated_session
                    await session.commit()
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass

        if not cookies:
            return web.json_response({"success": False, "message": "Ошибка сессии. Перелогинься."})

        # Useful runtime diagnostics when the upstream changes auth/cookies.
        has_token = "access_token" in cookies
        has_aspnet = ".AspNetCore.Cookies" in cookies
        has_pw = "__pw_state__" in cookies
        logger.info("Grades request: user=%s, token=%s, aspnet=%s, pw_state=%s", telegram_id, has_token, has_aspnet, has_pw)
        logger.info("Cookie keys: %s", list(cookies.keys()))

        cookies_before = dict(cookies)

        grades_service = MireaGrades(cookies)
        result = await grades_service.get_grades()
        await grades_service.close()

        logger.info("Grades result: success=%s, message=%s", result.success, result.message)

        needs_commit = False
        if result.success:
            user.last_mirea_sync_at = datetime.utcnow()
            needs_commit = True
        if cookies != cookies_before:
            updated_session = crypto.encrypt_session(cookies)
            session_saved = await persist_session_if_current(
                session,
                user_id=user.id,
                previous_session=session_blob_for_update,
                updated_session=updated_session,
            )
            if session_saved:
                needs_commit = True
                logger.info("Persisted updated MIREA session into user session")

        if needs_commit:
            try:
                await session.commit()
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass

        if result.success and result.subjects:
            return web.json_response(
                {
                    "success": True,
                    "subjects": [
                        {
                            "name": s.name,
                            "discipline_id": getattr(s, "discipline_id", None),
                            "current_control": s.current_control,
                            "semester_control": s.semester_control,
                            "attendance": s.attendance,
                            "attendance_max_possible": getattr(s, "attendance_max_possible", None),
                            "achievements": getattr(s, "achievements", 0.0),
                            "additional": getattr(s, "additional", 0.0),
                            "total": s.total,
                        }
                        for s in result.subjects
                    ],
                    "semester": result.semester,
                }
            )

        return web.json_response({"success": False, "message": result.message})
