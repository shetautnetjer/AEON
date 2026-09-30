"""Offline integration of retained unit metadata and a real accounting ancestor."""
import json
from pathlib import Path
import shutil
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_diagnostic_system as support


class RetainedFlowTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.temporary = tempfile.TemporaryDirectory(prefix='aeon-retained-flow-')
        self.addCleanup(self.temporary.cleanup)
        self.module = support.load()
        try:
            self.fixture = support.Fixture(Path(self.temporary.name), self.module)
        except TypeError as error:
            self.fail(f'retention injection must be supported: {error}')
        self.backend = self.fixture.backend
        self.backend.preflight(timeout=10)
        self.backend.prepare(timeout=10)
        self.tempo = self.fixture.spec.unit_names['tempo']
        self.slice = self.fixture.spec.accounting_slice_name
        self.backend.run = self.command
        self.fixture.calls.clear()
        self.reset_terminal = False
        self.enforce_retained = True

    def retire(self, name):
        state = self.fixture.states[name]
        entry = self.backend.ownership[name]
        for pid in entry['pids']:
            proc = self.fixture.root/'proc'/pid
            if proc.exists(): shutil.rmtree(proc)
        for group in entry['groups']:
            directory = self.fixture.adapter.group(group)
            if directory.exists(): shutil.rmtree(directory)
        self.fixture.rows = [row for row in self.fixture.rows
                             if self.fixture.spec.unit_names[self.module.EXPECTED_PORTS[row['port']]]!=name]
        state.update(ActiveState='inactive',SubState='dead',MainPID='0',ControlGroup='',
                     Result='success',ExecMainCode='1',ExecMainStatus='0',
                     ExecMainExitTimestampMonotonic=str(int(self.fixture.clock.monotonic()*1000000)))
        if self.reset_terminal:
            state.update(ExecMainCode='0',ExecMainPID='0',InvocationID='',ExecMainStartTimestampMonotonic='0')

    def command(self, args, **kwargs):
        self.fixture.events.append(('command', *args))
        if args[:3] == ['systemctl','--user','link']:
            for path in args[4:]:
                name = Path(path).name
                self.fixture.states[name] = {'Id':name, 'LoadState':'loaded', 'ActiveState':'inactive',
                                             'MainPID':'0','ControlGroup':'','FragmentPath':str(self.fixture.spec.units_dir/name),
                                             'Slice':self.slice if name!=self.slice else 'app.slice'}
        if args[:3] == ['systemctl','--user','start']:
            if args[3:] == [self.slice]:
                self.fixture.activate_slice()
            else:
                self.assertEqual(self.fixture.bus.closed, False)
                self.assertEqual(len(self.backend.unit_references.held), 5)
                self.assertTrue(self.backend.oom_keeper.baseline is not None)
                self.fixture.activate(args[3:], capture=False)
        if args[:3] == ['systemctl','--user','stop']:
            self.fixture.clock.now += .01
            if args[3:] == [self.slice]:
                self.assertEqual(self.fixture.adapter.group_pids(self.backend.accounting_group),set())
                self.assertIsNotNone(self.backend.final_accounting)
                if self.enforce_retained: self.assertFalse(self.fixture.bus.closed)
                shutil.rmtree(self.fixture.adapter.group(self.backend.accounting_group))
                self.fixture.states[self.slice].update(ActiveState='inactive',ControlGroup='')
            else:
                if self.enforce_retained: self.assertFalse(self.fixture.bus.closed)
                for name in args[3:]: self.retire(name)
        if args[0]=='journalctl':
            invocation = self.backend.tempo_invocation
            if invocation is None:
                self.fixture.calls.append((args,kwargs))
                return SimpleNamespace(returncode=0,stdout='',stderr='')
            row = {'_PID':invocation['main_pid'],'_SYSTEMD_INVOCATION_ID':invocation['invocation_id'],'PRIORITY':'6',
                   '__REALTIME_TIMESTAMP':str(int(self.fixture.clock.time()*1000000)),
                   'MESSAGE':'level=info msg="Tempo stopped"'}
            self.fixture.calls.append((args,kwargs))
            return SimpleNamespace(returncode=0,stdout=json.dumps(row),stderr='')
        return self.fixture.run(args, **kwargs)

    def test_start_retains_five_units_and_zero_ancestor_before_services_start(self):
        # Break caught: services start before stable metadata and isolated baseline exist.
        proof = self.backend.start(700, timeout=30)

        self.assertTrue(proof['passed'])
        references = [event[1] for event in self.fixture.events if event[0] == 'RefUnit']
        self.assertEqual(set(references), {self.slice, *self.fixture.spec.unit_names.values()})
        starts = [event for event in self.fixture.events if event[:4] == ('command','systemctl','--user','start')]
        self.assertEqual(starts[0][4:], (self.slice,))
        self.assertEqual(set(starts[1][4:]), set(self.fixture.spec.unit_names.values()))
        self.assertEqual(self.backend.tempo_invocation['invocation_id'], self.fixture.states[self.tempo]['InvocationID'])
        self.assertEqual(self.backend.tempo_invocation['main_pid'], '100')
        self.assertTrue(self.fixture.adapter.group(self.backend.accounting_group).exists())

    def test_systemd_259_slice_omits_removed_cpu_accounting_property(self):
        original = self.command
        def installed_properties(args, **kwargs):
            result = original(args, **kwargs)
            if args[:4] == ['systemctl', '--user', 'start', self.slice]:
                self.fixture.states[self.slice].pop('CPUAccounting', None)
            return result
        self.backend.run = installed_properties
        self.assertTrue(self.backend.start(700, timeout=30)['passed'])

    def test_cpu_quota_remains_required_without_removed_accounting_property(self):
        self.backend.start(700, timeout=30)
        self.fixture.states[self.slice].pop('CPUAccounting', None)
        (self.fixture.adapter.group(self.backend.accounting_group) / 'cpu.max').write_text('100000 100000')
        with self.assertRaisesRegex(ValueError, 'accounting_cgroup_cpu_changed'):
            self.backend._own_slice(self.fixture.states[self.slice])

    def test_removed_tempo_leaf_uses_retained_same_invocation_and_parent_counter(self):
        self.backend.start(700,timeout=30)
        group = self.fixture.states[self.tempo]['ControlGroup']
        proof = self.backend.stop_tempo(timeout=95)

        self.assertFalse(self.fixture.adapter.group(group).exists())
        self.assertTrue(proof['passed'], proof)
        self.assertEqual(proof['oom_events'],0)
        self.assertEqual(proof['oom_verification'],'verified_isolated_hierarchical_ancestor')
        self.assertTrue(proof['invocation_verified'])
        self.assertFalse(self.fixture.bus.closed)
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'active')

    def test_final_cleanup_samples_parent_before_parent_stop_and_releases_last(self):
        self.backend.start(700,timeout=30)
        proof = self.backend.cleanup(timeout=95)

        self.assertTrue(proof['passed'],proof)
        self.assertEqual(proof['remaining_pids'],[])
        self.assertEqual(proof['remaining_groups'],[])
        self.assertEqual(proof['remaining_listeners'],[])
        self.assertEqual(proof['oom_events'],0)
        self.assertTrue(proof['accounting_slice_stopped'])
        self.assertTrue(proof['unit_references_released'])
        self.assertTrue(self.fixture.bus.closed)
        self.assertIsNone(self.backend.oom_keeper.fd)
        self.assertEqual(json.loads((self.fixture.spec.evidence/'cleanup.json').read_text()),proof)
        events = self.fixture.events
        parent_stop = events.index(('command','systemctl','--user','stop',self.slice))
        first_unref = next(index for index,event in enumerate(events) if event[0]=='UnrefUnit')
        self.assertLess(parent_stop,first_unref)

    def test_partial_reference_failure_rolls_back_parent_and_closes_without_service_start(self):
        # Break caught: acquisition failure leaks the parent and retained connection.
        self.enforce_retained = False
        original = self.fixture.bus.call_method

        def fail_reference(bus, method, name):
            if method=='RefUnit' and name==self.tempo:
                raise ValueError('synthetic_reference_failure')
            return original(bus,method,name)

        self.fixture.bus.call_method = fail_reference
        with self.assertRaises(ValueError): self.backend.start(700,timeout=30)

        starts = [event for event in self.fixture.events if event[:4]==('command','systemctl','--user','start')]
        self.assertEqual([event[4:] for event in starts],[(self.slice,)])
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'inactive')
        self.assertTrue(self.fixture.bus.closed)
        self.assertFalse(json.loads((self.fixture.spec.evidence/'cleanup.json').read_text())['passed'])
        self.assertLessEqual(self.fixture.clock.now,30)

    def test_restart_requires_new_retained_invocation_and_final_stop_is_fresh(self):
        # Break caught: restart reuses the first invocation or stale first-stop proof.
        self.backend.start(700,timeout=30)
        first_invocation = dict(self.backend.tempo_invocation)
        first = self.backend.stop_tempo(timeout=95)
        self.assertTrue(first['passed'])
        restarted = self.backend.restart_tempo(600,timeout=30)
        self.assertTrue(restarted['peers_unchanged'])
        self.assertNotEqual(first_invocation['invocation_id'],self.backend.tempo_invocation['invocation_id'])
        self.assertLess(first_invocation['start_monotonic_usec'],self.backend.tempo_invocation['start_monotonic_usec'])
        proof = self.backend.cleanup(timeout=95)

        self.assertTrue(proof['passed'],proof)
        self.assertEqual(proof['graceful_tempo']['invocation']['invocation_id'],self.backend.tempo_invocation['invocation_id'])
        self.assertNotEqual(proof['graceful_tempo']['invocation']['invocation_id'],first['invocation']['invocation_id'])

    def test_terminal_evidence_is_persisted_before_reference_release(self):
        # Break caught: close drops metadata before its terminal receipt exists.
        self.backend.start(700,timeout=30)
        original = self.fixture.bus.close
        persisted = []

        def close(bus):
            persisted.append((self.fixture.spec.evidence/'cleanup-terminal-evidence.json').is_file())
            original(bus)

        self.fixture.bus.close = close
        self.backend.cleanup(timeout=95)
        self.assertEqual(persisted,[True])

    def test_existing_cleanup_receipt_prevents_success_and_is_preserved(self):
        # Break caught: exclusive persistence fails but cleanup still reports success.
        self.backend.start(700,timeout=30)
        path = self.fixture.spec.evidence/'cleanup.json'
        self.fixture.adapter.write_exclusive(path,'{"prior":true}\n')
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertEqual(proof['reason'],'cleanup_receipt_persistence_failed')
        self.assertEqual(json.loads(path.read_text()),{'prior':True})
        self.assertTrue(self.fixture.bus.closed)
        self.assertIsNone(self.backend.oom_keeper.fd)

    def test_cleanup_receipt_missing_parent_is_a_failure_after_local_release(self):
        self.backend.start(700,timeout=30)
        original = self.fixture.bus.close

        def close(bus):
            original(bus)
            self.fixture.spec.evidence.rename(self.fixture.spec.evidence.with_name('evidence-renamed'))

        self.fixture.bus.close = close
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertEqual(proof['reason'],'cleanup_receipt_persistence_failed')
        self.assertEqual(proof['receipt_error'],'FileNotFoundError')
        self.assertTrue(self.fixture.bus.closed)
        self.assertIsNone(self.backend.oom_keeper.fd)

    def test_reset_terminal_properties_cannot_reuse_retained_exit_identity(self):
        self.backend.start(700,timeout=30)
        self.reset_terminal = True
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertFalse(proof['graceful_tempo']['invocation_verified'])
        self.assertEqual(proof['units'][self.tempo]['ExecMainCode'],'0')
        self.assertIsNone(proof['graceful_tempo']['exit_code'])
        self.assertTrue(proof['accounting_slice_stopped'])

    def test_positive_aggregate_oom_is_ambiguous_and_cannot_pass(self):
        self.backend.start(700,timeout=30)
        directory = self.fixture.adapter.group(self.backend.accounting_group)
        (directory/'memory.events').write_text('oom 1\noom_kill 1\n')
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertEqual(proof['oom_events'],2)
        self.assertEqual(proof['oom_evidence']['delta'],{'oom':1,'oom_kill':1})
        self.assertEqual(proof['oom_evidence']['coverage'],'isolated_hierarchical_ancestor')
        self.assertTrue(proof['accounting_slice_stopped'])

    def test_unknown_child_prevents_parent_stop_but_owned_peers_stop_normally(self):
        self.backend.start(700,timeout=30)
        directory = self.fixture.adapter.group(self.backend.accounting_group)/'foreign.service'
        directory.mkdir()
        (directory/'cgroup.procs').write_text('900')
        (self.fixture.root/'proc/900').mkdir()
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertFalse(proof['accounting_slice_stopped'])
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'active')
        stops = [event[4:] for event in self.fixture.events if event[:4]==('command','systemctl','--user','stop')]
        self.assertEqual(stops,[tuple(self.fixture.spec.unit_names.values())])
        self.assertEqual((directory/'cgroup.procs').read_text(),'900')
        self.assertTrue(self.fixture.bus.closed)

    def test_rejected_foreign_child_cannot_be_stopped_through_parent(self):
        self.backend.start(700,timeout=30)
        foreign = self.fixture.spec.unit_names['alloy']
        self.fixture.states[foreign]['FragmentPath'] = '/foreign/alloy.service'
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertFalse(proof['accounting_slice_stopped'])
        self.assertIn(foreign,proof['rejected_foreign_units'])
        self.assertTrue(self.fixture.adapter.pid_alive('101'))
        self.assertEqual(self.backend.forced,set())
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'active')

    def test_parent_replacement_keeps_oom_unknown_and_is_never_stopped(self):
        self.backend.start(700,timeout=30)
        parent = self.fixture.adapter.group(self.backend.accounting_group)
        parent.rename(parent.with_name(parent.name+'.old'))
        parent.mkdir()
        (parent/'cgroup.procs').write_text('')
        (parent/'memory.events').write_text('oom 0\noom_kill 0\n')
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertFalse(proof['accounting_slice_stopped'])
        self.assertTrue(parent.exists())
        self.assertEqual(self.backend.forced,set())

    def test_manager_change_does_not_block_normal_child_cleanup(self):
        self.backend.start(700,timeout=30)
        self.fixture.bus.owner = ':synthetic.manager.replaced'
        self.enforce_retained = False
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        self.assertIsNone(proof['oom_events'])
        self.assertFalse(proof['graceful_tempo']['invocation_verified'])
        self.assertEqual(proof['remaining_pids'],[])
        self.assertTrue(proof['accounting_slice_stopped'])
        self.assertFalse(proof['unit_references_released'])
        self.assertTrue(self.fixture.bus.closed)

    def test_zero_budget_closes_local_keepers_without_commands_or_new_wait(self):
        self.backend.start(700,timeout=30)
        self.fixture.calls.clear()
        before = self.fixture.clock.now
        proof = self.backend.cleanup(timeout=0)

        self.assertFalse(proof['passed'])
        self.assertEqual(self.fixture.calls,[])
        self.assertEqual(self.fixture.clock.now,before)
        self.assertFalse(proof['accounting_slice_stopped'])
        self.assertTrue(self.fixture.bus.closed)
        self.assertIsNone(self.backend.oom_keeper.fd)

    def test_one_unit_show_error_does_not_block_independent_peer_cleanup(self):
        # Break caught: one unavailable ownership lookup aborts every normal stop.
        self.backend.start(700,timeout=30)
        original = self.command
        unavailable = self.fixture.spec.unit_names['alloy']

        def show_error(args, **kwargs):
            if args[:4]==['systemctl','--user','show',unavailable]:
                raise OSError('synthetic_single_unit_show_failure')
            return original(args,**kwargs)

        self.backend.run = show_error
        proof = self.backend._cleanup_partial(self.fixture.clock.monotonic()+95)

        self.assertFalse(proof['passed'])
        stops = [event[4:] for event in self.fixture.events if event[:4]==('command','systemctl','--user','stop')]
        self.assertEqual(len(stops),1)
        self.assertNotIn(unavailable,stops[0])
        self.assertIn(self.tempo,stops[0])
        self.assertEqual(self.backend.forced,set())
        self.assertTrue(self.fixture.adapter.pid_alive('101'))
        self.assertTrue(self.fixture.bus.closed)

    def test_baseline_failure_rolls_back_without_starting_four_services(self):
        self.enforce_retained = False
        original = self.command

        def nonzero_baseline(args, **kwargs):
            result = original(args,**kwargs)
            if args[:4]==['systemctl','--user','start',self.slice]:
                (self.fixture.adapter.group(self.backend.accounting_group)/'memory.events').write_text('oom 1\noom_kill 0\n')
            return result

        self.backend.run = nonzero_baseline
        with self.assertRaises(ValueError): self.backend.start(700,timeout=30)
        starts = [event[4:] for event in self.fixture.events if event[:4]==('command','systemctl','--user','start')]
        self.assertEqual(starts,[(self.slice,)])
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'inactive')
        self.assertTrue(self.fixture.bus.closed)
        self.assertIsNone(self.backend.oom_keeper.fd)

    def test_wrong_slice_resources_still_allow_owned_empty_slice_rollback(self):
        # Break caught: a resources gate prevents safe rollback of our own empty slice.
        self.enforce_retained = False
        original = self.command

        def wrong_resources(args, **kwargs):
            result = original(args,**kwargs)
            if args[:4]==['systemctl','--user','start',self.slice]:
                (self.fixture.adapter.group(self.backend.accounting_group)/'memory.max').write_text('1')
            return result

        self.backend.run = wrong_resources
        with self.assertRaises(ValueError): self.backend.start(700,timeout=30)
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'inactive')
        starts = [event[4:] for event in self.fixture.events if event[:4]==('command','systemctl','--user','start')]
        self.assertEqual(starts,[(self.slice,)])

    def test_live_declared_child_before_baseline_is_refused_and_not_cascaded(self):
        self.enforce_retained = False
        original = self.command

        def unproved_child(args, **kwargs):
            result = original(args,**kwargs)
            if args[:4]==['systemctl','--user','start',self.slice]:
                directory = self.fixture.adapter.group(self.backend.accounting_group)/self.tempo
                directory.mkdir()
                (directory/'cgroup.procs').write_text('900')
                (self.fixture.root/'proc/900').mkdir()
            return result

        self.backend.run = unproved_child
        with self.assertRaises(ValueError): self.backend.start(700,timeout=30)
        self.assertEqual(self.fixture.states[self.slice]['ActiveState'],'active')
        self.assertTrue(self.fixture.adapter.pid_alive('900'))
        self.assertEqual(self.backend.forced,set())
        self.assertTrue(self.fixture.bus.closed)

    def test_future_start_monotonic_timestamp_cannot_identify_a_running_invocation(self):
        # Break caught: impossible future metadata is accepted as an invocation.
        original = self.command

        def future(args, **kwargs):
            result = original(args,**kwargs)
            if args[:3]==['systemctl','--user','start'] and self.tempo in args[3:]:
                self.fixture.states[self.tempo]['ExecMainStartTimestampMonotonic'] = str(int((self.fixture.clock.now+1)*1000000))
            return result

        self.backend.run = future
        with self.assertRaises(ValueError): self.backend.start(700,timeout=30)

    def test_future_terminal_monotonic_timestamp_cannot_pass_graceful_stop(self):
        self.backend.start(700,timeout=30)
        original = self.command

        def future(args, **kwargs):
            result = original(args,**kwargs)
            if args[:3]==['systemctl','--user','stop'] and self.tempo in args[3:]:
                self.fixture.states[self.tempo]['ExecMainExitTimestampMonotonic'] = str(int((self.fixture.clock.now+1)*1000000))
            return result

        self.backend.run = future
        proof = self.backend.stop_tempo(timeout=95)
        self.assertFalse(proof['passed'])
        self.assertFalse(proof['invocation_verified'])

    def test_second_tempo_metadata_read_failure_does_not_block_normal_stop(self):
        # Break caught: extra evidence lookup aborts already-proved peer cleanup.
        self.backend.start(700,timeout=30)
        original = self.command
        reads = 0

        def unavailable(args, **kwargs):
            nonlocal reads
            if args[:4]==['systemctl','--user','show',self.tempo]:
                reads += 1
                if reads==2: raise OSError('synthetic_extra_tempo_metadata_unavailable')
            return original(args,**kwargs)

        self.backend.run = unavailable
        proof = self.backend.cleanup(timeout=95)

        self.assertFalse(proof['passed'])
        stops = [event[4:] for event in self.fixture.events if event[:4]==('command','systemctl','--user','stop')]
        self.assertTrue(stops,'positively owned peers require a normal stop')
        self.assertEqual(set(stops[0]),set(self.fixture.spec.unit_names.values()))
        self.assertEqual(self.backend.forced,set())
        self.assertEqual(proof['remaining_pids'],[])
        self.assertTrue(proof['accounting_slice_stopped'])


if __name__ == '__main__':
    unittest.main()
