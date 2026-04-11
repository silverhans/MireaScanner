#!/usr/bin/env python3
"""
Lightweight non-destructive load canary for qrscaner API.

Default target is /api/health. Intended for post-deploy sanity checks.

Example:
  ./venv/bin/python scripts/canary_load.py \
    --base-url http://127.0.0.1:8080 \
    --path /api/health \
    --duration-s 20 \
    --concurrency 12
"""

from __future__ import annotations

import argparse
import math
import threading
import time
from dataclasses import dataclass, field
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    arr = sorted(values)
    if len(arr) == 1:
        return float(arr[0])
    rank = max(0.0, min(1.0, float(p))) * (len(arr) - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return float(arr[lo])
    w = rank - lo
    return float(arr[lo] * (1.0 - w) + arr[hi] * w)


@dataclass
class _Stats:
    started_at: float = 0.0
    finished_at: float = 0.0
    total: int = 0
    ok: int = 0
    http_4xx: int = 0
    http_5xx: int = 0
    transport_err: int = 0
    lat_ms: list[float] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, status: int, elapsed_ms: float) -> None:
        with self.lock:
            self.total += 1
            self.lat_ms.append(elapsed_ms)
            if 200 <= status < 400:
                self.ok += 1
            elif 500 <= status < 600:
                self.http_5xx += 1
            elif status >= 400:
                self.http_4xx += 1
            else:
                self.transport_err += 1


def _single_get(url: str, timeout_s: float) -> int:
    req = Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout_s) as resp:
            # Read body to avoid socket reuse issues.
            _ = resp.read()
            return int(getattr(resp, "status", 200))
    except HTTPError as e:
        try:
            _ = e.read()
        except Exception:
            pass
        return int(getattr(e, "code", 0) or 0)
    except URLError:
        return 0
    except Exception:
        return 0


def _worker(url: str, timeout_s: float, stop_at: float, stats: _Stats) -> None:
    while time.monotonic() < stop_at:
        t0 = time.perf_counter()
        status = _single_get(url, timeout_s=timeout_s)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        stats.record(status, elapsed_ms)


def _print_summary(stats: _Stats) -> None:
    elapsed = max(0.001, stats.finished_at - stats.started_at)
    rps = stats.total / elapsed
    ok_rate = (stats.ok / stats.total * 100.0) if stats.total else 0.0
    p50 = _pct(stats.lat_ms, 0.50)
    p95 = _pct(stats.lat_ms, 0.95)
    p99 = _pct(stats.lat_ms, 0.99)
    max_ms = max(stats.lat_ms) if stats.lat_ms else 0.0

    print("=== Canary Load Summary ===")
    print(f"Requests total: {stats.total}")
    print(f"Success (2xx/3xx): {stats.ok}")
    print(f"HTTP 4xx: {stats.http_4xx}")
    print(f"HTTP 5xx: {stats.http_5xx}")
    print(f"Transport errors: {stats.transport_err}")
    print(f"Success rate: {ok_rate:.2f}%")
    print(f"Throughput: {rps:.2f} req/s")
    print(f"Latency p50: {p50:.1f} ms")
    print(f"Latency p95: {p95:.1f} ms")
    print(f"Latency p99: {p99:.1f} ms")
    print(f"Latency max: {max_ms:.1f} ms")


def main() -> int:
    parser = argparse.ArgumentParser(description="Non-destructive load canary for qrscaner API.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080", help="API base url.")
    parser.add_argument("--path", default="/api/health", help="GET path to probe.")
    parser.add_argument("--duration-s", type=float, default=20.0, help="Test duration in seconds.")
    parser.add_argument("--concurrency", type=int, default=12, help="Number of worker threads.")
    parser.add_argument("--timeout-s", type=float, default=4.0, help="Per-request timeout.")
    parser.add_argument(
        "--min-success-rate",
        type=float,
        default=0.98,
        help="Minimum required success ratio (0..1). Default: 0.98",
    )
    parser.add_argument(
        "--max-5xx",
        type=int,
        default=0,
        help="Maximum allowed count of 5xx responses. Default: 0",
    )
    parser.add_argument(
        "--max-p95-ms",
        type=float,
        default=0.0,
        help="Optional upper bound for p95 latency in ms; 0 disables.",
    )
    args = parser.parse_args()

    if args.duration_s <= 0:
        print("duration-s must be > 0")
        return 2
    if args.concurrency <= 0:
        print("concurrency must be > 0")
        return 2
    if not (0.0 <= args.min_success_rate <= 1.0):
        print("min-success-rate must be between 0 and 1")
        return 2

    url = args.base_url.rstrip("/") + args.path
    print(f"Canary target: {url}")
    print(
        f"Config: duration={args.duration_s:.1f}s concurrency={args.concurrency} timeout={args.timeout_s:.1f}s"
    )

    stats = _Stats()
    stats.started_at = time.monotonic()
    stop_at = stats.started_at + float(args.duration_s)

    threads: list[threading.Thread] = []
    for idx in range(int(args.concurrency)):
        t = threading.Thread(target=_worker, args=(url, float(args.timeout_s), stop_at, stats), name=f"canary-{idx}")
        t.daemon = True
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    stats.finished_at = time.monotonic()

    _print_summary(stats)

    total = max(1, stats.total)
    success_ratio = stats.ok / total
    p95 = _pct(stats.lat_ms, 0.95)

    if success_ratio < float(args.min_success_rate):
        print(
            f"[FAIL] success ratio {success_ratio:.4f} is below threshold {float(args.min_success_rate):.4f}"
        )
        return 1
    if stats.http_5xx > int(args.max_5xx):
        print(f"[FAIL] 5xx count {stats.http_5xx} exceeds max-5xx {int(args.max_5xx)}")
        return 1
    if float(args.max_p95_ms) > 0.0 and p95 > float(args.max_p95_ms):
        print(f"[FAIL] p95 {p95:.1f} ms exceeds max-p95-ms {float(args.max_p95_ms):.1f} ms")
        return 1

    print("[OK] Canary thresholds passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
