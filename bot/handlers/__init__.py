from aiogram import Router

from bot.handlers.start import router as start_router
from bot.handlers.auth import router as auth_router

main_router = Router()
main_router.include_router(start_router)
main_router.include_router(auth_router)
