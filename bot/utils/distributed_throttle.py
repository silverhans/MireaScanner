from __future__ import annotations

"""
Distributed attendance throttle backed by Redis.

When Redis is available:
  - Concurrency limit is enforced across all worker processes via a Redis counter.
  - RPS limit is enforced via a sliding-window token bucket in Redis (Lua script).

When Redis is unavailable (connection error, timeout):
  - Automatically falls back to the in-process AsyncThrottle.
  - Falls back silently — scans are never blocked due to Redis being down.
  - Re-probes Redis every REDIS_PROBE_INTERVAL_S seconds to restore distributed mode.
"""

import asyncio
import logging
import time

from bot.utils.throttle import AsyncThrottle, ThrottleOverloaded

logger = logging.getLogger(__name__)

# How often (seconds) to re-check Redis after a failure.
_REDIS_PROBE_INTERVAL_S = 10.0

# Redis key TTL safety margin — auto-expire keys so stale in-flight counts don't persist
# across crashes.  TTL = queue_timeout_s + generous margin.
_KEY_TTL_S = 120


class DistributedThrottle:
    """
    Drop-in replacement for AsyncThrottle that uses Redis for cross-process coordination.

    Usage (identical to AsyncThrottle):
        async with distributed_throttle:
            await do_work()

    Falls back to in-process AsyncThrottle if Redis is down.
    """

    # Lua script: atomically check + increment in-flight counter.
    # Returns 1 if slot acquired, 0 if at capacity.
    _LUA_ACQUIRE = """
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= max then
    return 0
end
local new = redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
return 1
"""

    # Lua script: atomic rate-limit using token-bucket next-start timestamp.
    # Returns delay_ms (0 = no delay, >0 = sleep this many ms before proceeding).
    _LUA_RATE = """
local key = KEYS[1]
local interval_ms = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local next_ms = tonumber(redis.call('GET', key) or '0')
local delay_ms = 0
if next_ms > now_ms then
    delay_ms = next_ms - now_ms
    redis.call('SET', key, next_ms + interval_ms, 'EX', ttl)
else
    redis.call('SET', key, now_ms + interval_ms, 'EX', ttl)
end
return delay_ms
"""

    def __init__(
        self,
        *,
        name: str,
        max_concurrent: int,
        queue_timeout_s: float,
        max_rps: float | None = None,
        retry_after_s: int = 5,
        redis_url: str | None = None,
    ) -> None:
        self._name = name
        self._max_concurrent = max_concurrent
        self._queue_timeout_s = queue_timeout_s
        self._max_rps = max_rps or 0.0
        self._min_interval_ms = int(1000.0 / max_rps) if max_rps and max_rps > 0 else 0
        self._retry_after_s = retry_after_s
        self._redis_url = redis_url

        # In-process fallback
        self._local = AsyncThrottle(
            max_concurrent=max_concurrent,
            queue_timeout_s=queue_timeout_s,
            max_rps=max_rps,
            retry_after_s=retry_after_s,
        )

        self._redis: object | None = None
        self._redis_ok = False
        self._last_probe_at = 0.0
        self._redis_lock = asyncio.Lock()

        # Redis keys
        self._key_inflight = f"throttle:{name}:inflight"
        self._key_rate = f"throttle:{name}:rate"

    async def _get_redis(self):
        """Return a working Redis client or None."""
        now = time.monotonic()
        if self._redis_ok and self._redis is not None:
            return self._redis
        if now - self._last_probe_at < _REDIS_PROBE_INTERVAL_S:
            return None
        async with self._redis_lock:
            # Double-check after acquiring lock
            if self._redis_ok and self._redis is not None:
                return self._redis
            if now - self._last_probe_at < _REDIS_PROBE_INTERVAL_S:
                return None
            try:
                import redis.asyncio as aioredis
                client = aioredis.from_url(
                    self._redis_url,
                    socket_connect_timeout=1.0,
                    socket_timeout=1.0,
                    decode_responses=False,
                )
                await client.ping()
                self._redis = client
                self._redis_ok = True
                logger.info("DistributedThrottle[%s]: Redis connected", self._name)
            except Exception as e:
                self._redis = None
                self._redis_ok = False
                self._last_probe_at = time.monotonic()
                logger.warning("DistributedThrottle[%s]: Redis unavailable, using local fallback: %s", self._name, e)
            return self._redis

    async def _redis_acquire(self, redis) -> bool:
        """Try to acquire a slot in Redis. Returns True if acquired."""
        try:
            result = await redis.eval(
                self._LUA_ACQUIRE,
                1,
                self._key_inflight,
                self._max_concurrent,
                _KEY_TTL_S,
            )
            return bool(result)
        except Exception as e:
            self._redis_ok = False
            self._last_probe_at = time.monotonic()
            logger.warning("DistributedThrottle[%s]: Redis acquire failed: %s", self._name, e)
            return None  # Signal: use fallback

    async def _redis_release(self, redis) -> None:
        try:
            await redis.decr(self._key_inflight)
        except Exception:
            pass  # Best-effort

    async def _redis_rate_delay(self, redis) -> float:
        """Returns delay in seconds (0 = no delay)."""
        if self._min_interval_ms <= 0:
            return 0.0
        try:
            now_ms = int(time.time() * 1000)
            delay_ms = await redis.eval(
                self._LUA_RATE,
                1,
                self._key_rate,
                self._min_interval_ms,
                now_ms,
                _KEY_TTL_S,
            )
            return max(0.0, int(delay_ms) / 1000.0)
        except Exception as e:
            self._redis_ok = False
            self._last_probe_at = time.monotonic()
            logger.warning("DistributedThrottle[%s]: Redis rate failed: %s", self._name, e)
            return None  # Signal: use fallback

    async def __aenter__(self):
        redis = await self._get_redis() if self._redis_url else None

        if redis is not None:
            # --- Redis path ---
            deadline = time.monotonic() + self._queue_timeout_s
            while True:
                result = await self._redis_acquire(redis)
                if result is None:
                    # Redis failed mid-flight, drop to local
                    break
                if result:
                    # Slot acquired — apply rate delay
                    delay = await self._redis_rate_delay(redis)
                    if delay is None:
                        # Redis failed, release and drop to local
                        await self._redis_release(redis)
                        break
                    if delay > 0:
                        await asyncio.sleep(delay)
                    self._acquired_via_redis = True
                    return self
                # No slot yet — wait and retry
                if time.monotonic() >= deadline:
                    raise ThrottleOverloaded("queue_timeout", retry_after_s=self._retry_after_s)
                await asyncio.sleep(0.05)
            # Redis failed — fall through to local

        # --- Local fallback path ---
        self._acquired_via_redis = False
        await self._local.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if getattr(self, "_acquired_via_redis", False):
            redis = self._redis
            if redis is not None:
                await self._redis_release(redis)
        else:
            await self._local.__aexit__(exc_type, exc, tb)

    def snapshot(self) -> dict:
        base = self._local.snapshot()
        base["redis_ok"] = self._redis_ok
        base["mode"] = "redis" if self._redis_ok else "local"
        return base
