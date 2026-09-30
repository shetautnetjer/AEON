"""Offline verifier environment regression with injected command failures."""
import socket
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_diagnostic_system as support


class DiagnosticPrepareEnvironmentTests(unittest.TestCase):
    def test_user_unit_verifier_gets_local_runtime_directory_in_a_clean_fresh_home(self):
        with tempfile.TemporaryDirectory(prefix='aeon-prepare-env-') as temporary:
            module = support.load()
            fixture = support.Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10)
            baseline = {'PATH': '/usr/bin:/bin', 'HOME': str(fixture.spec.home),
                        'LANG': 'C.UTF-8', 'TZ': 'UTC'}
            runtime = '/run/user/' + str(fixture.adapter.uid)
            environments = []
            original_run = fixture.run

            def verifier(args, **kwargs):
                environments.append((args[0], dict(kwargs['env'])))
                if args[0] == 'systemd-analyze' and kwargs['env'].get('XDG_RUNTIME_DIR') != runtime:
                    return SimpleNamespace(returncode=1, stdout='',
                                           stderr='Failed to lookup RuntimeDirectory path: No such device or address')
                return original_run(args, **kwargs)

            fixture.backend.run = verifier
            ambient = {'HOME': '/synthetic/ambient-home', 'XDG_RUNTIME_DIR': '/synthetic/foreign-runtime',
                       'DBUS_SESSION_BUS_ADDRESS': 'synthetic-not-inherited', 'UNRELATED_ENV': 'synthetic-marker'}
            failure = None
            try:
                with patch.dict(module.os.environ, ambient), patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden')):
                    proof = fixture.backend.prepare(timeout=10)
            except RuntimeError as error:
                failure = str(error)
                proof = None

            self.assertIsInstance(proof, dict, 'prepare must pass the runtime directory to the user verifier: ' + repr(failure))
            self.assertTrue(proof['passed'])
            self.assertTrue(fixture.backend.prepared)
            self.assertEqual(len(environments), 6)
            for command, env in environments:
                self.assertEqual(env, dict(baseline, XDG_RUNTIME_DIR=runtime) if command == 'systemd-analyze' else baseline)
            self.assertFalse(fixture.backend.started)
            self.assertFalse(any(args[:3] == ['systemctl', '--user', 'start'] for args, _ in fixture.calls))


if __name__ == '__main__':
    unittest.main()
