from sqlalchemy import text, event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from bot.config import settings


class Base(DeclarativeBase):
    pass


def _pg_pool_kwargs() -> dict:
    # Total PostgreSQL connections budget: ~90 (safe under default max_connections=100).
    # Divide evenly across workers so total never exceeds budget.
    workers = max(1, int(getattr(settings, "worker_count", 1)))
    pool_size = max(5, 20 // workers)
    max_overflow = max(10, 40 // workers)
    return {"pool_size": pool_size, "max_overflow": max_overflow}

_pool_kwargs = _pg_pool_kwargs() if not settings.database_url.startswith("sqlite") else {}
engine = create_async_engine(settings.database_url, echo=False, **_pool_kwargs)


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite:")


if _is_sqlite(settings.database_url):
    # Ensure PRAGMAs apply to every new DB-API connection.
    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()
        except Exception:
            pass
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_run_migrations)


def _run_migrations(sync_conn):
    try:
        # SQLite lightweight migrations (no alembic).
        if _is_sqlite(settings.database_url):
            # Persistent-ish settings (journal_mode may be reset by some environments).
            try:
                sync_conn.execute(text("PRAGMA journal_mode=WAL"))
                sync_conn.execute(text("PRAGMA synchronous=NORMAL"))
            except Exception:
                pass

            columns = sync_conn.execute(text("PRAGMA table_info(users)")).fetchall()
            names = {col[1] for col in columns}
            if "mirea_login" not in names:
                sync_conn.execute(text("ALTER TABLE users ADD COLUMN mirea_login VARCHAR(255)"))
            if "share_mirea_login" not in names:
                sync_conn.execute(text("ALTER TABLE users ADD COLUMN share_mirea_login INTEGER NOT NULL DEFAULT 0"))

            friend_columns = sync_conn.execute(text("PRAGMA table_info(friends)")).fetchall()
            friend_names = {col[1] for col in friend_columns}
            if "is_favorite" not in friend_names:
                sync_conn.execute(text("ALTER TABLE friends ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"))

            return

        # Minimal Postgres-compatible migrations for backwards compatibility.
        # Non-blocking: if the DB user has no ALTER privileges, the app still starts,
        # but features relying on the column may not work until schema is updated.
        if settings.database_url.startswith("postgresql"):
            try:
                sync_conn.execute(
                    text("ALTER TABLE friends ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE")
                )
            except Exception:
                pass
            return
    except Exception:
        # Не блокируем запуск, если миграция не удалась
        pass


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
