"""Rate limiting for API endpoints"""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional


class RateLimiter:
    """Token bucket rate limiter"""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[datetime]] = defaultdict(list)
        self._lock = asyncio.Lock()
        self._allowed_total = 0
        self._blocked_total = 0

    async def is_allowed(self, identifier: str) -> tuple[bool, Optional[int]]:
        """
        Check if request is allowed for identifier.
        Returns (is_allowed, retry_after_seconds)
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(seconds=self.window_seconds)

            # Clean old requests
            if identifier in self._requests:
                self._requests[identifier] = [
                    req_time for req_time in self._requests[identifier]
                    if req_time > cutoff
                ]

            # Check limit
            request_count = len(self._requests[identifier])
            if request_count >= self.max_requests:
                # Calculate retry_after
                oldest_request = min(self._requests[identifier])
                retry_after = int((oldest_request + timedelta(seconds=self.window_seconds) - now).total_seconds())
                self._blocked_total += 1
                return False, max(1, retry_after)

            # Allow request and record it
            self._requests[identifier].append(now)
            self._allowed_total += 1
            return True, None

    async def cleanup(self):
        """Remove expired entries"""
        async with self._lock:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(seconds=self.window_seconds)

            for identifier in list(self._requests.keys()):
                self._requests[identifier] = [
                    req_time for req_time in self._requests[identifier]
                    if req_time > cutoff
                ]
                if not self._requests[identifier]:
                    del self._requests[identifier]

    async def snapshot(self) -> dict:
        """
        Runtime counters and current window pressure.
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(seconds=self.window_seconds)

            tracked_identifiers = 0
            requests_in_window = 0
            for identifier, stamps in self._requests.items():
                fresh = [t for t in stamps if t > cutoff]
                if fresh:
                    tracked_identifiers += 1
                    requests_in_window += len(fresh)

            return {
                "max_requests": self.max_requests,
                "window_seconds": self.window_seconds,
                "tracked_identifiers": tracked_identifiers,
                "requests_in_window": requests_in_window,
                "allowed_total": self._allowed_total,
                "blocked_total": self._blocked_total,
            }


# Rate limiters for different endpoints
attendance_limiter = RateLimiter(max_requests=10, window_seconds=60)  # 10 req/min
grades_limiter = RateLimiter(max_requests=5, window_seconds=60)  # 5 req/min
attendance_detail_limiter = RateLimiter(max_requests=10, window_seconds=60)  # 10 req/min
