import asyncio
import logging
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import web
import aiohttp_cors
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from bot.config import settings
from bot.database import init_db
from bot.handlers import main_router
from bot.services.api_middlewares import json_error_middleware, rate_limit_middleware, request_id_middleware
from bot.services.webapp_api import setup_routes

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def _build_cors_defaults() -> dict:
    """
    Restrict CORS to the Mini App origin(s).

    Notes:
    - Browsers enforce CORS; server-to-server clients (curl/smoke tests) are unaffected.
    - We keep localhost origins for development.
    """
    allowed: set[str] = set()

    # Production origin from WEBAPP_URL.
    webapp_url = (getattr(settings, "webapp_url", "") or "").strip()
    if webapp_url:
        try:
            parsed = urlparse(webapp_url)
            if parsed.scheme and parsed.netloc:
                allowed.add(f"{parsed.scheme}://{parsed.netloc}")
        except Exception:
            pass

    # Dev origins.
    allowed.update(
        {
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        }
    )

    # Fail-safe: keep old behavior if WEBAPP_URL is missing/invalid to avoid breaking prod by misconfig.
    if not allowed or (len(allowed) == 4 and not webapp_url):
        logger.warning("CORS: WEBAPP_URL missing/invalid, falling back to wildcard origin")
        allowed = {"*"}

    opts = aiohttp_cors.ResourceOptions(
        allow_credentials=True,
        expose_headers="*",
        allow_headers="*",
        allow_methods="*",
    )
    return {origin: opts for origin in sorted(allowed)}


async def main():
    # Создаём папку для БД
    Path("data").mkdir(exist_ok=True)

    # Инициализируем БД
    await init_db()
    logger.info("Database initialized")

    # Создаём бота и диспетчер
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    dp = Dispatcher()

    # Регистрируем роутеры
    dp.include_router(main_router)

    # Создаём веб-приложение для API
    app = web.Application(middlewares=[
        request_id_middleware,
        json_error_middleware,
        rate_limit_middleware,
    ])
    app["started_monotonic"] = asyncio.get_running_loop().time()
    setup_routes(app)

    # Настраиваем CORS для Mini App
    cors = aiohttp_cors.setup(app, defaults=_build_cors_defaults())
    for route in list(app.router.routes()):
        cors.add(route)

    # Запускаем API сервер
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, settings.api_bind_host, int(settings.api_port))

    logger.info(f"Starting API server on {settings.api_bind_host}:{int(settings.api_port)}...")
    await site.start()

    # Запускаем бота
    logger.info("Starting bot...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
