"""Offline quiescence timing regression using a clock that charges read overhead."""
import socket
import unittest
from unittest.mock import patch

import test_diagnostic_flow as flow
import test_diagnostic_system as system


class Clock(flow.Clock):
    def monotonic(self):
        self.advance(0.001)
        return self.mono

    def sleep(self, seconds):
        if seconds < 0:
            raise AssertionError('synthetic sleep must not move time backwards')
        self.advance(seconds)


class Backend(flow.Backend):
    def __init__(self, clock):
        super().__init__(clock)
        self.quiescences = []
        self.adapter = object.__new__(system.load().SystemBackend)
        self.adapter.clock = clock

    def quiesce(self, seconds, timeout):
        self.calls.append(('quiesce', timeout))
        started = self.clock.mono
        proof = self.adapter.quiesce(seconds, timeout)
        self.quiescences.append({'seconds': proof['seconds'], 'elapsed': self.clock.mono - started,
                                 'allowance': timeout})
        return proof


class DiagnosticQuiescenceTests(unittest.TestCase):
    def test_clock_crossing_quiet_target_between_reads_never_causes_negative_sleep(self):
        class PausingClock(Clock):
            def __init__(self):
                super().__init__()
                self.origin, self.armed, self.paused = self.mono, False, False

            def monotonic(self):
                if self.armed and not self.paused:
                    self.advance(0.3)
                    self.paused = True
                now = super().monotonic()
                if now - self.origin >= 39.5:
                    self.armed = True
                return now

        clock = PausingClock()
        adapter = object.__new__(system.load().SystemBackend)
        adapter.clock = clock
        try:
            proof = adapter.quiesce(seconds=40, timeout=41)
        except AssertionError:
            proof = None

        self.assertIsInstance(proof, dict, 'crossing the quiet target must end the wait without a negative sleep')
        self.assertTrue(clock.paused)
        self.assertGreaterEqual(clock.mono - clock.origin, 40)
        self.assertLessEqual(clock.mono - clock.origin, 41)

    def test_both_exact_forty_second_waits_allow_clock_overhead_without_extending_window(self):
        clock = Clock()
        backend = Backend(clock)
        with patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden')):
            result = flow.diag.Runner(backend, clock).run()

        self.assertTrue(result['passed'], 'clock-read overhead must not make a full quiescence allowance insufficient: ' + repr(result.get('failure')))
        self.assertEqual(len(backend.quiescences), 2)
        for wait in backend.quiescences:
            self.assertEqual(wait['seconds'], 40)
            self.assertEqual(wait['allowance'], 41)
            self.assertGreaterEqual(wait['elapsed'], 40)
            self.assertLessEqual(wait['elapsed'], 41)
        self.assertEqual(result['window']['maximum_seconds'], 900)
        self.assertEqual(result['window']['cleanup_reserve_seconds'], 95)
        self.assertLessEqual(result['elapsed_seconds'], 900)
        self.assertEqual(result['checks']['first_graceful_stop'], 'passed')
        self.assertEqual(result['checks']['final_graceful_stop'], 'passed')


if __name__ == '__main__':
    unittest.main()
