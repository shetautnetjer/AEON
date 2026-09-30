"""Cleanup lifecycle replay with real temporary cgroup and proc paths."""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_diagnostic_system as support


class CleanupLifecycleTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.temporary = tempfile.TemporaryDirectory(prefix='aeon-cleanup-lifecycle-')
        self.addCleanup(self.temporary.cleanup)
        self.module = support.load()
        self.fixture = support.StopTests().active(Path(self.temporary.name), self.module)
        self.backend = self.fixture.backend
        self.backend.started = True
        self.tempo = self.fixture.spec.unit_names['tempo']
        self.peer_names = [self.fixture.spec.unit_names[key] for key in ('alloy', 'prometheus', 'grafana')]
        self.original_groups = {name:self.fixture.states[name]['ControlGroup'] for name in self.fixture.spec.unit_names.values()}
        for group in self.original_groups.values():
            (self.fixture.adapter.group(group) / 'cgroup.kill').write_text('')
        self.fixture.calls.clear()
        self.backend.run = self.command

    def retire(self, name, *, remove_group=True):
        """Replay the observed systemctl terminal state, including ExecMainCode=0."""
        state = self.fixture.states[name]
        if name==self.fixture.spec.accounting_slice_name:
            shutil.rmtree(self.fixture.adapter.group(self.backend.accounting_group))
            state.update(ActiveState='inactive',ControlGroup='')
            return
        group = self.fixture.adapter.group(self.original_groups[name])
        for pid in self.backend.ownership[name]['pids']:
            proc = self.fixture.root / 'proc' / pid
            if proc.exists():
                shutil.rmtree(proc)
        self.fixture.rows = [row for row in self.fixture.rows
                             if self.fixture.spec.unit_names[self.module.EXPECTED_PORTS[row['port']]] != name]
        if group.exists():
            if remove_group:
                shutil.rmtree(group)
            else:
                (group / 'cgroup.procs').write_text('')
        state.update(ActiveState='inactive', SubState='dead', MainPID='0', ControlGroup='',
                     Result='success', ExecMainCode='0', ExecMainStatus='0')

    def command(self, args, **kwargs):
        if args[:3] == ['systemctl', '--user', 'stop']:
            self.fixture.calls.append((args, kwargs))
            for name in args[3:]:
                self.retire(name)
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        if args[0] == 'journalctl':
            self.fixture.calls.append((args, kwargs))
            row = {'_PID': '100', '_SYSTEMD_INVOCATION_ID':self.backend.tempo_invocation['invocation_id'], 'PRIORITY': '6',
                   '__REALTIME_TIMESTAMP': str(int(self.fixture.clock.time() * 1000000)),
                   'MESSAGE': 'level=info msg="Tempo stopped"'}
            return SimpleNamespace(returncode=0, stdout=json.dumps(row), stderr='')
        return self.fixture.run(args, **kwargs)

    def stops(self):
        return [(args, kwargs) for args, kwargs in self.fixture.calls
                if args[:3] == ['systemctl', '--user', 'stop'] and args[3:]!=[self.fixture.spec.accounting_slice_name]]

    def receipt(self):
        path = self.fixture.spec.evidence / 'cleanup.json'
        self.assertTrue(path.is_file(), 'cleanup failure must have a durable receipt')
        return json.loads(path.read_text())

    def test_removed_inactive_tempo_counter_does_not_force_live_peers(self):
        # Break caught: evidence loss aborts the normal stop and forces all peers.
        self.retire(self.tempo)
        (self.fixture.adapter.group(self.backend.accounting_group)/'memory.events').unlink()
        proof = self.backend.cleanup(timeout=95)

        self.assertEqual(len(self.stops()), 1, 'owned peers need one concurrent normal stop')
        args, kwargs = self.stops()[0]
        self.assertTrue(set(self.peer_names) <= set(args[3:]))
        self.assertGreater(kwargs['timeout'], 0)
        self.assertLessEqual(kwargs['timeout'], 90)
        self.assertEqual(self.backend.forced, set())
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertEqual(proof['oom_verification'], 'unverified_final_counter_unavailable')
        self.assertEqual(proof['remaining_pids'], [])
        self.assertEqual(proof['remaining_groups'], [])
        self.assertEqual(proof['remaining_listeners'], [])
        self.assertEqual(self.receipt(), proof)

    def test_zero_budget_persists_unverified_failure_without_os_commands(self):
        # Break caught: the exhausted-budget branch returns an unsaved failure.
        self.retire(self.tempo)
        before = self.fixture.clock.now
        proof = self.backend.cleanup(timeout=0)

        self.assertEqual(self.fixture.calls, [])
        self.assertEqual(self.fixture.clock.now, before)
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertEqual(proof['reason'], 'cleanup_deadline_expired_verification_unavailable')
        self.assertEqual(self.receipt(), proof)

    def test_verification_error_does_not_force_a_rejected_foreign_unit(self):
        # Break caught: proof errors force historical owners never selected for stop.
        foreign = self.peer_names[0]
        self.fixture.states[foreign]['FragmentPath'] = '/foreign/alloy.service'
        self.retire(self.tempo)

        def unavailable(deadline):
            raise ValueError('synthetic_preservation_verification_unavailable')

        self.backend._preserved = unavailable
        proof = self.backend.cleanup(timeout=95)

        self.assertEqual(len(self.stops()), 1)
        self.assertNotIn(foreign, self.stops()[0][0][3:])
        directory = self.fixture.adapter.group(self.original_groups[foreign])
        self.assertEqual((directory / 'cgroup.kill').read_text(), '', 'rejected unit must remain untouched')
        self.assertTrue(self.fixture.adapter.pid_alive('101'))
        self.assertEqual(self.backend.forced, set())
        self.assertFalse(proof['passed'])
        self.assertEqual(proof['reason'], 'ValueError')
        self.assertEqual(self.receipt(), proof)

    def test_missing_group_before_inactive_transition_still_receives_normal_stop(self):
        # Characterize the race: show is still active after the kernel path vanishes.
        shutil.rmtree(self.fixture.adapter.group(self.original_groups[self.tempo]))
        proof = self.backend.cleanup(timeout=95)

        self.assertEqual(len(self.stops()), 1)
        self.assertEqual(set(self.stops()[0][0][3:]), {self.tempo, *self.peer_names})
        self.assertEqual(self.backend.forced, set())
        self.assertEqual(proof['units'][self.tempo]['ExecMainCode'], '0')
        self.assertFalse(proof['graceful_tempo']['passed'])
        self.assertEqual(proof['graceful_tempo']['oom_events'],0)
        self.assertEqual(proof['oom_events'],0)
        self.assertFalse(proof['passed'])
        self.assertEqual(self.receipt(), proof)

    def test_counter_removal_after_normal_stop_keeps_terminal_result_unverified(self):
        # A successful stop command and terminal ExecMainCode=0 are insufficient.
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(self.fixture.adapter.group(self.original_groups[self.tempo]).exists())
        self.assertEqual(self.backend.forced, set())
        self.assertFalse(proof['passed'])
        self.assertTrue(proof['graceful_tempo']['completion_milestone'])
        self.assertIsNone(proof['graceful_tempo']['exit_code'])
        self.assertEqual(proof['graceful_tempo']['oom_events'],0)
        self.assertEqual(proof['oom_events'],0)
        self.assertEqual(self.receipt(), proof)

    def test_missing_memory_file_never_reuses_a_cached_zero_counter(self):
        # Keep the pinned directory, but delete the actual kernel-file seam.
        (self.fixture.adapter.group(self.original_groups[self.tempo]) / 'memory.events').unlink()
        (self.fixture.adapter.group(self.backend.accounting_group)/'memory.events').unlink()
        original = self.command

        def retain_empty_groups(args, **kwargs):
            if args[:3] == ['systemctl', '--user', 'stop']:
                if args[3:]==[self.fixture.spec.accounting_slice_name]: return original(args,**kwargs)
                self.fixture.calls.append((args, kwargs))
                for name in args[3:]:
                    self.retire(name, remove_group=False)
                return SimpleNamespace(returncode=0, stdout='', stderr='')
            return original(args, **kwargs)

        self.backend.run = retain_empty_groups
        proof = self.backend.cleanup(timeout=95)

        self.assertEqual(self.backend.forced, set())
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertEqual(proof['oom_verification'], 'unverified_final_counter_unavailable')
        self.assertEqual(self.receipt(), proof)

    def test_bounded_stop_timeout_forces_only_the_owned_group_that_remains_live(self):
        self.retire(self.tempo)
        (self.fixture.adapter.group(self.backend.accounting_group)/'memory.events').unlink()
        failed, foreign, completed = self.peer_names
        self.fixture.states[foreign]['FragmentPath'] = '/foreign/prometheus.service'
        original = self.command

        def timeout(args, **kwargs):
            if args[:3] == ['systemctl', '--user', 'stop']:
                self.fixture.calls.append((args, kwargs))
                self.retire(completed)
                self.fixture.clock.now += kwargs['timeout']
                raise subprocess.TimeoutExpired(args, kwargs['timeout'])
            return original(args, **kwargs)

        kernel_kill = self.fixture.adapter.kill_group

        def replay_kernel_kill(group, identity):
            # RealOS validates and writes the real temporary cgroup.kill file.
            kernel_kill(group, identity)
            name = next(name for name, owned_group in self.original_groups.items() if owned_group == group)
            self.retire(name, remove_group=False)
            self.fixture.states[name].update(Result='timeout', ExecMainCode='2', ExecMainStatus='9')

        self.backend.run = timeout
        self.fixture.adapter.kill_group = replay_kernel_kill
        proof = self.backend.cleanup(timeout=95)

        self.assertEqual(len(self.stops()), 1)
        self.assertNotIn(foreign, self.stops()[0][0][3:])
        self.assertEqual(self.backend.forced, {failed})
        self.assertEqual((self.fixture.adapter.group(self.original_groups[failed]) / 'cgroup.kill').read_text(), '1')
        self.assertEqual((self.fixture.adapter.group(self.original_groups[foreign]) / 'cgroup.kill').read_text(), '')
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertLessEqual(self.fixture.clock.now, 95)
        self.assertGreater(self.stops()[0][1]['timeout'], 0)
        self.assertLessEqual(self.stops()[0][1]['timeout'], 90)
        self.assertEqual(self.receipt(), proof)

    def test_positive_budget_rejects_reused_cgroup_before_stop_or_force(self):
        self.retire(self.tempo)
        reused = self.peer_names[0]
        directory = self.fixture.adapter.group(self.original_groups[reused])
        directory.rename(directory.with_name(directory.name + '.old'))
        directory.mkdir()
        (directory / 'cgroup.procs').write_text('101')
        (directory / 'cgroup.kill').write_text('')
        (directory / 'memory.events').write_text('oom 0\noom_kill 0\n')
        proof = self.backend.cleanup(timeout=95)

        self.assertNotIn(reused, self.stops()[0][0][3:])
        self.assertIn(reused, proof['rejected_foreign_units'])
        self.assertEqual((directory / 'cgroup.kill').read_text(), '')
        self.assertTrue(self.fixture.adapter.pid_alive('101'))
        self.assertEqual(self.backend.forced, set())
        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertEqual(self.receipt(), proof)


if __name__ == '__main__':
    unittest.main()
