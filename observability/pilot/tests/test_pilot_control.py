import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from contextlib import ExitStack


def load_control():
    spec = importlib.util.spec_from_file_location('aeon_pilot_control', str(Path(__file__).resolve().parents[1]/'control.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PilotControlTests(unittest.TestCase):
    def setUp(self):
        self.control = load_control()
        self.pids = {'alloy':{'11','111'}, 'tempo':{'22'}, 'prometheus':{'33'}, 'grafana':{'44'}}
        mapping = {14317:'11', 14318:'11', 12346:'11', 13200:'22', 19095:'22',
            24317:'22', 24318:'22', 19090:'33', 13000:'44'}
        self.rows = [{'protocol':'tcp', 'port':port, 'address':f'127.0.0.1:{port}',
            'owners':[pid]} for port, pid in mapping.items()]

    def test_runtime_hashes_require_exact_approved_eleven_files_and_fresh_hashes(self):
        approved = [
            'observability/pilot/config/README.md',
            'observability/pilot/config/config.alloy',
            'observability/pilot/config/grafana.ini',
            'observability/pilot/config/hermes_otel.synthetic.yaml',
            'observability/pilot/config/prometheus.yaml',
            'observability/pilot/config/provisioning/datasources/local.yaml',
            'observability/pilot/config/tempo.yaml',
            'observability/pilot/units/aeon-pilot-alloy.service',
            'observability/pilot/units/aeon-pilot-grafana.service',
            'observability/pilot/units/aeon-pilot-prometheus.service',
            'observability/pilot/units/aeon-pilot-tempo.service',
        ]
        with tempfile.TemporaryDirectory(prefix='aeon-control-pins-') as directory:
            self.control.A = Path(directory)
            self.control.E = Path(directory)/'evidence'
            self.control.E.mkdir()
            pins = []
            for relative in approved:
                path = self.control.A/relative
                path.parent.mkdir(parents=True, exist_ok=True)
                content = ('synthetic configuration '+relative).encode()
                path.write_bytes(content)
                pins.append({'path':relative, 'sha256':hashlib.sha256(content).hexdigest()})
            receipt = self.control.E/'binary-prereqs.json'
            def write_receipt(entries):
                receipt.write_text(json.dumps({'config_pins':entries}))
            write_receipt(pins)
            with patch.object(self.control, 'run', side_effect=AssertionError('service call forbidden')) as run:
                actual = self.control.runtime_hashes()
                self.assertEqual(set(actual), set(approved)|{'binary-prereqs.json'})
                self.assertEqual(actual['binary-prereqs.json'], hashlib.sha256(receipt.read_bytes()).hexdigest())
                for pin in pins:
                    self.assertEqual(actual[pin['path']], pin['sha256'])
                unexpected = {'path':'observability/pilot/config/unapproved.yaml', 'sha256':'0'*64}
                for invalid in (pins[:-1], pins+[unexpected], pins+[pins[0]], pins[:-1]+[unexpected],
                        pins[:-1]+[pins[0]], [dict(pins[0], path='/tmp/unapproved')]+pins[1:]):
                    with self.subTest(paths=[pin['path'] for pin in invalid]):
                        write_receipt(invalid)
                        with self.assertRaises(AssertionError):
                            self.control.runtime_hashes()
                write_receipt([dict(pins[0], sha256='0'*64)]+pins[1:])
                with self.assertRaisesRegex(AssertionError, 'configuration changed'):
                    self.control.runtime_hashes()
                write_receipt(pins)
                (self.control.A/approved[0]).write_text('changed synthetic configuration')
                with self.assertRaisesRegex(AssertionError, 'configuration changed'):
                    self.control.runtime_hashes()
                run.assert_not_called()

    def test_listener_validation_checks_every_pilot_pid_and_exact_component_ports(self):
        self.assertTrue(hasattr(self.control, 'validate_listeners'), 'pure listener validator missing')
        unrelated = {'protocol':'tcp', 'port':55555, 'address':'192.0.2.1:55555', 'owners':['999']}
        actual = self.control.validate_listeners(self.rows+[unrelated], self.pids)
        self.assertEqual(len(actual), 9)
        self.assertNotIn(unrelated, actual)
        child = copy.deepcopy(self.rows)
        child[0]['owners'] = ['111']
        self.assertEqual(len(self.control.validate_listeners(child, self.pids)), 9)
        invalid = []
        for changes in ({'owners':[]}, {'address':'0.0.0.0:14317'}, {'address':'[::]:14317'}, {'address':'[::1]:14317'},
                {'protocol':'udp'}, {'owners':['22']}, {'owners':['11','999']}, {'owners':['999']}):
            rows = copy.deepcopy(self.rows)
            rows[0].update(changes)
            invalid.append(rows)
        invalid.append(self.rows+[{'protocol':'tcp', 'port':55555,
            'address':'127.0.0.1:55555', 'owners':['111']}])
        invalid.append(self.rows+[copy.deepcopy(self.rows[0])])
        invalid.append(self.rows[:-1])
        for rows in invalid:
            with self.subTest(rows=rows):
                with self.assertRaises(AssertionError):
                    self.control.validate_listeners(rows, self.pids)
        with self.assertRaises(AssertionError):
            self.control.validate_listeners(self.rows, dict(self.pids, alloy=set()))

    def test_stop_accepts_not_found_units_after_partial_registration(self):
        states = {name:({'LoadState':'not-found'} if index%2 else
            {'LoadState':'loaded', 'MainPID':'0', 'ActiveState':'inactive'})
            for index, name in enumerate(self.control.NAMES)}
        with tempfile.TemporaryDirectory(prefix='aeon-control-test-') as directory:
            self.control.E = Path(directory)
            with patch.object(self.control, 'show', side_effect=lambda name, **kw:states[name]), \
                    patch.object(self.control, 'run') as run, \
                    patch.object(self.control, 'sockets', return_value=[]), patch('builtins.print'):
                self.control.stop()
            run.assert_called_once_with('systemctl', '--user', 'stop', *self.control.NAMES, check=False)
            self.assertTrue((Path(directory)/'shutdown.json').is_file())

    def test_stop_still_runs_when_a_before_pid_has_already_exited(self):
        active = {'MainPID':'11', 'ActiveState':'active', 'ControlGroup':'/synthetic-gone'}
        inactive = {'MainPID':'0', 'ActiveState':'inactive'}
        calls = iter([active, *[inactive]*7])
        with tempfile.TemporaryDirectory(prefix='aeon-control-test-') as directory:
            self.control.E = Path(directory)
            with patch.object(self.control, 'show', side_effect=lambda *a, **kw:next(calls)), \
                    patch.object(self.control, 'read_group_pids', return_value=set(), create=True), \
                    patch.object(self.control, 'pid_alive', return_value=False, create=True), \
                    patch.object(self.control, 'run') as run, \
                    patch.object(self.control, 'sockets', return_value=[]), patch('builtins.print'):
                self.control.stop()
            run.assert_called_once_with('systemctl', '--user', 'stop', *self.control.NAMES, check=False)

    def test_shutdown_requires_empty_groups_dead_children_and_no_owned_listener(self):
        self.assertTrue(hasattr(self.control, 'validate_shutdown'), 'shutdown ownership validator missing')
        ownership = {'units':{'aeon-pilot-alloy.service':{'pids':['11','111'],
            'control_groups':['/synthetic/alloy']}}}
        states = {'aeon-pilot-alloy.service':{'MainPID':'0', 'ActiveState':'inactive'}}
        groups = {'/synthetic/alloy':set()}
        unrelated = {'port':55555, 'owners':['999']}
        self.control.validate_shutdown(ownership, states, groups, set(), [unrelated], {14317})
        invalid = [({'/synthetic/alloy':{'111'}}, set(), []),
            (groups, {'111'}, []),
            (groups, set(), [{'port':55555, 'owners':['111']}]),
            (groups, set(), [{'port':14317, 'owners':[]}])]
        for group_pids, alive, rows in invalid:
            with self.subTest(group_pids=group_pids, alive=alive, rows=rows), self.assertRaises(AssertionError):
                self.control.validate_shutdown(ownership, states, group_pids, alive, rows, {14317})
        with tempfile.TemporaryDirectory(prefix='aeon-control-test-') as directory:
            self.control.E = Path(directory)
            active = {'MainPID':'11', 'ActiveState':'active', 'ControlGroup':'/synthetic/alloy'}
            inactive = {'MainPID':'0', 'ActiveState':'inactive'}
            calls = iter([active, *[inactive]*7])
            with patch.object(self.control, 'show', side_effect=lambda *a, **kw:next(calls)), \
                    patch.object(self.control, 'read_group_pids', side_effect=[{'11','111'}, set()]), \
                    patch.object(self.control, 'pid_alive', return_value=False), \
                    patch.object(self.control, 'run'), patch.object(self.control, 'sockets', return_value=[]), \
                    patch('builtins.print'):
                self.control.stop()
            receipt = json.loads((Path(directory)/'shutdown.json').read_text())
            recorded = receipt['ownership_before']['units'][self.control.NAMES[0]]
            self.assertEqual(recorded['pids'], ['11','111'])
            self.assertEqual(recorded['control_groups'], ['/synthetic/alloy'])
            self.assertEqual(receipt['owned_pids_alive_after'], [])
            self.assertEqual(receipt['control_groups_after'], {'/synthetic/alloy':[]})

    def test_global_window_remaining_budget_cannot_reset_or_expand(self):
        self.assertTrue(hasattr(self.control, 'new_window'), 'finite global window missing')
        window = self.control.new_window(1000, 50)
        original = copy.deepcopy(window)
        self.assertEqual(window['deadline_epoch'], 2800)
        self.assertEqual(self.control.remaining_window(window, 1300, 350), 1500)
        self.assertEqual(self.control.remaining_window(window, 900, 350), 1500)
        self.assertEqual(window, original)
        for epoch, monotonic in ((2800, 350), (1300, 1850)):
            with self.assertRaisesRegex(AssertionError, 'expired'):
                self.control.remaining_window(window, epoch, monotonic)
        changed = dict(window, deadline_epoch=4600)
        with self.assertRaises(AssertionError):
            self.control.remaining_window(changed, 1300, 350)

    def test_runtime_security_properties_require_exact_bounded_values(self):
        self.assertTrue(hasattr(self.control, 'validate_runtime_properties'), 'effective property validator missing')
        good = {'RuntimeMaxUSec':'30min', 'Restart':'no', 'NoNewPrivileges':'yes',
            'UMask':'0077', 'TimeoutStopUSec':'25s', 'KillMode':'control-group'}
        self.control.validate_runtime_properties(good, 1800)
        recovered = dict(good, RuntimeMaxUSec='25min')
        self.control.validate_runtime_properties(recovered, 1500)
        for changes in ({'RuntimeMaxUSec':'infinity'}, {'RuntimeMaxUSec':'31min'},
                {'Restart':'on-failure'}, {'NoNewPrivileges':'no'}, {'UMask':'0022'},
                {'TimeoutStopUSec':'20s'}, {'KillMode':'process'}):
            with self.subTest(changes=changes), self.assertRaises(AssertionError):
                self.control.validate_runtime_properties(dict(good, **changes), 1800)
        with self.assertRaises(AssertionError):
            self.control.validate_runtime_properties(good, 1500)

    def test_start_and_retry_preserve_the_first_deadline_and_reduce_runtime(self):
        with tempfile.TemporaryDirectory(prefix='aeon-control-test-') as directory:
            self.control.E = Path(directory)
            (self.control.E/'prestart-gates.json').write_text('{"passed":true}')
            with ExitStack() as stack:
                preflight = stack.enter_context(patch.object(self.control, 'preflight'))
                run = stack.enter_context(patch.object(self.control, 'run'))
                stack.enter_context(patch.object(self.control, 'runtime_hashes', return_value={'fixture':'sha256'}, create=True))
                stack.enter_context(patch.object(self.control, 'wait_ready', create=True))
                stack.enter_context(patch.object(self.control, 'show', return_value={'ActiveState':'active'}))
                stack.enter_context(patch.object(self.control, 'sockets', return_value=self.rows))
                limits = stack.enter_context(patch.object(self.control, 'limits'))
                clock = stack.enter_context(patch.object(self.control.time, 'time', return_value=1000))
                mono = stack.enter_context(patch.object(self.control.time, 'monotonic', return_value=50))
                self.control.start()
                self.assertTrue((self.control.E/'runtime-window.json').is_file(), 'first startup did not persist global deadline')
                first = json.loads((self.control.E/'runtime-window.json').read_text())
                self.assertEqual(first['deadline_epoch'], 2800)
                self.assertEqual(set(first['unit_runtime_seconds'].values()), {1800})
                clock.return_value = 1300
                mono.return_value = 350
                run.reset_mock()
                self.control.start()
                retry = json.loads((self.control.E/'runtime-window.json').read_text())
                self.assertEqual(retry['deadline_epoch'], first['deadline_epoch'])
                self.assertEqual(retry['started_at'], first['started_at'])
                self.assertEqual(set(retry['unit_runtime_seconds'].values()), {1500})
                for name in self.control.NAMES:
                    self.assertIn((('systemctl','--user','set-property','--runtime',name,'RuntimeMaxSec=1500s'), {}),
                        [(call.args, call.kwargs) for call in run.call_args_list])
                self.assertEqual(limits.call_count, 2)
                self.assertIsNotNone(preflight.call_args.kwargs.get('window'))
                clock.return_value = 2800
                run.reset_mock()
                with self.assertRaisesRegex(AssertionError, 'expired'):
                    self.control.start()
                run.assert_not_called()

    def test_retry_unit_validation_rejects_active_or_foreign_fragments(self):
        self.assertTrue(hasattr(self.control, 'validate_retry_unit'), 'safe retry unit validation missing')
        name = self.control.NAMES[0]
        good = {'LoadState':'loaded', 'ActiveState':'inactive', 'MainPID':'0',
            'FragmentPath':str(self.control.A/'observability/pilot/units'/name)}
        self.control.validate_retry_unit(good, name)
        self.control.validate_retry_unit({'LoadState':'not-found'}, name)
        for changes in ({'ActiveState':'active'}, {'MainPID':'99'}, {'FragmentPath':'/tmp/foreign.service'}):
            with self.assertRaises(AssertionError):
                self.control.validate_retry_unit(dict(good, **changes), name)

    def test_alloy_outage_and_recovery_touch_only_alloy_with_remaining_budget(self):
        self.assertTrue(hasattr(self.control, 'outage'), 'bounded Alloy outage action missing')
        self.assertTrue(hasattr(self.control, 'recover_alloy'), 'bounded Alloy recovery action missing')
        alloy = 'aeon-pilot-alloy.service'
        inactive = {'LoadState':'loaded', 'ActiveState':'inactive', 'MainPID':'0',
            'FragmentPath':str(self.control.A/'observability/pilot/units'/alloy)}
        def state(name, **kwargs):
            return inactive if name == alloy else {'ActiveState':'active', 'MainPID':'22', 'ControlGroup':'/synthetic/'+name}
        with tempfile.TemporaryDirectory(prefix='aeon-control-test-') as directory:
            self.control.E = Path(directory)
            window = self.control.new_window(1000, 50)
            window['runtime_hashes'] = {'fixture':'sha256'}
            self.control.save_window(window)
            with ExitStack() as stack:
                stack.enter_context(patch.object(self.control.time, 'time', return_value=1300))
                stack.enter_context(patch.object(self.control.time, 'monotonic', return_value=350))
                hashes = stack.enter_context(patch.object(self.control, 'runtime_hashes', return_value={'fixture':'sha256'}))
                stack.enter_context(patch.object(self.control, 'show', side_effect=state))
                stop = stack.enter_context(patch.object(self.control, 'stop_selected', return_value={'units':{alloy:inactive}}))
                run = stack.enter_context(patch.object(self.control, 'run'))
                stack.enter_context(patch.object(self.control, 'wait_ready'))
                limits = stack.enter_context(patch.object(self.control, 'limits'))
                stack.enter_context(patch('builtins.print'))
                self.control.outage()
                stop.assert_called_once_with([alloy], 'alloy-outage.json', {14317,14318,12346})
                self.assertEqual(limits.call_count, 1)
                run.assert_not_called()
                self.control.recover_alloy()
                self.assertEqual([(call.args, call.kwargs) for call in run.call_args_list], [
                    (('systemctl','--user','set-property','--runtime',alloy,'RuntimeMaxSec=1500s'), {}),
                    (('systemctl','--user','start',alloy), {})])
                self.assertEqual(limits.call_count, 2)
                restored = json.loads((self.control.E/'runtime-window.json').read_text())
                self.assertEqual(restored['deadline_epoch'], 2800)
                self.assertEqual(restored['unit_runtime_seconds'][alloy], 1500)
                self.assertEqual({restored['unit_runtime_seconds'][name] for name in self.control.NAMES if name!=alloy}, {1800})
                run.reset_mock()
                hashes.return_value = {'fixture':'modified'}
                with self.assertRaisesRegex(AssertionError, 'configuration'):
                    self.control.recover_alloy()
                run.assert_not_called()
                hashes.return_value = {'fixture':'sha256'}
                limits.side_effect = AssertionError('limits failed')
                stop.reset_mock()
                with self.assertRaisesRegex(AssertionError, 'limits failed'):
                    self.control.recover_alloy()
                self.assertEqual(stop.call_count, 1)
                self.assertEqual(stop.call_args.args[0], [alloy])


if __name__ == '__main__':
    unittest.main()
