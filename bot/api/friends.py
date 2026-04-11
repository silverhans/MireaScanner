from __future__ import annotations

import json

from aiohttp import web
from sqlalchemy import select

from bot.api.common import verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import Friend, User


MAX_FRIENDS = 20


async def handle_get_friends(request: web.Request) -> web.Response:
    """Получить список друзей (принятых)."""

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
            return web.json_response({"success": True, "friends": []})

        result = await session.execute(
            select(Friend, User)
            .join(User, Friend.friend_id == User.id)
            .where(Friend.user_id == user.id, Friend.status == "accepted")
        )
        sent_friends = result.all()

        result = await session.execute(
            select(Friend, User)
            .join(User, Friend.user_id == User.id)
            .where(Friend.friend_id == user.id, Friend.status == "accepted")
        )
        received_friends = result.all()

        friends: list[dict] = []
        for friend_rel, friend_user in sent_friends:
            friends.append(
                {
                    "id": friend_user.telegram_id,
                    "name": friend_user.full_name,
                    "username": friend_user.username,
                    "authorized": friend_user.mirea_session is not None,
                    "is_favorite": friend_rel.is_favorite,
                    "relation_id": friend_rel.id,
                }
            )
        for friend_rel, friend_user in received_friends:
            friends.append(
                {
                    "id": friend_user.telegram_id,
                    "name": friend_user.full_name,
                    "username": friend_user.username,
                    "authorized": friend_user.mirea_session is not None,
                    "is_favorite": friend_rel.is_favorite,
                    "relation_id": friend_rel.id,
                }
            )

        return web.json_response({"success": True, "friends": friends, "max_friends": MAX_FRIENDS})


async def handle_get_pending_friends(request: web.Request) -> web.Response:
    """Получить входящие запросы в друзья."""

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
            return web.json_response({"success": True, "pending": []})

        result = await session.execute(
            select(Friend, User)
            .join(User, Friend.user_id == User.id)
            .where(Friend.friend_id == user.id, Friend.status == "pending")
        )
        pending = result.all()

        requests: list[dict] = []
        for friend_rel, from_user in pending:
            requests.append(
                {
                    "request_id": friend_rel.id,
                    "from_id": from_user.telegram_id,
                    "from_name": from_user.full_name,
                    "from_username": from_user.username,
                }
            )

        return web.json_response({"success": True, "pending": requests})


async def handle_send_friend_request(request: web.Request) -> web.Response:
    """Отправить запрос в друзья по username."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        friend_username = (data.get("username") or "").strip().lstrip("@")

        if not friend_username:
            return web.json_response({"success": False, "message": "Укажи username друга"}, status=400)

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()
            if not user:
                return web.json_response({"success": False, "message": "Пользователь не найден"}, status=404)

            result = await session.execute(
                select(Friend).where(
                    ((Friend.user_id == user.id) | (Friend.friend_id == user.id)),
                    Friend.status == "accepted",
                )
            )
            current_friends = len(result.scalars().all())
            if current_friends >= MAX_FRIENDS:
                return web.json_response(
                    {"success": False, "message": f"Достигнут лимит друзей ({MAX_FRIENDS})"}
                )

            result = await session.execute(select(User).where(User.username.ilike(friend_username)))
            friend = result.scalar_one_or_none()

            if not friend:
                return web.json_response(
                    {
                        "success": False,
                        "message": "Пользователь не найден. Он должен сначала запустить бота.",
                    }
                )

            if friend.id == user.id:
                return web.json_response({"success": False, "message": "Нельзя добавить себя в друзья"})

            result = await session.execute(
                select(Friend).where(
                    ((Friend.user_id == user.id) & (Friend.friend_id == friend.id))
                    | ((Friend.user_id == friend.id) & (Friend.friend_id == user.id))
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                if existing.status == "accepted":
                    return web.json_response({"success": False, "message": "Вы уже друзья"})
                if existing.status == "pending":
                    return web.json_response(
                        {"success": False, "message": "Запрос уже отправлен или ожидает подтверждения"}
                    )

            friend_request = Friend(user_id=user.id, friend_id=friend.id, status="pending")
            session.add(friend_request)
            await session.commit()

            return web.json_response({"success": True, "message": f"Запрос отправлен {friend.full_name}"})

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_accept_friend(request: web.Request) -> web.Response:
    """Принять запрос в друзья."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        request_id = data.get("request_id")

        if not request_id:
            return web.json_response({"success": False, "message": "request_id обязателен"}, status=400)

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()
            if not user:
                return web.json_response({"success": False, "message": "Пользователь не найден"}, status=404)

            result = await session.execute(
                select(Friend).where(
                    ((Friend.user_id == user.id) | (Friend.friend_id == user.id)),
                    Friend.status == "accepted",
                )
            )
            current_friends = len(result.scalars().all())
            if current_friends >= MAX_FRIENDS:
                return web.json_response(
                    {"success": False, "message": f"Достигнут лимит друзей ({MAX_FRIENDS})"}
                )

            result = await session.execute(
                select(Friend).where(Friend.id == request_id, Friend.friend_id == user.id, Friend.status == "pending")
            )
            friend_request = result.scalar_one_or_none()

            if not friend_request:
                return web.json_response({"success": False, "message": "Запрос не найден"})

            friend_request.status = "accepted"
            await session.commit()

            return web.json_response({"success": True, "message": "Друг добавлен"})

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_reject_friend(request: web.Request) -> web.Response:
    """Отклонить запрос в друзья."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        request_id = data.get("request_id")

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()
            if not user:
                return web.json_response({"success": False, "message": "Пользователь не найден"}, status=404)

            result = await session.execute(
                select(Friend).where(Friend.id == request_id, Friend.friend_id == user.id, Friend.status == "pending")
            )
            friend_request = result.scalar_one_or_none()

            if friend_request:
                await session.delete(friend_request)
                await session.commit()

            return web.json_response({"success": True, "message": "Запрос отклонён"})

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_remove_friend(request: web.Request) -> web.Response:
    """Удалить друга."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        friend_telegram_id = data.get("friend_id")

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()

            result = await session.execute(select(User).where(User.telegram_id == friend_telegram_id))
            friend = result.scalar_one_or_none()

            if not user or not friend:
                return web.json_response({"success": False, "message": "Пользователь не найден"}, status=404)

            result = await session.execute(
                select(Friend).where(
                    ((Friend.user_id == user.id) & (Friend.friend_id == friend.id))
                    | ((Friend.user_id == friend.id) & (Friend.friend_id == user.id))
                )
            )
            friend_rel = result.scalar_one_or_none()

            if friend_rel:
                await session.delete(friend_rel)
                await session.commit()

            return web.json_response({"success": True, "message": "Друг удалён"})

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_toggle_friend_favorite(request: web.Request) -> web.Response:
    """Переключить статус избранного для друга."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    try:
        data = await request.json()
        relation_id = data.get("relation_id")

        if not relation_id:
            return web.json_response({"success": False, "message": "relation_id обязателен"}, status=400)

        tg_user = json.loads(user_data.get("user", "{}"))
        telegram_id = tg_user.get("id")

        async with async_session() as session:
            result = await session.execute(select(User).where(User.telegram_id == telegram_id))
            user = result.scalar_one_or_none()

            if not user:
                return web.json_response({"success": False, "message": "Пользователь не найден"}, status=404)

            result = await session.execute(
                select(Friend).where(
                    Friend.id == relation_id,
                    ((Friend.user_id == user.id) | (Friend.friend_id == user.id)),
                )
            )
            friend_rel = result.scalar_one_or_none()

            if not friend_rel:
                return web.json_response({"success": False, "message": "Друг не найден"}, status=404)

            friend_rel.is_favorite = not friend_rel.is_favorite
            await session.commit()

            return web.json_response(
                {
                    "success": True,
                    "is_favorite": friend_rel.is_favorite,
                    "message": "Избранное обновлено",
                }
            )

    except Exception as e:
        return web.json_response({"success": False, "message": f"Ошибка: {str(e)}"}, status=500)


async def handle_get_friend_profile(request: web.Request) -> web.Response:
    """Профиль друга (только для accepted)."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return web.json_response({"success": False, "message": "Bad Telegram user"}, status=400)

    friend_tg_id_raw = (request.rel_url.query.get("telegram_id") or "").strip()
    if not friend_tg_id_raw.isdigit():
        return web.json_response({"success": False, "message": "Bad friend id"}, status=400)

    friend_telegram_id = int(friend_tg_id_raw)

    async with async_session() as session:
        me_result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        me = me_result.scalar_one_or_none()
        if not me:
            return web.json_response({"success": False, "message": "User not found"}, status=404)

        friend_result = await session.execute(select(User).where(User.telegram_id == friend_telegram_id))
        friend_user = friend_result.scalar_one_or_none()
        if not friend_user:
            return web.json_response({"success": False, "message": "Friend not found"}, status=404)

        rel_result = await session.execute(
            select(Friend).where(
                (
                    ((Friend.user_id == me.id) & (Friend.friend_id == friend_user.id))
                    | ((Friend.user_id == friend_user.id) & (Friend.friend_id == me.id))
                )
                & (Friend.status == "accepted")
            )
        )
        rel = rel_result.scalar_one_or_none()
        if not rel:
            return web.json_response({"success": False, "message": "Forbidden"}, status=403)

        login_value = friend_user.mirea_login if getattr(friend_user, "share_mirea_login", False) else None

        return web.json_response(
            {
                "success": True,
                "friend": {
                    "id": friend_user.telegram_id,
                    "name": friend_user.full_name,
                    "username": friend_user.username,
                    "authorized": friend_user.mirea_session is not None,
                    "login": login_value,
                    "login_shared": bool(getattr(friend_user, "share_mirea_login", False)),
                },
            }
        )

