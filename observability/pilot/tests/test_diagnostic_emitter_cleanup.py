"""Synthetic launcher lifetime regressions; no processes or services are started."""
import hashlib
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_diagnostic_system as support


class FakePopen:
    def __init__(self, clock, *, stubborn=False):
        self.clock, self.stubborn = clock, stubborn
        self.pid = 900
        self.returncode = None
        self.terminations = self.kills = 0
        self.waits = []
        self.reaped = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminations += 1

    def kill(self):
        self.kills += 1
        if not self.stubborn:
            self.returncode = -9

    def wait(self, timeout=None):
        if timeout is None or timeout < 0:
            raise AssertionError('launcher wait must have a finite nonnegative timeout')
        self.waits.append(timeout)
        if self.returncode is None:
            self.clock.sleep(timeout)
            raise subprocess.TimeoutExpired('synthetic-launcher', timeout)
        self.reaped = True
        return self.returncode


class DiagnosticEmitterCleanupTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-emitter-launcher-')
        self.addCleanup(self.tmp.cleanup)
        self.module = support.load()
        self.fixture = support.Fixture(Path(self.tmp.name), self.module)
        self.fixture.backend.preflight(timeout=10)
        self.fixture.backend.prepare(timeout=10)
        signal_guard = patch.object(self.module.os, 'kill', side_effect=AssertionError('arbitrary PID signal forbidden'))
        signal_guard.start()
        self.addCleanup(signal_guard.stop)

    def test_hung_launcher_is_stopped_and_reaped_when_no_scope_appears(self):
        fixture = self.fixture
        launcher = FakePopen(fixture.clock)
        fixture.backend.spawn = lambda *_args, **_kwargs: launcher

        with self.assertRaises(TimeoutError):
            fixture.backend.emit(timeout=65)

        self.assertIsNotNone(launcher.poll(), 'failed emit must stop its own launcher even without a scope')
        self.assertTrue(launcher.reaped)
        self.assertTrue(launcher.kills or launcher.terminations)
        self.assertTrue(all(timeout == 0 for timeout in launcher.waits))
        self.assertLessEqual(fixture.clock.now, 65)
        self.assertNotIn(fixture.spec.emitter_name, fixture.backend.ownership)

    def test_cleanup_stops_and_reaps_only_its_own_launcher_without_scope(self):
        fixture = self.fixture
        launcher, foreign = FakePopen(fixture.clock), FakePopen(fixture.clock)
        fixture.backend.emitter_process = launcher
        fixture.backend.emitter_attempted = True

        proof = fixture.backend.cleanup(timeout=95)

        self.assertIsNotNone(launcher.poll(), 'cleanup must not leave its owned Popen launcher alive')
        self.assertTrue(launcher.reaped)
        self.assertTrue(proof['owned_emitter_stopped'])
        self.assertIsNone(foreign.poll())
        self.assertEqual((foreign.terminations, foreign.kills, foreign.waits), (0, 0, []))
        self.assertTrue(all(0 <= timeout <= 95 for timeout in launcher.waits))
        self.assertLessEqual(fixture.clock.now, 95)

    def test_cleanup_cannot_claim_emitter_stopped_while_launcher_is_alive(self):
        fixture = self.fixture
        launcher = FakePopen(fixture.clock, stubborn=True)
        fixture.backend.emitter_process = launcher
        fixture.backend.emitter_attempted = True

        proof = fixture.backend.cleanup(timeout=95)

        self.assertFalse(proof['owned_emitter_stopped'], 'scope absence does not prove the launcher stopped')
        self.assertFalse(proof['passed'])
        self.assertIsNone(launcher.poll())
        self.assertLessEqual(fixture.clock.now, 95)

    def test_zero_budget_cleanup_stops_own_launcher_without_new_wait_window(self):
        fixture = self.fixture
        launcher = FakePopen(fixture.clock)
        fixture.backend.emitter_process = launcher
        fixture.backend.emitter_attempted = True
        fixture.calls.clear()

        proof = fixture.backend.cleanup(timeout=0)

        self.assertIsNotNone(launcher.poll(), 'zero budget still requires a nonblocking stop of its own launcher')
        self.assertTrue(launcher.reaped)
        self.assertFalse(proof['passed'])
        self.assertTrue(all(timeout == 0 for timeout in launcher.waits))
        self.assertEqual(fixture.clock.now, 0)
        self.assertEqual(fixture.calls, [])

    def test_spawn_is_refused_if_scope_check_consumes_full_emitter_allowance(self):
        fixture = self.fixture
        original_show = fixture.backend._show
        spawned = []
        delayed = False

        def slow_show(name, deadline):
            nonlocal delayed
            state = original_show(name, deadline)
            if name == fixture.spec.emitter_name and not delayed:
                fixture.clock.sleep(6)
                delayed = True
            return state

        def spawn(*_args, **_kwargs):
            launcher = FakePopen(fixture.clock)
            spawned.append(launcher)
            return launcher

        fixture.backend._show = slow_show
        fixture.backend.spawn = spawn
        with self.assertRaises(TimeoutError):
            fixture.backend.emit(timeout=70)

        self.assertEqual(spawned, [], 'spawn requires the complete 65-second allowance at that instant')
        self.assertEqual(fixture.clock.now, 6)

    def test_emit_rejects_empty_import_origin_receipt(self):
        fixture = self.fixture
        support.EmitterTests().fake_spawn(fixture)
        original_json = fixture.backend._json

        def receipt(path):
            value = original_json(path)
            if Path(path) == fixture.spec.evidence / 'emitted.json':
                value['imported_origins'] = {}
            return value

        fixture.backend._json = receipt
        with self.assertRaisesRegex(ValueError, '^emitter_import_origin_mismatch$'):
            fixture.backend.emit(timeout=70)
        self.assertFalse(fixture.backend.emitted)

    def test_emit_rejects_foreign_existing_file_with_its_correct_self_hash(self):
        fixture = self.fixture
        support.EmitterTests().fake_spawn(fixture)
        foreign = fixture.root / 'foreign-module.py'
        foreign.write_bytes(b'not an approved import')
        original_json = fixture.backend._json

        def receipt(path):
            value = original_json(path)
            if Path(path) == fixture.spec.evidence / 'emitted.json':
                value['imported_origins']['openai'] = {'path': str(foreign), 'sha256': hashlib.sha256(foreign.read_bytes()).hexdigest()}
            return value

        fixture.backend._json = receipt
        with self.assertRaisesRegex(ValueError, '^emitter_import_origin_mismatch$'):
            fixture.backend.emit(timeout=70)
        self.assertFalse(fixture.backend.emitted)

    def test_emit_rejects_changed_approved_file_even_with_a_matching_receipt_hash(self):
        fixture = self.fixture
        support.EmitterTests().fake_spawn(fixture)
        path = Path(fixture.backend.approved_emitter_origins['openai']['path'])
        path.write_bytes(b'changed after preflight')
        original_json = fixture.backend._json

        def receipt(selected):
            value = original_json(selected)
            if Path(selected) == fixture.spec.evidence / 'emitted.json':
                value['imported_origins']['openai']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            return value

        fixture.backend._json = receipt
        with self.assertRaisesRegex(ValueError, '^emitter_import_origin_mismatch$'):
            fixture.backend.emit(timeout=70)
        self.assertFalse(fixture.backend.emitted)

    def test_preflight_retains_exact_seven_origin_path_hash_projections(self):
        fixture = self.fixture
        support.EmitterTests().fake_spawn(fixture)
        approved = fixture.backend.approved_emitter_origins
        del fixture.backend.approved_emitter_origins
        imports = {name: dict(pin, owner='retained owner') for name, pin in approved.items()}
        imports['instrumentor_harness'] = dict(imports['openai'])
        tool = str(fixture.root / 'promtool')
        receipts = {
            'artifact-pins.json': {'artifacts': [{'component': 'tempo', 'filename': 'tempo.tar.gz'}, {'component': 'grafana-oss', 'filename': 'grafana.tar.gz'}],
                                   'promtool': {'installed_path': tool, 'resolved_path': tool, 'installed_binary_sha256': '0' * 64}},
            'acquisition.json': {'verified_artifacts': []},
            'source-custody.json': {'source_pins': []},
            'source-baseline.json': {'sources': []},
            'native-existing-dependencies.json': {'distributions': []},
            'instrumentor-imports-final.json': {'passed': True, 'imported_origins': imports},
        }

        def read_prefix(path):
            if Path(path).name == 'protected-before.json':
                raise RuntimeError('synthetic end of preflight prefix')
            return receipts[Path(path).name]

        fixture.backend._json = read_prefix
        fixture.backend._verify_file_pins = lambda pins, *_args, **_kwargs: len(pins)
        fixture.backend._archive_binary = lambda *_args: None
        with self.assertRaisesRegex(RuntimeError, '^synthetic end of preflight prefix$'):
            self.module.SystemBackend._verify_pins(fixture.backend, 95)

        self.assertEqual(getattr(fixture.backend, 'approved_emitter_origins', None), approved)


if __name__ == '__main__':
    unittest.main()
