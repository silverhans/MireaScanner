#!/usr/bin/env python3
"""
Lightweight smoke tests for the running qrscaner API.

Designed to be executed on the server right after deploy:
  ./venv/bin/python scripts/smoke_test.py --base-url http://127.0.0.1:8080

By default it only checks "local" functionality (no dependency on 3rd-party APIs).
Use --external to also validate schedule search/fetch that depends on external services.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _load_bot_token() -> str:
    """
    Load bot token via project settings (.env) or env var fallback.
    """
    try:
        root = Path(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from bot.config import settings  # type: ignore

        if settings.bot_token:
            return settings.bot_token
    except Exception:
        pass

    token = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
    if token:
        return token
    raise RuntimeError("BOT_TOKEN is not available (configure .env or export BOT_TOKEN).")


def _load_health_details_token() -> str | None:
    """
    Load token used for internal `/api/health/details` endpoint (optional).
    """
    try:
        root = Path(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from bot.config import settings  # type: ignore

        token = getattr(settings, "health_details_token", None)
        if isinstance(token, str) and token.strip():
            return token.strip()
    except Exception:
        pass
    token = os.getenv("HEALTH_DETAILS_TOKEN")
    return token.strip() if token else None


def _build_init_data(bot_token: str, *, tg_id: int, username: str) -> str:
    """
    Build and sign Telegram WebApp init data so API endpoints accept the request.
    """
    user = {
        "id": int(tg_id),
        "is_bot": False,
        "first_name": "Smoke",
        "last_name": "Test",
        "username": username,
        "language_code": "ru",
    }
    payload = {
        "auth_date": str(int(time.time())),
        "query_id": "smoke",
        "user": json.dumps(user, separators=(",", ":"), ensure_ascii=False),
    }

    data_check_string = "\n".join(f"{k}={payload[k]}" for k in sorted(payload))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    payload["hash"] = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    return urlencode(payload)


@dataclass(frozen=True)
class _HttpResp:
    status: int
    text: str
    json: dict | None


def _http_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict | None = None,
    json_body: dict | None = None,
    timeout_s: float = 12.0,
) -> _HttpResp:
    url = base_url.rstrip("/") + path
    req_headers = dict(headers or {})
    body: bytes | None = None
    if json_body is not None:
        body = json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = Request(url, data=body, headers=req_headers, method=method.upper())
    try:
        with urlopen(req, timeout=float(timeout_s)) as resp:
            body = resp.read()
            text = body.decode("utf-8", errors="replace")
            js = None
            try:
                js = json.loads(text)
            except Exception:
                js = None
            return _HttpResp(status=int(getattr(resp, "status", 200)), text=text, json=js)
    except HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        text = body.decode("utf-8", errors="replace")
        js = None
        try:
            js = json.loads(text)
        except Exception:
            js = None
        return _HttpResp(status=int(getattr(e, "code", 0) or 0), text=text, json=js)
    except URLError as e:
        raise RuntimeError(f"Network error for {url}: {e}") from e


def _http_get_json(base_url: str, path: str, *, headers: dict | None = None, timeout_s: float = 12.0) -> _HttpResp:
    return _http_json(base_url, path, method="GET", headers=headers, timeout_s=timeout_s)


def _http_post_json(
    base_url: str,
    path: str,
    *,
    headers: dict | None = None,
    payload: dict | None = None,
    timeout_s: float = 12.0,
) -> _HttpResp:
    return _http_json(base_url, path, method="POST", headers=headers, json_body=(payload or {}), timeout_s=timeout_s)


def _fail(msg: str) -> None:
    raise AssertionError(msg)


def _ok(name: str) -> None:
    print(f"[OK] {name}")


def _warn(name: str, msg: str) -> None:
    print(f"[WARN] {name}: {msg}")


def _check_health(base_url: str) -> None:
    resp = _http_get_json(base_url, "/api/health", timeout_s=8.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"health bad response: status={resp.status}")
    if not resp.json.get("db_ok", False):
        _fail(f"health db_ok=false payload={resp.json}")

    # Internal details endpoint is protected. Validate it only if token is configured.
    token = _load_health_details_token()
    if not token:
        _warn("health.details", "skipped (HEALTH_DETAILS_TOKEN not configured)")
        return

    resp2 = _http_get_json(
        base_url,
        "/api/health/details",
        headers={"X-Health-Token": token},
        timeout_s=8.0,
    )
    if resp2.status != 200 or not isinstance(resp2.json, dict):
        _fail(f"health.details bad response: status={resp2.status}")
    runtime = resp2.json.get("runtime")
    if not isinstance(runtime, dict):
        _fail(f"health.details runtime missing payload={resp2.json}")
    throttle = runtime.get("attendance_throttle")
    if not isinstance(throttle, dict):
        _fail(f"health.details attendance_throttle missing payload={resp2.json}")
    for required_key in ("max_concurrent", "queue_timeout_s", "in_flight", "waiters"):
        if required_key not in throttle:
            _fail(f"health.details attendance_throttle missing key={required_key} payload={resp2.json}")


def _check_azan(base_url: str) -> None:
    resp = _http_get_json(base_url, "/api/azan", timeout_s=10.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"azan bad response: status={resp.status}")
    if resp.json.get("success") is not True:
        _fail(f"azan success!=true payload={resp.json}")
    times = resp.json.get("times")
    if not isinstance(times, dict) or not times:
        _fail(f"azan times missing payload={resp.json}")


def _check_schedule_validation(base_url: str, headers: dict) -> None:
    # Do not hit external schedule API here: just verify init_data is accepted and handler works.
    resp = _http_get_json(base_url, "/api/schedule?type=group", headers=headers, timeout_s=10.0)
    if resp.status != 400 or not isinstance(resp.json, dict):
        _fail(f"schedule validation expected 400, got status={resp.status}")
    if resp.json.get("success") is not False:
        _fail(f"schedule validation expected success=false payload={resp.json}")


def _check_schedule_external(base_url: str, headers: dict, query: str = "ИКБО") -> None:
    # Validate that external schedule search returns something.
    search_qs = urlencode({"q": query})
    resp = _http_get_json(base_url, f"/api/groups/search?{search_qs}", headers=headers, timeout_s=15.0)
    if resp.status != 200 or not isinstance(resp.json, dict) or resp.json.get("success") is not True:
        _fail(f"groups search failed: status={resp.status} payload={resp.json}")

    groups = resp.json.get("groups")
    if not isinstance(groups, list) or not groups:
        _fail(f"groups search returned empty results (external API may be down): payload={resp.json}")

    first = groups[0]
    name = (first.get("name") if isinstance(first, dict) else None) or query
    uid = first.get("uid") if isinstance(first, dict) else None
    schedule_params = {"type": "group", "q": str(name)}
    if uid:
        schedule_params["uid"] = str(uid)
    url = f"/api/schedule?{urlencode(schedule_params)}"

    resp2 = _http_get_json(base_url, url, headers=headers, timeout_s=25.0)
    if resp2.status != 200 or not isinstance(resp2.json, dict) or resp2.json.get("success") is not True:
        _fail(f"schedule fetch failed: status={resp2.status} payload={resp2.json}")


def _check_auth_status(base_url: str, headers: dict) -> dict:
    resp = _http_get_json(base_url, "/api/auth/status", headers=headers, timeout_s=10.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"auth.status bad response: status={resp.status}")
    if resp.json.get("success") is not True:
        _fail(f"auth.status expected success=true payload={resp.json}")
    if "authorized" not in resp.json:
        _fail(f"auth.status missing authorized field payload={resp.json}")
    return resp.json


def _check_auth_status_after_logout(base_url: str, headers: dict) -> None:
    payload = _check_auth_status(base_url, headers)
    if payload.get("authorized") is not False:
        _fail(f"auth.status.after_logout expected authorized=false payload={payload}")


def _check_profile(base_url: str, headers: dict) -> dict:
    resp = _http_get_json(base_url, "/api/profile", headers=headers, timeout_s=12.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"profile bad response: status={resp.status}")
    if resp.json.get("success") is not True:
        _fail(f"profile expected success=true payload={resp.json}")
    if not isinstance(resp.json.get("account"), dict):
        _fail(f"profile missing account payload={resp.json}")
    if not isinstance(resp.json.get("attendance_stats"), dict):
        _fail(f"profile missing attendance_stats payload={resp.json}")
    return resp.json


def _check_profile_settings(base_url: str, headers: dict, profile: dict) -> None:
    account = profile.get("account")
    if not isinstance(account, dict):
        _fail(f"profile.account invalid payload={profile}")

    payload = {
        "share_mirea_login": bool(account.get("share_mirea_login", False)),
        "mark_with_friends_default": bool(account.get("mark_with_friends_default", False)),
        "auto_select_favorites": bool(account.get("auto_select_favorites", True)),
        "haptics_enabled": bool(account.get("haptics_enabled", True)),
        "light_theme_enabled": bool(account.get("light_theme_enabled", False)),
    }

    resp = _http_post_json(
        base_url,
        "/api/profile/settings",
        headers=headers,
        payload=payload,
        timeout_s=10.0,
    )
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"profile.settings bad response: status={resp.status}")
    if resp.json.get("success") is not True:
        _fail(f"profile.settings expected success=true payload={resp.json}")
    settings_payload = resp.json.get("settings")
    if not isinstance(settings_payload, dict):
        _fail(f"profile.settings missing settings object payload={resp.json}")


def _check_friends(base_url: str, headers: dict) -> None:
    resp = _http_get_json(base_url, "/api/friends", headers=headers, timeout_s=10.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"friends bad response: status={resp.status}")
    if resp.json.get("success") is not True or not isinstance(resp.json.get("friends"), list):
        _fail(f"friends unexpected payload={resp.json}")

    resp2 = _http_get_json(base_url, "/api/friends/pending", headers=headers, timeout_s=10.0)
    if resp2.status != 200 or not isinstance(resp2.json, dict):
        _fail(f"friends.pending bad response: status={resp2.status}")
    if resp2.json.get("success") is not True or not isinstance(resp2.json.get("pending"), list):
        _fail(f"friends.pending unexpected payload={resp2.json}")


def _check_attendance_validation(base_url: str, headers: dict) -> None:
    # We intentionally send empty payload to verify strict validation path.
    resp = _http_post_json(base_url, "/api/attendance/mark", headers=headers, payload={}, timeout_s=10.0)
    if resp.status != 400 or not isinstance(resp.json, dict):
        _fail(f"attendance validation expected 400, got status={resp.status}")
    if resp.json.get("success") is not False:
        _fail(f"attendance validation expected success=false payload={resp.json}")


def _check_search_validation(base_url: str, headers: dict) -> None:
    # Input too short branches should return fast and not hit upstream dependencies.
    checks = [
        ("/api/groups/search?q=I", "groups"),
        ("/api/teachers/search?q=A", "teachers"),
        ("/api/classrooms/search?q=", "classrooms"),
    ]
    for path, field in checks:
        resp = _http_get_json(base_url, path, headers=headers, timeout_s=10.0)
        if resp.status != 200 or not isinstance(resp.json, dict):
            _fail(f"search validation bad response path={path} status={resp.status}")
        if resp.json.get("success") is not True or not isinstance(resp.json.get(field), list):
            _fail(f"search validation unexpected payload path={path} payload={resp.json}")


def _check_logout(base_url: str, headers: dict) -> None:
    resp = _http_post_json(base_url, "/api/auth/logout", headers=headers, payload={}, timeout_s=10.0)
    if resp.status != 200 or not isinstance(resp.json, dict):
        _fail(f"auth.logout bad response: status={resp.status}")
    if resp.json.get("success") is not True:
        _fail(f"auth.logout expected success=true payload={resp.json}")


def _check_needs_auth_endpoints(base_url: str, headers: dict) -> None:
    # After logout these endpoints should explicitly request MIREA auth.
    checks = [
        ("GET", "/api/grades"),
        ("GET", "/api/acs/events"),
        ("POST", "/api/profile/check-connection"),
    ]
    for method, path in checks:
        if method == "POST":
            resp = _http_post_json(base_url, path, headers=headers, payload={}, timeout_s=12.0)
        else:
            resp = _http_get_json(base_url, path, headers=headers, timeout_s=12.0)

        if resp.status != 200 or not isinstance(resp.json, dict):
            _fail(f"needs_auth bad response path={path} status={resp.status}")
        if resp.json.get("success") is not False or resp.json.get("needs_auth") is not True:
            _fail(f"needs_auth unexpected payload path={path} payload={resp.json}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--tg-id", type=int, default=999000)
    parser.add_argument("--tg-username", default="smoke_test")
    parser.add_argument(
        "--external",
        action="store_true",
        help="Also validate external schedule APIs (may fail if upstream is temporarily down).",
    )
    args = parser.parse_args()

    bot_token = _load_bot_token()
    init_data = _build_init_data(bot_token, tg_id=args.tg_id, username=args.tg_username)
    headers = {"X-Telegram-Init-Data": init_data}

    failures = 0

    def run(name: str, fn) -> None:
        nonlocal failures
        try:
            fn()
            _ok(name)
        except Exception as e:
            failures += 1
            print(f"[FAIL] {name}: {e}")

    run("health", lambda: _check_health(args.base_url))
    run("azan", lambda: _check_azan(args.base_url))
    run("auth.status", lambda: _check_auth_status(args.base_url, headers))
    profile_holder: dict[str, dict] = {}

    def _capture_profile() -> None:
        profile_holder["payload"] = _check_profile(args.base_url, headers)

    run("profile", _capture_profile)
    run("profile.settings", lambda: _check_profile_settings(args.base_url, headers, profile_holder.get("payload", {})))
    run("friends", lambda: _check_friends(args.base_url, headers))
    run("attendance.validation", lambda: _check_attendance_validation(args.base_url, headers))
    run("schedule.validation", lambda: _check_schedule_validation(args.base_url, headers))
    run("search.validation", lambda: _check_search_validation(args.base_url, headers))
    run("auth.logout", lambda: _check_logout(args.base_url, headers))
    run("auth.status.after_logout", lambda: _check_auth_status_after_logout(args.base_url, headers))
    run("needs_auth_endpoints", lambda: _check_needs_auth_endpoints(args.base_url, headers))

    if args.external:
        run("schedule.external", lambda: _check_schedule_external(args.base_url, headers))
    else:
        _warn("schedule.external", "skipped (use --external)")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
