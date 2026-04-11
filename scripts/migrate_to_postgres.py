#!/usr/bin/env python3
"""
Migrate data from SQLite to PostgreSQL for QRScaner.

Safety:
- No credentials are stored in this repository.
- By default the script only prints a plan and exits (dry-run).
- To execute, pass --execute explicitly.

Usage examples:
  SRC_DATABASE_URL="sqlite+aiosqlite:///./data/bot.db" \
  DST_DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@127.0.0.1:5432/qrscaner" \
  python3 scripts/migrate_to_postgres.py --execute --truncate-dst
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# Allow running as a standalone script from repo root.
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from bot.database.models import AttendanceLog, Base, Friend, User  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate QRScaner data from SQLite to PostgreSQL")
    parser.add_argument(
        "--src",
        default=os.environ.get("SRC_DATABASE_URL"),
        help="Source DB URL (env: SRC_DATABASE_URL). Example: sqlite+aiosqlite:///./data/bot.db",
    )
    parser.add_argument(
        "--dst",
        default=os.environ.get("DST_DATABASE_URL"),
        help="Destination DB URL (env: DST_DATABASE_URL). Example: postgresql+asyncpg://user:pass@localhost/db",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually perform migration (default: dry-run, no writes).",
    )
    parser.add_argument(
        "--truncate-dst",
        action="store_true",
        help="Truncate destination tables before import (required if dst is not empty).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Batch size for inserts (default: 1000).",
    )
    return parser.parse_args()


async def _count_rows(session, model) -> int:
    res = await session.execute(select(func.count()).select_from(model))
    return int(res.scalar() or 0)


async def _truncate_destination(session) -> None:
    # Order does not matter with CASCADE.
    await session.execute(
        text("TRUNCATE TABLE attendance_logs, friends, users RESTART IDENTITY CASCADE;")
    )
    await session.commit()


async def _reset_sequences(session) -> None:
    # Keep identities consistent after inserting explicit IDs.
    seq_sql = [
        """
        SELECT setval(
            pg_get_serial_sequence('users','id'),
            COALESCE((SELECT MAX(id) FROM users), 1),
            (SELECT MAX(id) IS NOT NULL FROM users)
        );
        """,
        """
        SELECT setval(
            pg_get_serial_sequence('friends','id'),
            COALESCE((SELECT MAX(id) FROM friends), 1),
            (SELECT MAX(id) IS NOT NULL FROM friends)
        );
        """,
        """
        SELECT setval(
            pg_get_serial_sequence('attendance_logs','id'),
            COALESCE((SELECT MAX(id) FROM attendance_logs), 1),
            (SELECT MAX(id) IS NOT NULL FROM attendance_logs)
        );
        """,
    ]
    for sql in seq_sql:
        await session.execute(text(sql))
    await session.commit()


async def _migrate_table(
    *,
    src_session,
    dst_session,
    model,
    make_row,
    batch_size: int,
) -> int:
    migrated = 0
    batch = []

    stream = await src_session.stream_scalars(
        select(model).order_by(model.id).execution_options(yield_per=batch_size)
    )
    async for row in stream:
        batch.append(make_row(row))
        if len(batch) >= batch_size:
            dst_session.add_all(batch)
            await dst_session.commit()
            migrated += len(batch)
            batch.clear()

    if batch:
        dst_session.add_all(batch)
        await dst_session.commit()
        migrated += len(batch)

    return migrated


async def main() -> int:
    args = _parse_args()

    if not args.src or not args.dst:
        print("ERROR: --src/--dst are required (or env SRC_DATABASE_URL / DST_DATABASE_URL).")
        return 2

    if not args.src.startswith("sqlite"):
        print("WARN: source does not look like SQLite URL:", args.src)
    if not args.dst.startswith("postgresql"):
        print("WARN: destination does not look like PostgreSQL URL:", args.dst)

    sqlite_engine = create_async_engine(args.src, echo=False)
    postgres_engine = create_async_engine(args.dst, echo=False)

    try:
        # Create tables in destination if needed.
        async with postgres_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        SrcSession = async_sessionmaker(sqlite_engine, expire_on_commit=False)
        DstSession = async_sessionmaker(postgres_engine, expire_on_commit=False)

        async with SrcSession() as src_s, DstSession() as dst_s:
            src_counts = {
                "users": await _count_rows(src_s, User),
                "friends": await _count_rows(src_s, Friend),
                "attendance_logs": await _count_rows(src_s, AttendanceLog),
            }
            dst_counts = {
                "users": await _count_rows(dst_s, User),
                "friends": await _count_rows(dst_s, Friend),
                "attendance_logs": await _count_rows(dst_s, AttendanceLog),
            }

            print("=== Migration plan ===")
            print("SRC:", args.src)
            print("DST:", args.dst)
            print("SRC rows:", src_counts)
            print("DST rows:", dst_counts)
            print("Options: execute=", args.execute, "truncate-dst=", args.truncate_dst, "batch-size=", args.batch_size)

            if not args.execute:
                print("\nDry-run: no changes were made. Add --execute to run migration.")
                return 0

            if sum(dst_counts.values()) > 0 and not args.truncate_dst:
                print("\nERROR: Destination is not empty. Use --truncate-dst to overwrite.")
                return 3

            if args.truncate_dst:
                print("\nTruncating destination tables...")
                await _truncate_destination(dst_s)
                print("✓ Destination truncated")

            print("\nMigrating users...")
            users_migrated = await _migrate_table(
                src_session=src_s,
                dst_session=dst_s,
                model=User,
                make_row=lambda u: User(
                    id=u.id,
                    telegram_id=u.telegram_id,
                    username=u.username,
                    full_name=u.full_name,
                    mirea_session=u.mirea_session,
                    mirea_login=u.mirea_login,
                    share_mirea_login=u.share_mirea_login,
                    created_at=u.created_at,
                ),
                batch_size=args.batch_size,
            )
            print("✓ Users migrated:", users_migrated)

            print("\nMigrating friends...")
            friends_migrated = await _migrate_table(
                src_session=src_s,
                dst_session=dst_s,
                model=Friend,
                make_row=lambda f: Friend(
                    id=f.id,
                    user_id=f.user_id,
                    friend_id=f.friend_id,
                    status=f.status,
                    created_at=f.created_at,
                ),
                batch_size=args.batch_size,
            )
            print("✓ Friends migrated:", friends_migrated)

            print("\nMigrating attendance logs...")
            logs_migrated = await _migrate_table(
                src_session=src_s,
                dst_session=dst_s,
                model=AttendanceLog,
                make_row=lambda l: AttendanceLog(
                    id=l.id,
                    user_id=l.user_id,
                    qr_data=l.qr_data,
                    success=l.success,
                    error_message=l.error_message,
                    created_at=l.created_at,
                ),
                batch_size=args.batch_size,
            )
            print("✓ Attendance logs migrated:", logs_migrated)

            if args.dst.startswith("postgresql"):
                print("\nResetting PostgreSQL sequences...")
                await _reset_sequences(dst_s)
                print("✓ Sequences reset")

            print("\n=== Migration complete ===")
            return 0
    finally:
        await sqlite_engine.dispose()
        await postgres_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

