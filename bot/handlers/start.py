import time
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import settings
from bot.database import async_session
from bot.database.models import User

router = Router()

# Cache buster version - increment to force Telegram to reload webapp
WEBAPP_VERSION = "v75"
# Use query string so load balancer paths always resolve
WEBAPP_PATH = f"/?v={WEBAPP_VERSION}"


@router.message(CommandStart())
async def cmd_start(message: Message):
    """Обработчик команды /start"""
    async with async_session() as session:
        # Проверяем, есть ли пользователь в БД
        result = await session.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = result.scalar_one_or_none()

        if not user:
            # Создаём нового пользователя
            user = User(
                telegram_id=message.from_user.id,
                username=message.from_user.username,
                full_name=message.from_user.full_name
            )
            session.add(user)
            await session.commit()

    # Кнопка для открытия Mini App
    base_url = settings.webapp_url.rstrip("/")
    webapp_url = f"{base_url}{WEBAPP_PATH}"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="Открыть MIREA Scanner",
            web_app=WebAppInfo(url=webapp_url)
        )]
    ])

    await message.answer(
        "MIREA Scanner\n\n"
        "Что доступно:\n"
        "• Сканер QR: отметка посещаемости за себя и друзей.\n"
        "• БРС: баллы, средний, статус зачёт/незачёт.\n"
        "• Расписание: поиск по группе, преподавателю и аудитории.\n"
        "• Карты корпусов: подробные схемы с увеличением.\n"
        "• Профиль и друзья: активная группа, статистика, до 20 друзей.\n\n"
        "Нажмите кнопку ниже, чтобы открыть мини-приложение.\n"
        "Канал разработчика: @silverhanss",
        reply_markup=keyboard
    )
