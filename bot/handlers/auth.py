"""
Обработчики авторизации МИРЭА (текстовые команды)
"""
from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.filters import Command
from sqlalchemy import select

from bot.database import async_session
from bot.database.models import User
from bot.services.mirea_auth import MireaAuth, AuthChallenge
from bot.services.crypto import get_crypto

router = Router()


class AuthStates(StatesGroup):
    """Состояния для процесса авторизации"""
    waiting_for_login = State()
    waiting_for_password = State()
    waiting_for_otp = State()


@router.message(Command("auth"))
async def cmd_auth(message: Message, state: FSMContext):
    """Команда для авторизации через чат"""
    await message.answer(
        "🔑 <b>Авторизация МИРЭА</b>\n\n"
        "Введи логин от личного кабинета МИРЭА:\n"
        "<i>(обычно это email вида name@edu.mirea.ru)</i>\n\n"
        "Для отмены отправь /cancel",
        parse_mode="HTML"
    )
    await state.set_state(AuthStates.waiting_for_login)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext):
    """Отмена текущего действия"""
    current = await state.get_state()
    if current:
        await state.clear()
        await message.answer("❌ Действие отменено")


@router.message(AuthStates.waiting_for_login)
async def process_login(message: Message, state: FSMContext):
    """Получение логина"""
    if message.text == "/cancel":
        await state.clear()
        await message.answer("❌ Авторизация отменена")
        return

    login = message.text.strip()

    if len(login) < 3:
        await message.answer("⚠️ Логин слишком короткий. Попробуй ещё раз:")
        return

    await state.update_data(login=login)
    await state.set_state(AuthStates.waiting_for_password)

    await message.answer(
        "🔐 Теперь введи пароль:\n\n"
        "<i>Сообщение с паролем будет удалено после обработки</i>",
        parse_mode="HTML"
    )


@router.message(AuthStates.waiting_for_password)
async def process_password(message: Message, state: FSMContext):
    """Получение пароля и авторизация"""
    if message.text == "/cancel":
        await state.clear()
        await message.answer("❌ Авторизация отменена")
        return

    password = message.text.strip()

    # Удаляем сообщение с паролем
    try:
        await message.delete()
    except Exception:
        pass

    data = await state.get_data()
    login = data.get("login")

    status_msg = await message.answer("⏳ Выполняю вход...")

    auth = MireaAuth()
    result = await auth.login(login, password)
    await auth.close()

    if result.success and result.cookies:
        await _save_session(message.from_user.id, login, result.cookies)
        await status_msg.edit_text(
            "✅ <b>Авторизация успешна!</b>\n\n"
            "Теперь при сканировании QR-кода посещаемость будет отмечаться автоматически.\n\n"
            "Используй /start чтобы открыть приложение.",
            parse_mode="HTML"
        )
        await state.clear()
    elif result.challenge and result.challenge.kind in ("otp", "email_code"):
        # 2FA — нужен OTP-код или код с email
        await state.update_data(
            challenge_action_url=result.challenge.action_url,
            challenge_field_name=result.challenge.field_name,
            challenge_hidden_fields=result.challenge.hidden_fields,
            challenge_referer=result.challenge.referer,
            challenge_cookies=result.cookies,
            challenge_pkce_verifier=getattr(result.challenge, "pkce_verifier", None),
            challenge_redirect_uri=getattr(result.challenge, "redirect_uri", None),
            challenge_kind=result.challenge.kind,
        )
        await state.set_state(AuthStates.waiting_for_otp)
        if result.challenge.kind == "email_code":
            prompt_text = (
                "📧 <b>Требуется код подтверждения</b>\n\n"
                "На твою почту МИРЭА отправлен код.\n"
                "Проверь почту и введи код:\n\n"
                "Для отмены отправь /cancel"
            )
        else:
            prompt_text = (
                "🔐 <b>Требуется код подтверждения (2FA)</b>\n\n"
                "Введи одноразовый код из приложения-аутентификатора:\n\n"
                "Для отмены отправь /cancel"
            )
        await status_msg.edit_text(prompt_text, parse_mode="HTML")
    else:
        await status_msg.edit_text(
            f"❌ <b>Ошибка авторизации</b>\n\n"
            f"{result.message}\n\n"
            f"Попробуй ещё раз: /auth",
            parse_mode="HTML"
        )
        await state.clear()


@router.message(AuthStates.waiting_for_otp)
async def process_otp(message: Message, state: FSMContext):
    """Получение OTP-кода и завершение авторизации"""
    if message.text == "/cancel":
        await state.clear()
        await message.answer("❌ Авторизация отменена")
        return

    otp_code = message.text.strip()

    # Удаляем сообщение с кодом
    try:
        await message.delete()
    except Exception:
        pass

    data = await state.get_data()
    login = data.get("login")

    challenge = AuthChallenge(
        kind="otp",
        action_url=data["challenge_action_url"],
        field_name=data["challenge_field_name"],
        hidden_fields=data.get("challenge_hidden_fields", {}),
        referer=data.get("challenge_referer"),
        pkce_verifier=data.get("challenge_pkce_verifier"),
        redirect_uri=data.get("challenge_redirect_uri"),
    )

    status_msg = await message.answer("⏳ Проверяю код...")

    auth = MireaAuth()
    result = await auth.submit_otp(challenge, otp_code, cookies=data.get("challenge_cookies"))
    await auth.close()

    if result.success and result.cookies:
        await _save_session(message.from_user.id, login, result.cookies)
        await status_msg.edit_text(
            "✅ <b>Авторизация успешна!</b>\n\n"
            "Теперь при сканировании QR-кода посещаемость будет отмечаться автоматически.\n\n"
            "Используй /start чтобы открыть приложение.",
            parse_mode="HTML"
        )
        await state.clear()
    elif result.challenge and result.challenge.kind in ("otp", "email_code"):
        # Keycloak запросил код повторно (неверный код)
        await state.update_data(
            challenge_action_url=result.challenge.action_url,
            challenge_field_name=result.challenge.field_name,
            challenge_hidden_fields=result.challenge.hidden_fields,
            challenge_referer=result.challenge.referer,
            challenge_cookies=result.cookies or data.get("challenge_cookies"),
            challenge_pkce_verifier=getattr(result.challenge, "pkce_verifier", data.get("challenge_pkce_verifier")),
            challenge_redirect_uri=getattr(result.challenge, "redirect_uri", data.get("challenge_redirect_uri")),
            challenge_kind=result.challenge.kind,
        )
        await status_msg.edit_text(
            f"❌ {result.message}\n\n"
            "Введи код ещё раз или /cancel для отмены:",
            parse_mode="HTML"
        )
    else:
        await status_msg.edit_text(
            f"❌ <b>Ошибка</b>\n\n"
            f"{result.message}\n\n"
            f"Попробуй ещё раз: /auth",
            parse_mode="HTML"
        )
        await state.clear()


async def _save_session(telegram_id: int, login: str, cookies: dict):
    """Сохранить сессию в БД"""
    crypto = get_crypto()
    encrypted_session = crypto.encrypt_session(cookies)

    async with async_session() as session:
        db_result = await session.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = db_result.scalar_one_or_none()

        if user:
            user.mirea_session = encrypted_session
            user.mirea_login = login
            await session.commit()
