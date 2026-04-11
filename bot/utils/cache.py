"""Simple in-memory cache with TTL"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


class SimpleCache:
    """Thread-safe in-memory cache with TTL"""

    def __init__(self):
        self._cache: dict[str, tuple[Any, datetime]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired"""
        async with self._lock:
            if key in self._cache:
                value, expires_at = self._cache[key]
                if datetime.now(timezone.utc) < expires_at:
                    return value
                else:
                    del self._cache[key]
            return None

    async def set(self, key: str, value: Any, ttl_seconds: int = 300):
        """Set value in cache with TTL"""
        async with self._lock:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
            self._cache[key] = (value, expires_at)

    async def delete(self, key: str):
        """Delete key from cache"""
        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self):
        """Clear entire cache"""
        async with self._lock:
            self._cache.clear()

    async def cleanup_expired(self):
        """Remove expired entries"""
        async with self._lock:
            now = datetime.now(timezone.utc)
            expired_keys = [
                key for key, (_, expires_at) in self._cache.items()
                if now >= expires_at
            ]
            for key in expired_keys:
                del self._cache[key]


# Global cache instance
cache = SimpleCache()
