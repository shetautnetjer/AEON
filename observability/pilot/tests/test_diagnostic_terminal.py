"""Terminal proofs use synthetic cgroup/proc files and deny live sockets."""
import hashlib
from pathlib import Path
import shutil
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_diagnostic_system as support


class TerminalProofTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-terminal-proof-')
        self.addCleanup(self.tmp.cleanup)
        self.module = support.load()
        self.fixture = support.StopTests().active(Path(self.tmp.name), self.module)
        self.tempo = self.fixture.spec.unit_names['tempo']
        self.group = self.fixture.states[self.tempo]['ControlGroup']

    def remove_stopped_groups(self):
        self.fixture.stopped_runner()
        original = self.fixture.backend.run

        def run(args, **kwargs):
            result = original(args, **kwargs)
            if args[:3] == ['systemctl', '--user', 'stop']:
                for name in args[3:]:
                    shutil.rmtree(self.fixture.adapter.group(self.fixture.states[name]['ControlGroup']))
            return result

        self.fixture.backend.run = run

    def test_pre_stop_zero_is_not_final_oom_proof_after_cgroup_removal(self):
        self.remove_stopped_groups()
        proof = self.fixture.backend.stop_tempo(timeout=95)
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertEqual(proof['oom_verification'], 'unverified_final_counter_unavailable')

    def test_cleanup_marks_missing_terminal_counter_unverified(self):
        self.remove_stopped_groups()
        proof = self.fixture.backend.cleanup(timeout=95)
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])

    def test_zero_budget_kills_new_same_uid_descendants_in_pinned_group(self):
        directory = self.fixture.adapter.group(self.group)
        (directory / 'cgroup.kill').write_text('')
        child = directory / 'new-child'
        child.mkdir()
        (child / 'cgroup.procs').write_text('900')
        (self.fixture.root / 'proc/900').mkdir()
        self.fixture.calls.clear()
        proof = self.fixture.backend.cleanup(timeout=0)
        self.assertEqual((directory / 'cgroup.kill').read_text(), '1')
        self.assertFalse(proof['passed'])
        self.assertEqual(self.fixture.calls, [])

    def test_zero_budget_refuses_replacement_cgroup_with_same_saved_pid(self):
        directory = self.fixture.adapter.group(self.group)
        directory.rename(directory.with_name(directory.name + '.old'))
        directory.mkdir()
        (directory / 'cgroup.procs').write_text('100')
        (directory / 'cgroup.kill').write_text('')
        self.fixture.backend.cleanup(timeout=0)
        self.assertEqual((directory / 'cgroup.kill').read_text(), '')

    def test_zero_budget_refuses_foreign_uid_new_descendant(self):
        directory = self.fixture.adapter.group(self.group)
        (directory / 'cgroup.procs').write_text('100 900')
        (directory / 'cgroup.kill').write_text('')
        original = self.fixture.adapter.pid_uid
        self.fixture.adapter.pid_uid = lambda pid: self.fixture.adapter.uid + 1 if pid == '900' else original(pid)
        self.fixture.backend.cleanup(timeout=0)
        self.assertEqual((directory / 'cgroup.kill').read_text(), '')

    def test_kernel_kill_refuses_group_replaced_after_ownership_check(self):
        directory = self.fixture.adapter.group(self.group)
        original = self.fixture.adapter.kill_group

        def replace_before_open(group, expected_identity):
            if group == self.group:
                directory.rename(directory.with_name(directory.name + '.old'))
                directory.mkdir()
                (directory / 'cgroup.procs').write_text('100')
                (directory / 'cgroup.kill').write_text('')
            return original(group, expected_identity)

        self.fixture.adapter.kill_group = replace_before_open
        self.fixture.backend.cleanup(timeout=0)
        self.assertEqual((directory / 'cgroup.kill').read_text(), '')

    def emitter_state(self):
        fixture = self.fixture
        name = fixture.spec.emitter_name
        group = f'/user.slice/user-{fixture.adapter.uid}.slice/user@{fixture.adapter.uid}.service/app.slice/{name}'
        directory = fixture.adapter.group(group)
        directory.mkdir()
        (directory / 'cgroup.procs').write_text('900')
        proc = fixture.root / 'proc/900'
        proc.mkdir()
        (proc / 'cmdline').write_bytes(b'\0'.join(str(path).encode() for path in
                                    (fixture.spec.source_root / 'emit_synthetic.py', fixture.spec.evidence / 'emitted.json')))
        fixture.backend.emitter_attempted = True
        fragment = fixture.adapter.runtime_root.parent / 'transient' / name
        fragment.parent.mkdir()
        fragment.write_text('[Scope]\n')
        return {'Id': name, 'LoadState': 'loaded', 'ActiveState': 'active', 'ControlGroup': group,
                'Transient': 'yes', 'FragmentPath': str(fragment)}

    def test_emitter_accepts_exact_owned_runtime_transient_fragment(self):
        state = self.emitter_state()
        try:
            owned = self.fixture.backend._own(self.fixture.spec.emitter_name, state)
        except ValueError as error:
            self.fail(f'exact owned transient fragment rejected: {error}')
        self.assertEqual(owned, {'900'})

    def test_emitter_rejects_foreign_or_symlink_transient_fragment(self):
        state = self.emitter_state()
        fragment = Path(state['FragmentPath'])
        state['FragmentPath'] = str(fragment.with_name('foreign.scope'))
        with self.assertRaises(ValueError):
            self.fixture.backend._own(self.fixture.spec.emitter_name, state)
        state['FragmentPath'] = str(fragment)
        fragment.unlink()
        fragment.symlink_to(self.fixture.spec.units_dir / self.tempo)
        with self.assertRaises(ValueError):
            self.fixture.backend._own(self.fixture.spec.emitter_name, state)

    def test_inventory_passes_shared_absolute_deadline_to_scanner(self):
        calls = []
        self.fixture.backend.reader = SimpleNamespace(disk_usage=lambda *args, **kwargs: calls.append((args, kwargs)) or {'bytes': 0})
        self.fixture.backend._inventory = self.module.SystemBackend._inventory.__get__(self.fixture.backend)
        self.fixture.backend._inventory(17)
        self.assertIn('absolute_deadline', calls[0][1])
        self.assertEqual(calls[0][1]['absolute_deadline'], 17)

    def test_cleanup_does_not_reuse_first_stop_after_restarted_tempo_exited(self):
        self.fixture.stopped_runner()
        self.fixture.backend.started = True
        first = self.fixture.backend.stop_tempo(timeout=95)
        self.assertTrue(first['passed'])
        self.fixture.backend.restart_attempted = True
        proof = self.fixture.backend.cleanup(timeout=95)
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['graceful_tempo'])
        self.assertEqual(proof['reason'], 'tempo_not_active_for_fresh_final_stop')

    def test_cgroup_replacement_cannot_supply_a_fresh_zero_oom_counter(self):
        directory = self.fixture.adapter.group(self.group)
        directory.rename(directory.with_name(directory.name + '.old'))
        directory.mkdir()
        (directory / 'memory.events').write_text('oom 0\noom_kill 0\n')
        self.assertIsNone(self.fixture.backend._final_oom({self.group}))

    def test_explicit_restart_pins_new_owned_cgroup_lifetime(self):
        self.fixture.stopped_runner()
        self.fixture.backend.started = True
        self.fixture.backend.stop_tempo(timeout=95)
        original = self.fixture.backend.run
        peer_states = {name: dict(state) for name, state in self.fixture.states.items() if name != self.tempo}
        old_identity = self.fixture.adapter.group_identity(self.group)

        def run(args, **kwargs):
            if args[:3] == ['systemctl', '--user', 'start']:
                directory = self.fixture.adapter.group(self.group)
                directory.rename(directory.with_name(directory.name + '.old'))
                self.fixture.activate()
                self.fixture.states[self.tempo]['RuntimeMaxUSec'] = '600000000'
                self.fixture.states.update(peer_states)
            return original(args, **kwargs)

        self.fixture.backend.run = run
        try:
            proof = self.fixture.backend.restart_tempo(600, timeout=30)
        except ValueError as error:
            self.fail(f'explicit restart rejected its new owned cgroup: {error}')
        self.assertTrue(proof['peers_unchanged'])
        self.assertNotEqual(self.fixture.adapter.group_identity(self.group), old_identity)
        directory = self.fixture.adapter.group(self.group)
        (directory / 'cgroup.kill').write_text('')
        self.fixture.backend.cleanup(timeout=0)
        self.assertEqual((directory / 'cgroup.kill').read_text(), '1')

    def test_final_preservation_rechecks_verified_artifact_and_source_pins(self):
        root = self.fixture.root
        receipt = self.fixture.backend.old_state / 'evidence/old.json'
        receipt.write_text('{}')
        self.fixture.backend.preservation = {str(receipt): hashlib.sha256(receipt.read_bytes()).hexdigest()}
        self.fixture.backend.original_evidence_paths = {str(receipt)}
        self.fixture.backend._preserved = self.module.SystemBackend._preserved.__get__(self.fixture.backend)
        for relative in ('artifacts/observability/approved.tar.gz', 'observability/pilot/approved_source.py'):
            with self.subTest(relative=relative):
                path = root / relative
                path.write_text('approved')
                pin = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                self.fixture.backend._verify_file_pins([pin], 100)
                self.assertTrue(self.fixture.backend._preserved(100))
                path.write_text('modified')
                with self.assertRaisesRegex(ValueError, 'approved_file_hash_changed'):
                    self.fixture.backend._preserved(100)
                path.write_text('approved')


if __name__ == '__main__':
    unittest.main()
