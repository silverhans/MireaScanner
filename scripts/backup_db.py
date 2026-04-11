#!/usr/bin/env python3
import argparse
import datetime as dt
import gzip
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

# Allow running as a standalone script from repo root or /opt/qrscaner.
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))


def _utc_stamp() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")

def _is_postgres_url(url: str) -> bool:
    return (url or "").startswith("postgresql")


def backup_postgres(db_url: str, out_dir: Path, keep: int) -> Path:
    parsed = urlparse(db_url)
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    dbname = (parsed.path or "").lstrip("/")
    if not dbname:
        raise ValueError("PostgreSQL URL must include a database name")

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = _utc_stamp()
    out_path = out_dir / f"{dbname}.{stamp}.dump"

    env = os.environ.copy()
    if password:
        env["PGPASSWORD"] = password

    cmd = [
        "pg_dump",
        "-Fc",
        "-f",
        str(out_path),
        "-h",
        host,
        "-p",
        str(port),
        "-U",
        user,
        dbname,
    ]
    subprocess.run(cmd, env=env, check=True)

    # Rotate old backups.
    candidates = sorted(out_dir.glob(f"{dbname}.*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in candidates[keep:]:
        try:
            old.unlink()
        except Exception:
            pass

    return out_path


def backup_sqlite(db_path: Path, out_dir: Path, keep: int, gzip_out: bool) -> Path:
    if not db_path.exists():
        raise FileNotFoundError(str(db_path))

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = _utc_stamp()
    out_path = out_dir / f"{db_path.name}.{stamp}.backup"

    # Consistent snapshot, even if the DB is being written to (WAL mode compatible).
    with sqlite3.connect(str(db_path)) as src, sqlite3.connect(str(out_path)) as dst:
        src.backup(dst)

    if gzip_out:
        gz_path = out_path.with_suffix(out_path.suffix + ".gz")
        with open(out_path, "rb") as f_in, gzip.open(gz_path, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out)
        out_path.unlink(missing_ok=True)
        out_path = gz_path

    # Rotate old backups.
    patterns = [
        f"{db_path.name}.*.backup",
        f"{db_path.name}.*.backup.gz",
    ]
    candidates: list[Path] = []
    for pat in patterns:
        candidates.extend(out_dir.glob(pat))
    candidates = sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)
    for old in candidates[keep:]:
        try:
            old.unlink()
        except Exception:
            pass

    return out_path


def main() -> int:
    p = argparse.ArgumentParser(description="Create a rotated DB backup (SQLite or PostgreSQL).")
    p.add_argument(
        "--db",
        default=os.getenv("QRS_DB_PATH", "data/bot.db"),
        help="SQLite DB path (used only when DATABASE_URL is not postgresql).",
    )
    p.add_argument("--out-dir", default=os.getenv("QRS_BACKUP_DIR", "data/backups"))
    p.add_argument("--keep", type=int, default=int(os.getenv("QRS_BACKUP_KEEP", "14")))
    p.add_argument("--gzip", action="store_true", default=os.getenv("QRS_BACKUP_GZIP", "").lower() in {"1", "true", "yes"})
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    keep = max(1, int(args.keep))

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        try:
            from bot.config import settings  # Local import to keep script usable without bot deps.
            db_url = settings.database_url
        except Exception:
            db_url = ""
    if _is_postgres_url(db_url):
        out_path = backup_postgres(db_url, out_dir, keep)
    else:
        out_path = backup_sqlite(Path(args.db), out_dir, keep, bool(args.gzip))

    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
