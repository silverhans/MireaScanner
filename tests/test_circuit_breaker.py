import asyncio
import unittest


from bot.utils.circuit_breaker import CircuitBreaker  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestCircuitBreakerClosed(unittest.TestCase):
    def test_starts_closed(self):
        cb = CircuitBreaker("test", failure_threshold=3, open_cooldown_s=10.0)
        decision = _run(cb.allow())
        self.assertTrue(decision.allowed)

    def test_allows_after_some_failures(self):
        cb = CircuitBreaker("test", failure_threshold=3, open_cooldown_s=10.0)
        _run(cb.record_failure())
        _run(cb.record_failure())
        decision = _run(cb.allow())
        self.assertTrue(decision.allowed)

    def test_success_resets_failure_count(self):
        cb = CircuitBreaker("test", failure_threshold=3, open_cooldown_s=10.0)
        _run(cb.record_failure())
        _run(cb.record_failure())
        _run(cb.record_success())
        _run(cb.record_failure())
        _run(cb.record_failure())
        # 2 failures after reset — still under threshold
        decision = _run(cb.allow())
        self.assertTrue(decision.allowed)


class TestCircuitBreakerOpen(unittest.TestCase):
    def _open_breaker(self, cb, n=None):
        n = n or cb.failure_threshold
        for _ in range(n):
            _run(cb.record_failure())

    def test_opens_at_threshold(self):
        cb = CircuitBreaker("test", failure_threshold=3, open_cooldown_s=100.0)
        self._open_breaker(cb)
        decision = _run(cb.allow())
        self.assertFalse(decision.allowed)
        self.assertIsNotNone(decision.retry_after_s)
        self.assertGreater(decision.retry_after_s, 0)

    def test_rejects_multiple_calls_when_open(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=100.0)
        self._open_breaker(cb)
        for _ in range(5):
            decision = _run(cb.allow())
            self.assertFalse(decision.allowed)

    def test_snapshot_shows_open_state(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=10.0)
        self._open_breaker(cb)
        snap = _run(cb.snapshot())
        self.assertEqual(snap["state"], "open")
        self.assertEqual(snap["consecutive_failures"], 2)
        self.assertEqual(snap["failures_total"], 2)
        self.assertIsNotNone(snap["retry_after_s"])


class TestCircuitBreakerHalfOpen(unittest.TestCase):
    def _make_half_open(self, cb):
        """Open the breaker then force cooldown elapsed by manipulating _opened_until."""
        for _ in range(cb.failure_threshold):
            _run(cb.record_failure())
        # Pretend cooldown elapsed.
        cb._opened_until = 0.0

    def test_transitions_to_half_open(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=0.0, half_open_max_calls=2)
        for _ in range(2):
            _run(cb.record_failure())
        # Cooldown is 0 — should transition to half_open on next allow().
        decision = _run(cb.allow())
        self.assertTrue(decision.allowed)
        self.assertEqual(cb._state, "half_open")

    def test_limits_probe_calls(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=100.0, half_open_max_calls=1)
        self._make_half_open(cb)
        d1 = _run(cb.allow())
        self.assertTrue(d1.allowed)
        # Second probe should be rejected.
        d2 = _run(cb.allow())
        self.assertFalse(d2.allowed)
        self.assertEqual(d2.retry_after_s, 1)

    def test_success_closes_from_half_open(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=100.0, half_open_max_calls=2)
        self._make_half_open(cb)
        _run(cb.allow())  # probe
        _run(cb.record_success())
        self.assertEqual(cb._state, "closed")
        # Should freely allow now.
        decision = _run(cb.allow())
        self.assertTrue(decision.allowed)

    def test_failure_in_half_open_reopens(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=100.0, half_open_max_calls=2)
        self._make_half_open(cb)
        _run(cb.allow())  # probe
        # Fail enough to hit threshold again.
        _run(cb.record_failure())
        _run(cb.record_failure())
        self.assertEqual(cb._state, "open")

    def test_half_open_in_flight_decrements_on_success(self):
        cb = CircuitBreaker("test", failure_threshold=2, open_cooldown_s=100.0, half_open_max_calls=2)
        self._make_half_open(cb)
        _run(cb.allow())  # in_flight = 1
        self.assertEqual(cb._half_open_in_flight, 1)
        _run(cb.record_success())  # in_flight = 0, state = closed
        self.assertEqual(cb._half_open_in_flight, 0)

    def test_half_open_in_flight_decrements_on_failure(self):
        cb = CircuitBreaker("test", failure_threshold=5, open_cooldown_s=100.0, half_open_max_calls=2)
        self._make_half_open(cb)
        _run(cb.allow())  # in_flight = 1
        self.assertEqual(cb._half_open_in_flight, 1)
        _run(cb.record_failure())  # in_flight = 0
        self.assertEqual(cb._half_open_in_flight, 0)


class TestCircuitBreakerSnapshot(unittest.TestCase):
    def test_initial_snapshot(self):
        cb = CircuitBreaker("my_service", failure_threshold=3, open_cooldown_s=10.0)
        snap = _run(cb.snapshot())
        self.assertEqual(snap["name"], "my_service")
        self.assertEqual(snap["state"], "closed")
        self.assertEqual(snap["consecutive_failures"], 0)
        self.assertEqual(snap["failures_total"], 0)
        self.assertEqual(snap["success_total"], 0)
        self.assertIsNone(snap["retry_after_s"])
        self.assertIsNone(snap["last_failure_s_ago"])
        self.assertIsNone(snap["last_success_s_ago"])

    def test_counters_accumulate(self):
        cb = CircuitBreaker("test", failure_threshold=10, open_cooldown_s=10.0)
        _run(cb.record_failure())
        _run(cb.record_failure())
        _run(cb.record_success())
        _run(cb.record_failure())
        snap = _run(cb.snapshot())
        self.assertEqual(snap["failures_total"], 3)
        self.assertEqual(snap["success_total"], 1)
        self.assertEqual(snap["consecutive_failures"], 1)
        self.assertIsNotNone(snap["last_failure_s_ago"])
        self.assertIsNotNone(snap["last_success_s_ago"])


if __name__ == "__main__":
    unittest.main()
