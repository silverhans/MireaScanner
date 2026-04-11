"""
API-only worker process (no Telegram bot polling).

Used when running multiple workers behind nginx.
The main process (bot.main) handles bot polling + API on port 8080.
Additional workers (this module) handle only API on ports 8081, 8082, ...
"""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from aiohttp import web
import aiohttp_cors

from bot.config import settings
from bot.services.api_middlewares import json_error_middleware, rate_limit_middleware, request_id_middleware
from bot.services.webapp_api import setup_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - [worker] - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def _build_cors_defaults() -> dict:
    allowed: set[str] = set()
    webapp_url = (getattr(settings, "webapp_url", "") or "").strip()
    if webapp_url:
        try:
            parsed = urlparse(webapp_url)
            if parsed.scheme and parsed.netloc:
                allowed.add(f"{parsed.scheme}://{parsed.netloc}")
        except Exception:
            pass
    allowed.update({
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    })
    if not allowed or (len(allowed) == 4 and not webapp_url):
        allowed = {"*"}
    opts = aiohttp_cors.ResourceOptions(
        allow_credentials=True,
        expose_headers="*",
        allow_headers="*",
        allow_methods="*",
    )
    return {origin: opts for origin in sorted(allowed)}


async def main(port: int):
    app = web.Application(middlewares=[
        request_id_middleware,
        json_error_middleware,
        rate_limit_middleware,
    ])
    app["started_monotonic"] = asyncio.get_running_loop().time()
    setup_routes(app)

    cors = aiohttp_cors.setup(app, defaults=_build_cors_defaults())
    for route in list(app.router.routes()):
        cors.add(route)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, settings.api_bind_host, port)
    logger.info("API worker starting on %s:%d", settings.api_bind_host, port)
    await site.start()

    # Run forever
    await asyncio.Event().wait()


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    asyncio.run(main(port))
