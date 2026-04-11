from __future__ import annotations

import asyncio
import hmac
from datetime import datetime, timezone

from aiohttp import web
from sqlalchemy import text

from bot.api.attendance import attendance_throttle
from bot.api.common import load_build_info
from bot.config import settings
from bot.database import async_session
from bot.utils.rate_limiter import attendance_limiter, grades_limiter
from bot.utils.upstreams import snapshot_all


async def handle_health(request: web.Request) -> web.Response:
    """
    Liveness/readiness endpoint.
    Does not require Telegram init data.
    """

    started = request.app.get("started_monotonic")
    now_mono = asyncio.get_running_loop().time()
    uptime_s = int(max(0.0, now_mono - float(started or now_mono)))

    # Public health endpoint: keep payload minimal to avoid exposing internal
    # runtime metrics, deploy metadata, and rate-limit details to all users.
    db_ok = True
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    payload = {
        "ok": bool(db_ok),
        "db_ok": bool(db_ok),
        "uptime_s": uptime_s,
        "time_utc": datetime.now(timezone.utc).isoformat() + "Z",
    }
    resp = web.json_response(payload)
    resp.headers["Cache-Control"] = "no-store"
    return resp


async def handle_health_details(request: web.Request) -> web.Response:
    """
    Internal health details endpoint (protected by token).

    Requires `HEALTH_DETAILS_TOKEN` to be configured in `.env` and passed via
    `X-Health-Token` header. If token is not configured, the endpoint is disabled.
    """

    expected = (settings.health_details_token or "").strip()
    if not expected:
        raise web.HTTPNotFound()

    provided = (request.headers.get("X-Health-Token") or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        # Do not leak that the endpoint exists.
        raise web.HTTPNotFound()

    started = request.app.get("started_monotonic")
    now_mono = asyncio.get_running_loop().time()
    uptime_s = int(max(0.0, now_mono - float(started or now_mono)))

    db_ok = True
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    try:
        attendance_limiter_stats = await attendance_limiter.snapshot()
    except Exception:
        attendance_limiter_stats = None

    try:
        grades_limiter_stats = await grades_limiter.snapshot()
    except Exception:
        grades_limiter_stats = None

    build_info = load_build_info()

    payload = {
        "ok": bool(db_ok),
        "uptime_s": uptime_s,
        "db_ok": db_ok,
        "time_utc": datetime.now(timezone.utc).isoformat() + "Z",
        "version": build_info.get("version"),
        "mirea_proxy_enabled": bool(settings.mirea_proxy),
    }
    payload["runtime"] = {
        "attendance_throttle": attendance_throttle.snapshot(),
        "attendance_limiter": attendance_limiter_stats,
        "grades_limiter": grades_limiter_stats,
        "upstreams": await snapshot_all(),
    }
    if build_info:
        payload["build"] = build_info

    resp = web.json_response(payload)
    resp.headers["Cache-Control"] = "no-store"
    return resp
