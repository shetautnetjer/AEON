"""Offline result-recording regressions using synthetic adapter and clock."""
import contextlib
import io
import json
import socket
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_diagnostic_flow as support
import diagnostic_config


diag = support.diag


class FakeBackend(support.Backend):
    def __init__(self, clock, namespace, *, preflight_fails=True, record_fails=True):
        super().__init__(clock)
        self.namespace = namespace
        self.preflight_fails, self.record_fails = preflight_fails, record_fails
        self.record_attempts = 0

    def preflight(self, timeout):
        self.call('preflight', timeout)
        if self.preflight_fails:
            raise ValueError('bad artifact hash: /private/raw-source-path')

    def prepare(self, timeout):
        (self.namespace / 'evidence').mkdir(parents=True)
        return super().prepare(timeout)

    def record(self, result):
        self.record_attempts += 1
        parent = self.namespace / ('not-created' if self.record_fails else 'evidence')
        with (parent / 'result.json').open('x') as stream:
            json.dump(result, stream)


class DiagnosticRecordTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-record-failure-')
        self.addCleanup(self.tmp.cleanup)
        self.namespace = Path(self.tmp.name) / 'unclaimed'
        self.clock = support.Clock()

    def test_preflight_record_failure_returns_original_failure_without_namespace(self):
        backend = FakeBackend(self.clock, self.namespace)
        try:
            result = diag.Runner(backend, self.clock).run()
        except FileNotFoundError:
            result = None

        self.assertIsInstance(result, dict, 'recording must not replace the in-memory failure result')
        self.assertFalse(result['passed'])
        self.assertEqual(result['failure'], {'stage': 'preflight', 'error_class': 'ValueError'})
        self.assertEqual(result['checks']['cleanup'], 'passed')
        self.assertEqual(result['checks']['prepare'], 'not_run')
        self.assertEqual(result['record_failure'], {'error_class': 'Exception'})
        self.assertEqual(backend.calls, [('preflight', 30), ('cleanup', 30)])
        self.assertEqual(backend.record_attempts, 1)
        self.assertFalse(self.namespace.exists())
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])
        self.assertNotIn('/private/raw-source-path', json.dumps(result))
        self.assertNotIn(str(self.namespace), json.dumps(result))

    def test_cli_prints_failed_json_when_preflight_and_record_fail(self):
        backend = FakeBackend(self.clock, self.namespace)
        spec = SimpleNamespace(run_id='OfflineRecord', state=self.namespace)
        output = io.StringIO()
        try:
            with patch.object(diagnostic_config, 'DiagnosticSpec', return_value=spec), contextlib.redirect_stdout(output):
                code = diag.main(['--run-id', 'OfflineRecord', '--run-approved',
                                  '--approval-reference', 'syntheticOnly'],
                                 backend_factory=lambda _: backend, clock=self.clock)
        except FileNotFoundError:
            code = None

        self.assertEqual(code, 1, 'CLI must return a failed JSON result after recording fails')
        result = json.loads(output.getvalue())
        self.assertFalse(result['passed'])
        self.assertEqual(result['failure']['stage'], 'preflight')
        self.assertEqual(result['record_failure'], {'error_class': 'Exception'})
        self.assertFalse(self.namespace.exists())
        self.assertNotIn('/private/raw-source-path', output.getvalue())
        self.assertNotIn(str(self.namespace), output.getvalue())

    def test_completed_flow_cannot_pass_when_final_recording_fails(self):
        backend = FakeBackend(self.clock, self.namespace, preflight_fails=False)
        result = diag.Runner(backend, self.clock).run()

        self.assertFalse(result['passed'], 'a result without recorded evidence must not claim success')
        self.assertTrue(all(value == 'passed' for value in result['checks'].values()))
        self.assertEqual(result['record_failure'], {'error_class': 'Exception'})
        self.assertNotIn('failure', result)
        self.assertEqual(backend.record_attempts, 1)
        self.assertFalse((self.namespace / 'not-created').exists())
        self.assertEqual(list((self.namespace / 'evidence').iterdir()), [])
        self.assertNotIn(str(self.namespace), json.dumps(result))


if __name__ == '__main__':
    unittest.main()
