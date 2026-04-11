from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from aiohttp import web
from sqlalchemy import select

from bot.api.common import (
    get_or_create_user,
    normalize_friend_telegram_ids,
    persist_session_if_current,
    redact_qr_data_for_log,
    verify_telegram_webapp_data,
)
from bot.config import settings
from bot.database import async_session
from bot.database.models import AttendanceLog, Friend, User
from bot.services.crypto import get_crypto
from bot.services.mirea_api import MireaAPI
from bot.utils.distributed_throttle import DistributedThrottle
from bot.utils.rate_limiter import attendance_limiter
from bot.utils.throttle import ThrottleOverloaded

logger = logging.getLogger(__name__)


attendance_throttle = DistributedThrottle(
    name="attendance",
    max_concurrent=settings.attendance_max_concurrent,
    max_rps=settings.attendance_max_rps,
    queue_timeout_s=settings.attendance_queue_timeout_s,
    redis_url=settings.redis_url,
)


async def handle_mark_attendance(request: web.Request) -> web.Response:
    """Отметка посещаемости по QR (включая режим с друзьями)."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    # Per-user rate limiting (app-level, independent from middleware).
    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id_str = str(tg_user.get("id"))
    is_allowed, retry_after = await attendance_limiter.is_allowed(telegram_id_str)
    if not is_allowed:
        return web.json_response(
            {"success": False, "message": f"Слишком много запросов. Попробуй через {retry_after} сек."},
            status=429,
        )

    try:
        data = await request.json()
        qr_data = data.get("qr_data")
        mark_friends = data.get("mark_friends", False)  # legacy format
        friend_telegram_ids = data.get("friend_telegram_ids", [])  # new format
        friend_telegram_ids, ids_error = normalize_friend_telegram_ids(friend_telegram_ids, max_items=20)
        if ids_error:
            return web.json_response({"success": False, "message": ids_error}, status=400)

        if not qr_data:
            return web.json_response({"success": False, "message": "QR data is required"}, status=400)

        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()
            if not user:
                user = await get_or_create_user(session, tg_user)
                if not user:
                    return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

            results = []
            crypto = get_crypto()
            attendance_logs: list[AttendanceLog] = []
            redacted_qr_data = redact_qr_data_for_log(qr_data)

            # Build list of users to mark.
            users_to_mark: list[User] = []

            if friend_telegram_ids:
                users_to_mark.append(user)
                result = await session.execute(
                    select(User)
                    .join(
                        Friend,
                        ((Friend.friend_id == User.id) & (Friend.user_id == user.id))
                        | ((Friend.user_id == User.id) & (Friend.friend_id == user.id)),
                    )
                    .where(Friend.status == "accepted", User.telegram_id.in_(friend_telegram_ids))
                )
                users_to_mark.extend(result.scalars().all())
            elif mark_friends:
                users_to_mark.append(user)

                result = await session.execute(
                    select(User)
                    .join(Friend, Friend.friend_id == User.id)
                    .where(Friend.user_id == user.id, Friend.status == "accepted")
                )
                users_to_mark.extend(result.scalars().all())

                result = await session.execute(
                    select(User)
                    .join(Friend, Friend.user_id == User.id)
                    .where(Friend.friend_id == user.id, Friend.status == "accepted")
                )
                users_to_mark.extend(result.scalars().all())
            else:
                users_to_mark.append(user)

            # Deduplicate.
            unique_users_to_mark: list[User] = []
            seen_member_ids: set[int] = set()
            for member in users_to_mark:
                if not member or member.id in seen_member_ids:
                    continue
                seen_member_ids.add(member.id)
                unique_users_to_mark.append(member)
            users_to_mark = unique_users_to_mark

            async def mark_single_user(member: User, semaphore: asyncio.Semaphore):
                async with semaphore:
                    try:
                        _is_self = member.id == user.id
                        if not member.mirea_session:
                            if member.telegram_id == user.telegram_id:
                                return {
                                    "result": {
                                        "name": member.full_name,
                                        "success": False,
                                        "message": "Войди в аккаунт МИРЭА через бота: /start → Настройки",
                                        "user_id": member.telegram_id,
                                        "needs_auth": True,
                                        "is_self": _is_self,
                                    },
                                    "log": None,
                                    "is_current_user_unauth": True,
                                    "session_update": None,
                                }
                            return {
                                "result": {
                                    "name": member.full_name,
                                    "success": False,
                                    "message": "Не авторизован в МИРЭА",
                                    "user_id": member.telegram_id,
                                    "is_self": _is_self,
                                },
                                "log": None,
                                "is_current_user_unauth": False,
                                "session_update": None,
                            }

                        stored_session = member.mirea_session
                        cookies, rotated_session = crypto.decrypt_session_for_db(stored_session)
                        cookies_before = dict(cookies) if isinstance(cookies, dict) else {}

                        if not cookies:
                            return {
                                "result": {
                                    "name": member.full_name,
                                    "success": False,
                                    "message": "Ошибка расшифровки сессии",
                                    "user_id": member.telegram_id,
                                    "is_self": _is_self,
                                },
                                "log": AttendanceLog(
                                    user_id=member.id,
                                    qr_data=redacted_qr_data,
                                    success=False,
                                    error_message="Ошибка расшифровки сессии",
                                ),
                                "is_current_user_unauth": False,
                                "session_update": None,
                            }

                        api = MireaAPI(session_cookies=cookies)
                        try:
                            try:
                                async with attendance_throttle:
                                    mark_result = await api.mark_attendance(qr_data)
                            except ThrottleOverloaded as e:
                                retry_after_s = e.retry_after_s or 5
                                return {
                                    "result": {
                                        "name": member.full_name,
                                        "success": False,
                                        "message": f"Высокая нагрузка. Попробуй ещё раз через {retry_after_s} сек.",
                                        "user_id": member.telegram_id,
                                        "is_self": _is_self,
                                    },
                                    "log": AttendanceLog(
                                        user_id=member.id,
                                        qr_data=redacted_qr_data,
                                        success=False,
                                        error_message="Высокая нагрузка (очередь)",
                                    ),
                                    "is_current_user_unauth": False,
                                    "session_update": None,
                                }

                            if mark_result.success:
                                member.last_mirea_sync_at = datetime.utcnow()

                            updated_blob: str | None = None
                            rotated_blob = rotated_session if rotated_session and rotated_session != stored_session else None
                            try:
                                if cookies != cookies_before:
                                    updated_blob = crypto.encrypt_session(cookies)
                                elif rotated_blob:
                                    updated_blob = rotated_blob
                            except Exception:
                                updated_blob = None

                            session_update = None
                            if updated_blob and updated_blob != stored_session:
                                session_update = (member.id, stored_session, rotated_blob, updated_blob)

                            logger.info(
                                "mark result: user=%s is_self=%s success=%s msg=%r",
                                member.telegram_id, _is_self, mark_result.success, mark_result.message,
                            )
                            return {
                                "result": {
                                    "name": member.full_name,
                                    "success": mark_result.success,
                                    "message": mark_result.message,
                                    "user_id": member.telegram_id,
                                    "is_self": _is_self,
                                },
                                "log": AttendanceLog(
                                    user_id=member.id,
                                    qr_data=redacted_qr_data,
                                    success=mark_result.success,
                                    error_message=None if mark_result.success else mark_result.message,
                                ),
                                "is_current_user_unauth": False,
                                "session_update": session_update,
                            }
                        finally:
                            await api.close()
                    except Exception as e:
                        return {
                            "result": {
                                "name": member.full_name,
                                "success": False,
                                "message": f"Ошибка отметки: {str(e)}",
                                "user_id": member.telegram_id,
                                "is_self": member.id == user.id,
                            },
                            "log": AttendanceLog(
                                user_id=member.id,
                                qr_data=redacted_qr_data,
                                success=False,
                                error_message=str(e),
                            ),
                            "is_current_user_unauth": False,
                            "session_update": None,
                        }

            semaphore = asyncio.Semaphore(max(1, int(settings.attendance_per_request_concurrent)))
            tasks = [mark_single_user(member, semaphore) for member in users_to_mark]
            task_results = list(await asyncio.gather(*tasks, return_exceptions=True))

            # Auto-retry failed friend marks once (handles transient gRPC/auth errors).
            retry_pairs: list[tuple[int, User]] = []
            for i, (member, task_result) in enumerate(zip(users_to_mark, task_results)):
                if member.id == user.id:
                    continue
                if isinstance(task_result, Exception):
                    retry_pairs.append((i, member))
                    continue
                if not task_result["result"]["success"]:
                    msg = task_result["result"].get("message", "").lower()
                    permanent = "авторизован" in msg or "расшифровк" in msg
                    if not permanent:
                        retry_pairs.append((i, member))
            if retry_pairs:
                await asyncio.sleep(1.5)
                retry_tasks = [mark_single_user(m, semaphore) for _, m in retry_pairs]
                retry_results = await asyncio.gather(*retry_tasks, return_exceptions=True)
                for (orig_idx, _), retry_result in zip(retry_pairs, retry_results):
                    task_results[orig_idx] = retry_result

            session_updates: dict[int, tuple[str | None, str | None, str]] = {}
            for task_result in task_results:
                if isinstance(task_result, Exception):
                    logger.error("mark_single_user raised unexpectedly: %s", task_result, exc_info=task_result)
                    continue
                if task_result.get("is_current_user_unauth"):
                    return web.json_response(
                        {
                            "success": False,
                            "message": task_result["result"]["message"],
                            "needs_auth": True,
                        },
                        status=401,
                    )

                results.append(task_result["result"])
                if task_result.get("log"):
                    attendance_logs.append(task_result["log"])
                update_data = task_result.get("session_update")
                if update_data:
                    member_id, previous_blob, rotated_blob, new_blob = update_data
                    session_updates[member_id] = (previous_blob, rotated_blob, new_blob)

            if session_updates:
                for member_id, (previous_blob, rotated_blob, new_blob) in session_updates.items():
                    try:
                        changed = await persist_session_if_current(
                            session,
                            user_id=member_id,
                            previous_session=previous_blob,
                            updated_session=new_blob,
                        )
                        if (not changed) and rotated_blob and rotated_blob != previous_blob:
                            await persist_session_if_current(
                                session,
                                user_id=member_id,
                                previous_session=rotated_blob,
                                updated_session=new_blob,
                            )
                    except Exception:
                        logger.exception("Failed to persist rotated session for member=%s", member_id)

            if attendance_logs or session_updates:
                try:
                    if attendance_logs:
                        session.add_all(attendance_logs)
                    await session.commit()
                except Exception:
                    try:
                        await session.rollback()
                    except Exception:
                        pass

        any_success = any(r["success"] for r in results) if results else False
        all_failed = all(not r["success"] for r in results) if results else True

        if all_failed and results:
            main_message = results[0]["message"]
        elif any_success:
            main_message = "Посещаемость отмечена"
        else:
            main_message = "Нет результатов"

        return web.json_response({"success": any_success, "message": main_message, "results": results})

    except Exception as e:
        return web.json_response({"success": False, "message": str(e)}, status=500)
