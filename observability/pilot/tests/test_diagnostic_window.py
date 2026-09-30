"""Offline proof that the fixed diagnostic window is saved before any startup."""
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_diagnostic_flow as flow
import test_diagnostic_system as system


class Backend(flow.Backend):
    def __init__(self, clock, real):
        super().__init__(clock)
        self.real = real
        self.window_attempts = self.start_attempts = 0
        self.window_at_start = None

    def record_window(self, window):
        self.window_attempts += 1
        return self.real.record_window(window)

    def start(self, runtime_seconds, timeout):
        self.start_attempts += 1
        self.window_at_start = json.loads((self.real.spec.evidence / 'window.json').read_text())
        return super().start(runtime_seconds, timeout)


class DiagnosticWindowTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-window-proof-')
        self.addCleanup(self.tmp.cleanup)
        fixture = system.Fixture(Path(self.tmp.name), system.load())
        fixture.backend.preflight(timeout=10)
        fixture.backend.prepare(timeout=10)
        fixture.backend.approval_reference = 'OfflineWindowProof'
        self.real = fixture.backend
        self.clock = flow.Clock()
        self.backend = Backend(self.clock, self.real)

    def test_window_is_saved_once_before_start_with_original_deadlines_and_approval(self):
        result = flow.diag.Runner(self.backend, self.clock).run()

        self.assertTrue(result['passed'], 'startup requires a saved window receipt first')
        expected = dict(result['window'], approval_reference='OfflineWindowProof')
        self.assertEqual(self.backend.window_at_start, expected)
        self.assertEqual(json.loads((self.real.spec.evidence / 'window.json').read_text()), expected)
        self.assertEqual(self.backend.window_attempts, 1)
        self.assertEqual(self.backend.start_attempts, 1)
        self.assertEqual(expected['maximum_seconds'], 900)
        self.assertEqual(expected['cleanup_reserve_seconds'], 95)

    def test_exclusive_window_write_failure_preserves_prior_receipt_and_prevents_start(self):
        path = self.real.spec.evidence / 'window.json'
        prior = b'{"prior_owner":"unchanged"}\n'
        self.real.os.write_exclusive(path, prior)
        result = flow.diag.Runner(self.backend, self.clock).run()

        self.assertFalse(result['passed'], 'an unrecorded window must prevent startup')
        self.assertEqual(self.backend.window_attempts, 1)
        self.assertEqual(self.backend.start_attempts, 0)
        self.assertEqual(path.read_bytes(), prior)
        self.assertEqual(self.backend.calls[-1][0], 'cleanup')
        self.assertLessEqual(self.backend.calls[-1][1], 95)
        self.assertEqual(result['window']['maximum_seconds'], 900)
        self.assertNotIn(str(path), json.dumps(result))


if __name__ == '__main__':
    unittest.main()
