from __future__ import annotations

import json
from datetime import datetime, timezone

from aiohttp import web
from sqlalchemy import select

from bot.api.common import persist_session_if_current, verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import User
from bot.services.crypto import get_crypto
from bot.services.mirea_acs import MireaACS


async def handle_get_acs_events(request: web.Request) -> web.Response:
    """Получить события пропуска (ACS) за текущий день."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_acs_enabled:
        return web.json_response(
            {"success": False, "message": "Раздел пропусков временно отключён. Попробуйте позже."},
            status=503,
        )

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()

        if not user or not user.mirea_session:
            return web.json_response({"success": False, "message": "Требуется авторизация", "needs_auth": True})

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

        cookies_before = dict(cookies)
        acs_service = MireaACS(cookies)
        acs_result = await acs_service.get_today_events()
        await acs_service.close()

        if not acs_result.success:
            return web.json_response({"success": False, "message": acs_result.message})

        try:
            if cookies != cookies_before:
                updated_session = crypto.encrypt_session(cookies)
                await persist_session_if_current(
                    session,
                    user_id=user.id,
                    previous_session=session_blob_for_update,
                    updated_session=updated_session,
                )
            user.last_mirea_sync_at = datetime.utcnow()
            await session.commit()
        except Exception:
            try:
                await session.rollback()
            except Exception:
                pass

        return web.json_response(
            {
                "success": True,
                "date": acs_result.date,
                "events": [
                    {
                        "ts": e.ts,
                        "time": e.time_label,
                        "enter_zone": e.enter_zone,
                        "exit_zone": e.exit_zone,
                        "duration_seconds": e.duration_seconds,
                        "duration": e.duration_label,
                    }
                    for e in acs_result.events
                ],
            }
        )
