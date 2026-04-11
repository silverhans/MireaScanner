import asyncio
import time


class ThrottleOverloaded(Exception):
    def __init__(self, message: str = "overloaded", retry_after_s: int | None = None):
        super().__init__(message)
        self.retry_after_s = retry_after_s


class AsyncThrottle:
    """
    Global async throttle: bounds concurrency and optionally smooths start rate (RPS).

    Notes:
    - This is a process-local limiter. If you run multiple bot instances, each has its own limits.
    - RPS controls *starts* of the protected section, not HTTP requests count.
    """

    def __init__(
        self,
        *,
        max_concurrent: int,
        queue_timeout_s: float,
        max_rps: float | None = None,
        retry_after_s: int = 5,
    ):
        self._max_concurrent = int(max_concurrent)
        self._sem = asyncio.Semaphore(max_concurrent) if max_concurrent > 0 else None
        self._queue_timeout_s = max(0.0, float(queue_timeout_s))
        self._retry_after_s = int(retry_after_s)

        rps = float(max_rps) if max_rps is not None else 0.0
        self._max_rps = rps if rps > 0 else 0.0
        self._min_interval_s = (1.0 / rps) if rps > 0 else 0.0
        self._rate_lock = asyncio.Lock()
        self._next_start_at = 0.0

        # Runtime metrics (process-local, best-effort).
        self._in_flight = 0
        self._waiters = 0
        self._peak_in_flight = 0
        self._accepted_total = 0
        self._rejected_total = 0
        self._queue_wait_samples = 0
        self._queue_wait_total_s = 0.0
        self._queue_wait_max_s = 0.0
        self._last_reject_ts = 0.0

    async def __aenter__(self):
        wait_started_at = time.monotonic()
        queued = False

        if self._sem is not None:
            self._waiters += 1
            queued = True
            try:
                await asyncio.wait_for(self._sem.acquire(), timeout=self._queue_timeout_s)
            except asyncio.TimeoutError as e:
                self._rejected_total += 1
                self._last_reject_ts = time.time()
                raise ThrottleOverloaded(
                    "queue_timeout",
                    retry_after_s=self._retry_after_s,
                ) from e
            finally:
                self._waiters = max(0, self._waiters - 1)

        if queued:
            waited = max(0.0, time.monotonic() - wait_started_at)
            self._queue_wait_samples += 1
            self._queue_wait_total_s += waited
            if waited > self._queue_wait_max_s:
                self._queue_wait_max_s = waited

        try:
            if self._min_interval_s > 0:
                delay = await self._rate_delay()
                if delay > 0:
                    await asyncio.sleep(delay)
            self._accepted_total += 1
            self._in_flight += 1
            if self._in_flight > self._peak_in_flight:
                self._peak_in_flight = self._in_flight
            return self
        except Exception:
            if self._sem is not None:
                self._sem.release()
            raise

    async def __aexit__(self, exc_type, exc, tb):
        self._in_flight = max(0, self._in_flight - 1)
        if self._sem is not None:
            self._sem.release()

    async def _rate_delay(self) -> float:
        async with self._rate_lock:
            now = time.monotonic()
            if self._next_start_at <= now:
                self._next_start_at = now + self._min_interval_s
                return 0.0

            delay = self._next_start_at - now
            self._next_start_at = self._next_start_at + self._min_interval_s
            return delay

    def snapshot(self) -> dict:
        avg_wait_ms = 0.0
        if self._queue_wait_samples > 0:
            avg_wait_ms = (self._queue_wait_total_s / float(self._queue_wait_samples)) * 1000.0

        return {
            "max_concurrent": self._max_concurrent,
            "max_rps": self._max_rps if self._max_rps > 0 else None,
            "queue_timeout_s": self._queue_timeout_s,
            "retry_after_s": self._retry_after_s,
            "in_flight": self._in_flight,
            "waiters": self._waiters,
            "peak_in_flight": self._peak_in_flight,
            "accepted_total": self._accepted_total,
            "rejected_total": self._rejected_total,
            "queue_wait_avg_ms": round(avg_wait_ms, 2),
            "queue_wait_max_ms": round(self._queue_wait_max_s * 1000.0, 2),
            "last_reject_unix": int(self._last_reject_ts) if self._last_reject_ts > 0 else None,
        }
