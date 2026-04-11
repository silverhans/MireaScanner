from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from bot.database.models import User


BUILD_INFO_FILE = Path(__file__).resolve().parents[2] / "build_info.json"


def iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def verify_telegram_webapp_data(init_data: str, bot_token: str) -> dict | None:
    """
    Verify Telegram WebApp init-data signature.

    Returns:
        Parsed payload if signature is valid, otherwise None.
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

        if hmac.compare_digest(calculated_hash, received_hash):
            return {k: v[0] for k, v in parsed.items()}
        return None
    except Exception:
        return None


def redact_qr_data_for_log(qr_data: str) -> str:
    value = (qr_data or "").strip()
    if not value:
        return ""
    if value.startswith("http"):
        try:
            parsed = urlparse(value)
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?token=<redacted>"
        except Exception:
            return "<redacted_url>"
    return "<redacted_token>"


def build_full_name_from_tg_user(tg_user: dict) -> str:
    first_name = (tg_user.get("first_name") or "").strip()
    last_name = (tg_user.get("last_name") or "").strip()
    full_name = f"{first_name} {last_name}".strip()
    if not full_name:
        full_name = (tg_user.get("username") or "").strip()
    return full_name or "User"


def load_build_info() -> dict:
    """
    Read deployment metadata (if present).

    Priority:
    1) env APP_VERSION / GIT_SHA
    2) build_info.json generated during deploy
    """
    info: dict[str, str] = {}

    env_version = (os.getenv("APP_VERSION") or os.getenv("GIT_SHA") or "").strip()
    if env_version:
        info["version"] = env_version

    try:
        raw = BUILD_INFO_FILE.read_text(encoding="utf-8")
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            for key in ("version", "git_sha", "branch", "deployed_at_utc"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    if key == "version" and info.get("version"):
                        continue
                    info[key] = value.strip()
            if "version" not in info:
                fallback_sha = parsed.get("git_sha")
                if isinstance(fallback_sha, str) and fallback_sha.strip():
                    info["version"] = fallback_sha.strip()
    except Exception:
        pass

    return info


def normalize_friend_telegram_ids(raw_ids, *, max_items: int = 20) -> tuple[list[int], str | None]:
    if raw_ids is None:
        return [], None
    if not isinstance(raw_ids, list):
        return [], "friend_telegram_ids должен быть массивом"
    if len(raw_ids) > max_items:
        return [], f"Можно выбрать не более {max_items} друзей за раз"

    normalized: list[int] = []
    seen: set[int] = set()
    for raw in raw_ids:
        if isinstance(raw, bool):
            return [], "Некорректный friend_telegram_id"
        if isinstance(raw, int):
            tg_id = raw
        elif isinstance(raw, str) and raw.isdigit():
            tg_id = int(raw)
        else:
            return [], "Некорректный friend_telegram_id"

        if tg_id <= 0:
            return [], "Некорректный friend_telegram_id"
        if tg_id in seen:
            continue
        seen.add(tg_id)
        normalized.append(tg_id)

    return normalized, None


async def persist_session_if_current(
    session,
    *,
    user_id: int,
    previous_session: str | None,
    updated_session: str | None,
) -> bool:
    """
    Optimistic compare-and-set update for mirea_session.
    Prevents stale concurrent requests from overwriting a newer session blob.
    """
    if not updated_session or updated_session == previous_session:
        return False

    stmt = update(User).where(User.id == user_id)
    if previous_session is None:
        stmt = stmt.where(User.mirea_session.is_(None))
    else:
        stmt = stmt.where(User.mirea_session == previous_session)
    stmt = stmt.values(mirea_session=updated_session)

    result = await session.execute(stmt)
    changed = int(getattr(result, "rowcount", 0) or 0)
    return changed > 0


async def get_or_create_user(session, tg_user: dict) -> User | None:
    telegram_id = tg_user.get("id")
    if not telegram_id:
        return None

    username = tg_user.get("username")
    full_name = build_full_name_from_tg_user(tg_user)

    result = await session.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()

    if user:
        changed = False
        if user.username != username:
            user.username = username
            changed = True
        if full_name and user.full_name != full_name:
            user.full_name = full_name
            changed = True
        if changed:
            try:
                await session.commit()
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass
        return user

    user = User(
        telegram_id=telegram_id,
        username=username,
        full_name=full_name,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        try:
            await session.rollback()
        except Exception:
            pass
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
    return user

