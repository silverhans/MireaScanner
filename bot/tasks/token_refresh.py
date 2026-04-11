"""
Background task: periodically refresh MIREA Keycloak tokens.

Runs every 6 hours, picks users whose tokens are older than BACKGROUND_REFRESH_AGE_S
(14 days) and refreshes them in batches.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from bot.database import async_session
from bot.database.models import User
from bot.services.crypto import get_crypto
from bot.services.mirea_tokens import (
    BACKGROUND_REFRESH_AGE_S,
    get_token_age_seconds,
    try_refresh_tokens,
)
from bot.utils.upstreams import get_breaker

logger = logging.getLogger(__name__)

_INTERVAL_S = 6 * 3600  # 6 hours
_BATCH_SIZE = 10
_BATCH_DELAY_S = 2.0


async def periodic_token_refresh_task() -> None:
    """Long-running coroutine — launch via asyncio.create_task() once."""
    logger.info("token_refresh: background task started (interval=%ds)", _INTERVAL_S)
    while True:
        try:
            await asyncio.sleep(_INTERVAL_S)
            await _refresh_cycle()
        except asyncio.CancelledError:
            logger.info("token_refresh: task cancelled")
            break
        except Exception:
            logger.exception("token_refresh: unexpected error in cycle")
            await asyncio.sleep(60)


async def _refresh_cycle() -> None:
    breaker = get_breaker("mirea_sso")
    if breaker.state == "open":
        logger.warning("token_refresh: mirea_sso breaker is open, skipping cycle")
        return

    crypto = get_crypto()

    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.mirea_session.isnot(None))
        )
        users = list(result.scalars().all())

    if not users:
        return

    total = 0
    refreshed = 0
    failed = 0
    skipped = 0

    for i in range(0, len(users), _BATCH_SIZE):
        batch = users[i : i + _BATCH_SIZE]

        if breaker.state == "open":
            logger.warning("token_refresh: breaker opened mid-cycle, stopping")
            break

        for user in batch:
            total += 1
            try:
                cookies, _ = crypto.decrypt_session_for_db(user.mirea_session)
            except Exception:
                skipped += 1
                continue

            if not cookies:
                skipped += 1
                continue

            age = get_token_age_seconds(cookies)
            if age is not None and age < BACKGROUND_REFRESH_AGE_S:
                skipped += 1
                continue

            stored_session = user.mirea_session
            try:
                ok = await try_refresh_tokens(cookies)
            except Exception:
                failed += 1
                continue

            if ok:
                refreshed += 1
                updated_session = crypto.encrypt_session(cookies)
                async with async_session() as session:
                    from bot.api.common import persist_session_if_current

                    saved = await persist_session_if_current(
                        session,
                        user_id=user.id,
                        previous_session=stored_session,
                        updated_session=updated_session,
                    )
                    if saved:
                        await session.commit()
            else:
                failed += 1

        if i + _BATCH_SIZE < len(users):
            await asyncio.sleep(_BATCH_DELAY_S)

    logger.info(
        "token_refresh: cycle done — total=%d refreshed=%d failed=%d skipped=%d",
        total,
        refreshed,
        failed,
        skipped,
    )
