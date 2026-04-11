import json
import hashlib
import hmac
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Deque
from urllib.parse import parse_qs

from aiohttp import web

from bot.config import settings

logger = logging.getLogger(__name__)


def _get_client_ip(request: web.Request) -> str:
    # Prefer real client ip passed by reverse proxy.
    real_ip = (request.headers.get("X-Real-IP") or "").strip()
    if real_ip:
        return real_ip
    xff = (request.headers.get("X-Forwarded-For") or "").strip()
    if xff:
        return xff.split(",", 1)[0].strip()
    return request.remote or "unknown"


def _verify_telegram_webapp_data(init_data: str, bot_token: str) -> dict | None:
    """
    Verify Telegram WebApp init data signature.
    Returns parsed key-value payload on success.
    """
    try:
        parsed = parse_qs(init_data or "")
        received_hash = parsed.get("hash", [None])[0]
        if not received_hash:
            return None

        data_check_arr = []
        for key, value in sorted(parsed.items()):
            if key != "hash":
                data_check_arr.append(f"{key}={value[0]}")
        data_check_string = "\n".join(data_check_arr)

        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        return {k: v[0] for k, v in parsed.items()}
    except Exception:
        return None


def _extract_tg_user_id_verified(init_data: str) -> int | None:
    """
    Extract Telegram user id from verified WebApp init_data.
    """
    try:
        verified = _verify_telegram_webapp_data(init_data or "", settings.bot_token)
        if not verified:
            return None
        raw_user = verified.get("user")
        if not raw_user:
            return None
        user = json.loads(raw_user)
        uid = user.get("id")
        return int(uid) if isinstance(uid, int) or (isinstance(uid, str) and uid.isdigit()) else None
    except Exception:
        return None


@dataclass(frozen=True)
class RateLimitRule:
    method: str
    path: str
    limit: int
    window_s: int


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, Deque[float]] = {}
        self._calls = 0

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int | None]:
        now = time.monotonic()
        dq = self._hits.get(key)
        if dq is None:
            dq = deque()
            self._hits[key] = dq

        cutoff = now - float(window_s)
        while dq and dq[0] < cutoff:
            dq.popleft()

        if len(dq) >= limit:
            retry_after = int(max(1.0, window_s - (now - dq[0])))
            return False, retry_after

        dq.append(now)

        # Occasional garbage collection to avoid unbounded growth.
        self._calls += 1
        if self._calls % 1000 == 0:
            self._gc(cutoff)

        return True, None

    def _gc(self, cutoff: float) -> None:
        to_del: list[str] = []
        for key, dq in self._hits.items():
            while dq and dq[0] < cutoff:
                dq.popleft()
            if not dq:
                to_del.append(key)
        for key in to_del:
            self._hits.pop(key, None)


RATE_LIMIT_RULES: list[RateLimitRule] = [
    RateLimitRule("POST", "/api/auth/login", limit=8, window_s=60),
    RateLimitRule("POST", "/api/auth/2fa", limit=10, window_s=60),
    RateLimitRule("POST", "/api/auth/delete-account", limit=3, window_s=3600),
    RateLimitRule("POST", "/api/attendance/mark", limit=15, window_s=60),
    RateLimitRule("POST", "/api/friends/send", limit=20, window_s=300),
    RateLimitRule("POST", "/api/friends/accept", limit=30, window_s=300),
    RateLimitRule("POST", "/api/friends/reject", limit=30, window_s=300),
    RateLimitRule("POST", "/api/friends/remove", limit=30, window_s=300),
]


_rl = SlidingWindowRateLimiter()


@web.middleware
async def request_id_middleware(request: web.Request, handler):
    request_id = uuid.uuid4().hex[:12]
    request["request_id"] = request_id
    response = await handler(request)
    if isinstance(response, web.StreamResponse):
        response.headers["X-Request-ID"] = request_id
    return response


@web.middleware
async def json_error_middleware(request: web.Request, handler):
    try:
        return await handler(request)
    except web.HTTPException as e:
        if request.path.startswith("/api"):
            payload = {"success": False, "message": e.reason}
            req_id = request.get("request_id")
            if req_id:
                payload["request_id"] = req_id
            return web.json_response(payload, status=e.status)
        raise
    except Exception:
        req_id = request.get("request_id")
        logger.exception(
            "Unhandled API error",
            extra={
                "request_id": req_id,
                "method": request.method,
                "path": request.path,
            },
        )
        payload = {"success": False, "message": "Internal server error"}
        if req_id:
            payload["request_id"] = req_id
        return web.json_response(payload, status=500)


@web.middleware
async def rate_limit_middleware(request: web.Request, handler):
    method = request.method.upper()
    path = request.path

    rule = next((r for r in RATE_LIMIT_RULES if r.method == method and r.path == path), None)
    if rule is None:
        return await handler(request)

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    tg_uid = _extract_tg_user_id_verified(init_data)
    client_ip = _get_client_ip(request)

    key = f"{rule.method}:{rule.path}:{tg_uid or client_ip}"
    allowed, retry_after = _rl.allow(key, rule.limit, rule.window_s)
    if allowed:
        return await handler(request)

    payload = {
        "success": False,
        "message": "Too many requests",
    }
    req_id = request.get("request_id")
    if req_id:
        payload["request_id"] = req_id

    resp = web.json_response(payload, status=429)
    if retry_after:
        resp.headers["Retry-After"] = str(retry_after)
    return resp
