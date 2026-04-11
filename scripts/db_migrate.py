#!/usr/bin/env python3
"""
Run database migrations (safe, explicit).

Design goals:
- No auto-migrations at app startup for Postgres: run this script during deploy.
- Idempotent migrations where possible.
- Records applied migrations in `schema_migrations`.

Usage:
  # Dry-run (default)
  ./venv/bin/python scripts/db_migrate.py

  # Apply pending migrations
  ./venv/bin/python scripts/db_migrate.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Allow running as a standalone script from repo root or /opt/qrscaner.
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from bot.config import settings
from bot.database.migrations import get_migrations


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run QRScaner DB migrations")
    p.add_argument("--apply", action="store_true", help="Apply pending migrations")
    return p.parse_args()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ensure_migrations_table(conn) -> None:
    dialect = conn.dialect.name
    if dialect == "sqlite":
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "id TEXT PRIMARY KEY, "
                "applied_at TEXT NOT NULL"
                ")"
            )
        )
        return

    if dialect == "postgresql":
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "id TEXT PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ")"
            )
        )
        return

    # Unknown dialect: best effort.
    await conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "id TEXT PRIMARY KEY, "
            "applied_at TEXT NOT NULL"
            ")"
        )
    )


async def _get_applied_ids(conn) -> set[str]:
    try:
        res = await conn.execute(text("SELECT id FROM schema_migrations"))
        return {str(r[0]) for r in res.fetchall()}
    except Exception:
        return set()


async def _record_applied(conn, migration_id: str) -> None:
    dialect = conn.dialect.name
    if dialect == "postgresql":
        await conn.execute(
            text("INSERT INTO schema_migrations (id) VALUES (:id) ON CONFLICT (id) DO NOTHING"),
            {"id": migration_id},
        )
        return
    await conn.execute(
        text("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (:id, :applied_at)"),
        {"id": migration_id, "applied_at": _utc_now_iso()},
    )


async def main() -> int:
    args = _parse_args()

    engine = create_async_engine(settings.database_url, echo=False)
    try:
        async with engine.begin() as conn:
            await _ensure_migrations_table(conn)

        async with engine.begin() as conn:
            dialect = conn.dialect.name
            applied = await _get_applied_ids(conn)
            migrations = get_migrations()
            pending = [m for m in migrations if m.id not in applied]

            print("DB:", settings.database_url)
            print("Dialect:", dialect)
            print("Applied:", len(applied))
            print("Pending:", len(pending))
            for m in pending:
                print(f" - {m.id}: {m.description}")

            if not args.apply:
                if pending:
                    print("\nDry-run: no changes were made. Use --apply to execute.")
                return 0

        for m in get_migrations():
            async with engine.begin() as conn:
                applied = await _get_applied_ids(conn)
                if m.id in applied:
                    continue
                print(f"\nApplying: {m.id} ({m.description})")
                await m.apply(conn)
                await _record_applied(conn, m.id)
                print("✓ OK")

        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
