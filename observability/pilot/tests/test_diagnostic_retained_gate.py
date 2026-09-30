"""The orchestration gate rejects stale status despite superficially zero fields."""
import unittest
import test_diagnostic_flow as support


class RetainedGateTests(unittest.TestCase):
    def test_wrong_invocation_never_reaches_restart_call(self):
        clock = support.Clock()
        backend = support.Backend(clock)
        original = backend.stop_tempo

        def wrong_invocation(timeout):
            value = original(timeout)
            value.update(passed=False, invocation_verified=False)
            return value

        backend.stop_tempo = wrong_invocation
        result = support.diag.Runner(backend, clock).run()
        self.assertEqual(result['checks']['first_graceful_stop'], 'failed')
        self.assertEqual(result['checks']['restart'], 'not_run')
        self.assertFalse(any(name == 'restart' for name, _ in backend.calls))


if __name__ == '__main__':
    unittest.main()
