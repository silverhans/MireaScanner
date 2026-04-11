from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


@dataclass(frozen=True)
class Migration:
    """Single DB migration, applied once and recorded in schema_migrations."""

    id: str
    description: str
    apply: Callable[[AsyncConnection], Awaitable[None]]


async def _apply_baseline(_conn: AsyncConnection) -> None:
    # Intentionally empty. This lets us "stamp" an existing DB as managed.
    return


async def _apply_add_friends_is_favorite(conn: AsyncConnection) -> None:
    dialect = conn.dialect.name

    if dialect == "sqlite":
        rows = await conn.execute(text("PRAGMA table_info(friends)"))
        cols = {r[1] for r in rows.fetchall()}
        if "is_favorite" not in cols:
            await conn.execute(
                text("ALTER TABLE friends ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0")
            )
        return

    if dialect == "postgresql":
        # Keep it idempotent and safe during rollouts.
        await conn.execute(
            text("ALTER TABLE friends ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(text("UPDATE friends SET is_favorite = FALSE WHERE is_favorite IS NULL"))
        return

    # Unknown dialect: no-op (we still keep the code deployable).
    return


async def _apply_profile_v2_user_settings(conn: AsyncConnection) -> None:
    """users: add profile settings/sync fields + attendance index."""
    dialect = conn.dialect.name

    if dialect == "sqlite":
        rows = await conn.execute(text("PRAGMA table_info(users)"))
        cols = {r[1] for r in rows.fetchall()}

        if "last_mirea_sync_at" not in cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN last_mirea_sync_at DATETIME"))
        if "mark_with_friends_default" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN mark_with_friends_default INTEGER NOT NULL DEFAULT 0")
            )
        if "auto_select_favorites" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN auto_select_favorites INTEGER NOT NULL DEFAULT 1")
            )
        if "haptics_enabled" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN haptics_enabled INTEGER NOT NULL DEFAULT 1")
            )

        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_created_at "
                "ON attendance_logs(user_id, created_at DESC)"
            )
        )
        return

    if dialect == "postgresql":
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_mirea_sync_at TIMESTAMP")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS mark_with_friends_default BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_select_favorites BOOLEAN DEFAULT TRUE")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS haptics_enabled BOOLEAN DEFAULT TRUE")
        )
        await conn.execute(
            text(
                "UPDATE users SET mark_with_friends_default = FALSE "
                "WHERE mark_with_friends_default IS NULL"
            )
        )
        await conn.execute(
            text(
                "UPDATE users SET auto_select_favorites = TRUE "
                "WHERE auto_select_favorites IS NULL"
            )
        )
        await conn.execute(
            text(
                "UPDATE users SET haptics_enabled = TRUE "
                "WHERE haptics_enabled IS NULL"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_created_at "
                "ON attendance_logs(user_id, created_at DESC)"
            )
        )
        return

    return


async def _apply_profile_light_theme_setting(conn: AsyncConnection) -> None:
    """users: add persistent light theme toggle."""
    dialect = conn.dialect.name

    if dialect == "sqlite":
        rows = await conn.execute(text("PRAGMA table_info(users)"))
        cols = {r[1] for r in rows.fetchall()}
        if "light_theme_enabled" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN light_theme_enabled INTEGER NOT NULL DEFAULT 0")
            )
        return

    if dialect == "postgresql":
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS light_theme_enabled BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text(
                "UPDATE users SET light_theme_enabled = FALSE "
                "WHERE light_theme_enabled IS NULL"
            )
        )
        return

    return


async def _apply_esports_session(conn: AsyncConnection) -> None:
    """users: add esports_session for cyberzone JWT storage."""
    dialect = conn.dialect.name

    if dialect == "sqlite":
        rows = await conn.execute(text("PRAGMA table_info(users)"))
        cols = {r[1] for r in rows.fetchall()}
        if "esports_session" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN esports_session TEXT")
            )
        return

    if dialect == "postgresql":
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS esports_session TEXT")
        )
        return

    return


async def _apply_theme_mode(conn: AsyncConnection) -> None:
    """users: add theme_mode column for tri-state theme (dark/light/ocean)."""
    dialect = conn.dialect.name

    if dialect == "sqlite":
        rows = await conn.execute(text("PRAGMA table_info(users)"))
        cols = {r[1] for r in rows.fetchall()}
        if "theme_mode" not in cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN theme_mode VARCHAR(20)")
            )
        return

    if dialect == "postgresql":
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(20)")
        )
        # Migrate existing light_theme_enabled users to theme_mode
        await conn.execute(
            text("UPDATE users SET theme_mode = 'light' WHERE light_theme_enabled = TRUE AND theme_mode IS NULL")
        )
        return

    return


def get_migrations() -> list[Migration]:
    # Order matters.
    return [
        Migration(
            id="20260210_0001_baseline",
            description="baseline (stamp existing schema)",
            apply=_apply_baseline,
        ),
        Migration(
            id="20260210_0002_friends_is_favorite",
            description="friends: add is_favorite column",
            apply=_apply_add_friends_is_favorite,
        ),
        Migration(
            id="20260213_0003_profile_v2_user_settings",
            description="users: profile v2 settings and sync timestamp",
            apply=_apply_profile_v2_user_settings,
        ),
        Migration(
            id="20260213_0004_profile_light_theme",
            description="users: add light_theme_enabled setting",
            apply=_apply_profile_light_theme_setting,
        ),
        Migration(
            id="20260214_0005_esports_session",
            description="users: add esports_session for cyberzone booking",
            apply=_apply_esports_session,
        ),
        Migration(
            id="20260215_0006_theme_mode",
            description="users: add theme_mode for tri-state theme (dark/light/ocean)",
            apply=_apply_theme_mode,
        ),
    ]
