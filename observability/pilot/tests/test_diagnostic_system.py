"""System adapter tests use only private temporary files and injected OS commands."""
import importlib.util
import os
import hashlib
import json
from pathlib import Path
import tempfile
import io
import tarfile
import shutil
from types import SimpleNamespace
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'diagnostic_system.py'


def load():
    spec = importlib.util.spec_from_file_location('diagnostic_system', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Clock:
    def __init__(self): self.now = 0.0
    def monotonic(self): return self.now
    def time(self): return 1000000000 + self.now
    def sleep(self, seconds): self.now += seconds


class Fixture:
    def __init__(self, root, module):
        self.root = root
        self.clock = Clock()
        self.calls = []
        self.rows = []
        self.states = {}
        source = root / 'observability/pilot'
        old = root / 'var/observability-pilot'
        evidence = old / 'evidence'
        for directory in (source, evidence, root / 'artifacts/observability', root / 'cg', root / 'proc', root / 'runtime', root / 'persistent'):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        for directory in root.rglob('*'):
            if directory.is_dir(): directory.chmod(0o700)
        state = root / 'var/tempo-shutdown-check/Test1'
        names = {component: f'aeon-tempo-check-{component}-Test1.service' for component in ('tempo', 'alloy', 'prometheus', 'grafana')}
        config_names = ('README.md', 'tempo.yaml', 'config.alloy', 'prometheus.yaml', 'grafana.ini', 'hermes_otel.synthetic.yaml', 'provisioning/datasources/local.yaml')
        self.contents = {f'config/{name}': 'inert\n' for name in config_names}
        self.contents.update({f'units/{name}': '[Service]\nRuntimeMaxSec=700s\n' for name in names.values()})
        self.spec = SimpleNamespace(run_id='Test1', aeon_root=root, source_root=source, state=state,
                                    evidence=state/'evidence', home=state/'home', config=state/'config',
                                    units_dir=state/'units', unit_names=names, emitter_name='aeon-tempo-check-emitter-Test1.scope',
                                    render=lambda seconds: dict(self.contents))
        self.adapter = module.RealOS(cgroup_root=root/'cg', proc_root=root/'proc', runtime_root=root/'runtime', persistent_root=root/'persistent')
        self.backend = module.SystemBackend(self.spec, os_adapter=self.adapter, run=self.run, sockets=lambda deadline: list(self.rows), clock=self.clock)
        self.backend._verify_pins = lambda deadline: {'pins': 1}
        self.backend._inventory = lambda deadline: {'bytes': 0}
        self.backend.binaries = {name: str(root/'artifacts/observability'/name) for name in ('tempo', 'alloy', 'promtool', 'grafana')}
        self.backend.native = {'site': str(root/'site')}
        self.backend.custody = {'core_owner': {'path': str(root/'core')}}
        self.backend._preserved = lambda deadline: True
        controller = root/'cg/user.slice'/f'user-{os.geteuid()}.slice'/f'user@{os.geteuid()}.service'
        controller.mkdir(parents=True)
        (controller/'cgroup.controllers').write_text('cpu memory pids')

    def run(self, args, **kw):
        self.calls.append((args, kw))
        if args[:3] == ['systemctl', '--user', 'show']:
            state = self.states.get(args[3], {'Id': args[3], 'LoadState': 'not-found', 'MainPID': '0', 'ActiveState': 'inactive'})
            return SimpleNamespace(returncode=0, stdout='\n'.join(f'{k}={v}' for k,v in state.items()), stderr='')
        return SimpleNamespace(returncode=0, stdout='', stderr='')

    def activate(self):
        for index, (component, name) in enumerate(self.spec.unit_names.items()):
            pid = str(100 + index)
            group = f'/user.slice/user-{os.geteuid()}.slice/user@{os.geteuid()}.service/app.slice/{name}'
            directory = self.adapter.group(group); directory.mkdir(parents=True, exist_ok=True)
            mx, hi, quota = load().LIMITS[component]
            values = {'cgroup.procs': pid, 'memory.max': str(mx*1024**2), 'memory.high': str(hi*1024**2),
                      'memory.swap.max': '0', 'pids.max': '128', 'cpu.max': f'{quota*1000} 100000',
                      'memory.events': 'oom 0\noom_kill 0\n'}
            for key,value in values.items(): (directory/key).write_text(value)
            proc = self.root/'proc'/pid; proc.mkdir(exist_ok=True)
            (proc/'environ').write_bytes(b'PATH=/usr/bin:/bin\0GOMAXPROCS=2\0GOMEMLIMIT=100MiB\0')
            self.states[name] = {'Id': name, 'LoadState':'loaded', 'ActiveState':'active', 'MainPID':pid,
                                 'ControlGroup':group, 'FragmentPath':str(self.spec.units_dir/name),
                                 'RuntimeMaxUSec':'700000000', 'TimeoutStopUSec': '90000000' if component=='tempo' else '25000000',
                                 'Restart':'no', 'NoNewPrivileges':'yes', 'UMask':'0077', 'KillMode':'control-group',
                                 'MemoryMax':str(mx*1024**2), 'MemoryHigh':str(hi*1024**2), 'MemorySwapMax':'0',
                                 'TasksMax':'128', 'CPUQuotaPerSecUSec':str(quota*10000)}
        self.rows = [{'port': port, 'address':f'127.0.0.1:{port}', 'protocol':'tcp',
                      'owners':[self.states[self.spec.unit_names[component]]['MainPID']]}
                     for port,component in load().EXPECTED_PORTS.items()]

    def stopped_runner(self, *, graceful=True, log=True, fail=False):
        original = self.run
        def run(args,**kw):
            if args[:3] == ['systemctl','--user','stop']:
                if fail: raise TimeoutError('injected_stop_timeout')
                for name in args[3:]:
                    state=self.states[name]
                    state.update(ActiveState='inactive',MainPID='0',Result='success' if graceful else 'timeout',ExecMainCode='1' if graceful else '2',ExecMainStatus='0' if graceful else '9')
                    (self.adapter.group(state['ControlGroup'])/'cgroup.procs').write_text('')
                    for proc in (self.root/'proc').iterdir():
                        if proc.name in self.backend.ownership.get(name,{}).get('pids',set()): shutil.rmtree(proc)
                stopped=set(args[3:])
                self.rows=[row for row in self.rows if self.spec.unit_names[load().EXPECTED_PORTS[row['port']]] not in stopped]
            if args[0]=='journalctl':
                entries=[]
                if log:
                    entries=[{'_PID':'100','__REALTIME_TIMESTAMP':str(int(self.clock.time()*1000000)), 'PRIORITY':'6', 'MESSAGE':'level=info msg="Tempo stopped"'}]
                self.calls.append((args,kw))
                return SimpleNamespace(returncode=0,stdout='\n'.join(json.dumps(e) for e in entries),stderr='')
            return original(args,**kw)
        self.backend.run=run


class StopTests(unittest.TestCase):
    def active(self, root, module):
        fixture=Fixture(root,module)
        fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10); fixture.activate()
        fixture.backend.runtime_seconds={name:700 for name in fixture.spec.unit_names.values()}
        fixture.backend.verify_active(timeout=10)
        return fixture

    def test_graceful_stop_needs_exit_milestone_empty_group_and_unchanged_peers(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=self.active(Path(temporary),module); fixture.stopped_runner()
            proof=fixture.backend.stop_tempo(timeout=95)
            self.assertEqual(proof['result'],'success')
            self.assertTrue(proof['completion_milestone'])
            self.assertTrue(proof['peers_unchanged'])
            self.assertEqual(proof['cgroup_pids'],[])
            stopped=[args for args,_ in fixture.calls if args[:3]==['systemctl','--user','stop']]
            self.assertEqual(stopped,[['systemctl','--user','stop',fixture.spec.unit_names['tempo']]])

    def test_stop_returncode_zero_missing_milestone_and_sigkill_are_not_graceful(self):
        module=load()
        for graceful, log in ((True,False),(False,True)):
            with self.subTest(graceful=graceful,log=log), tempfile.TemporaryDirectory() as temporary:
                fixture=self.active(Path(temporary),module); fixture.stopped_runner(graceful=graceful,log=log)
                proof=fixture.backend.stop_tempo(timeout=95)
                self.assertFalse(proof['passed'])

    def test_final_cleanup_requests_owned_units_concurrently_and_rejects_foreign(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=self.active(Path(temporary),module); fixture.stopped_runner()
            proof=fixture.backend.cleanup(timeout=95)
            self.assertTrue(proof['passed'])
            stopped=[args for args,_ in fixture.calls if args[:3]==['systemctl','--user','stop']]
            self.assertEqual(len(stopped),1)
            self.assertEqual(set(stopped[0][3:]),set(fixture.spec.unit_names.values()))
            self.assertTrue(proof['graceful_tempo']['passed'])
        with tempfile.TemporaryDirectory() as temporary:
            fixture=self.active(Path(temporary),module); fixture.stopped_runner()
            foreign=fixture.spec.unit_names['alloy']; fixture.states[foreign]['FragmentPath']='/foreign/alloy.service'
            proof=fixture.backend.cleanup(timeout=95)
            self.assertFalse(proof['passed'])
            stopped=[args for args,_ in fixture.calls if args[:3]==['systemctl','--user','stop']]
            self.assertNotIn(foreign,stopped[0])

    def test_timeout_zero_uses_only_previously_owned_groups_without_fresh_wait(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=self.active(Path(temporary),module)
            killed=[]
            fixture.adapter.kill_group=lambda group, expected_identity: killed.append(group)
            fixture.calls.clear()
            proof=fixture.backend.cleanup(timeout=0)
            self.assertFalse(proof['passed'])
            self.assertEqual(set(killed),{state['ControlGroup'] for state in fixture.states.values()})
            self.assertEqual(fixture.calls,[])


class RuntimePhaseTests(unittest.TestCase):
    def test_readback_binds_fresh_receipts_three_inventory_roots_and_deadline(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10)
            calls=[]
            def reader(emitted,phase,**kw):
                calls.append((emitted,phase,kw)); return {'passed':True}
            fixture.backend.reader=SimpleNamespace(run=reader)
            fixture.backend.readback({'expected_spans':[]},timeout=60,stage='durability')
            self.assertEqual(calls[0][1],'normal')
            kw=calls[0][2]
            self.assertEqual(kw['absolute_deadline'],60)
            self.assertEqual(kw['grafana_config_path'],fixture.spec.config/'grafana.ini')
            self.assertEqual(kw['binary_prereqs_path'],fixture.spec.evidence/'binary-prereqs.json')
            self.assertEqual(kw['inventory_roots'],(fixture.backend.old_state,fixture.root/'artifacts/observability',fixture.spec.state))

    def test_effective_configuration_retains_only_selected_fields(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=StopTests().active(Path(temporary),module)
            requests=[]
            def http(url,deadline,**kw):
                requests.append((url,deadline))
                return 'shutdown_delay: 0s\nserver:\n  log_level: info\n  http_server_graceful_shutdown_timeout: 30s\nbackend_worker:\n  finish_on_shutdown_timeout: 30s\nsecret: NEVER_RETAIN\n'
            fixture.backend.http=http
            fixture.stopped_runner(log=False)
            proof=fixture.backend.effective_config(timeout=10)
            self.assertEqual(requests,[('http://127.0.0.1:13200/status/config',10)])
            self.assertEqual(proof['selected_fields']['shutdown_delay'],'0s')
            self.assertNotIn('NEVER_RETAIN',json.dumps(proof))

    def test_quiesce_makes_no_requests_or_commands_and_stays_within_budget(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            fixture.backend.quiesce(seconds=40,timeout=40)
            self.assertEqual(fixture.clock.now,40)
            self.assertEqual(fixture.calls,[])
            with self.assertRaises(ValueError): fixture.backend.quiesce(seconds=41,timeout=42)
            with self.assertRaises(TimeoutError): fixture.backend.quiesce(seconds=40,timeout=39)

    def test_restart_only_after_graceful_gate_and_once_with_peers_unchanged(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=StopTests().active(Path(temporary),module); fixture.stopped_runner()
            fixture.backend.started=True
            with self.assertRaises(ValueError): fixture.backend.restart_tempo(600,timeout=30)
            fixture.backend.stop_tempo(timeout=95)
            original=fixture.backend.run
            old_peer={name:dict(state) for name,state in fixture.states.items() if name!=fixture.spec.unit_names['tempo']}
            def run(args,**kw):
                if args[:3]==['systemctl','--user','start']:
                    fixture.activate()
                    fixture.states[fixture.spec.unit_names['tempo']]['RuntimeMaxUSec']='600000000'
                    for name,state in old_peer.items(): fixture.states[name]=state
                return original(args,**kw)
            fixture.backend.run=run
            proof=fixture.backend.restart_tempo(600,timeout=30)
            self.assertTrue(proof['peers_unchanged'])
            self.assertFalse(fixture.backend.emitted)
            with self.assertRaises(ValueError): fixture.backend.restart_tempo(500,timeout=30)

    def test_emitter_command_has_fresh_home_output_and_exact_boundaries(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            command=fixture.backend._emitter_command()
            self.assertIn('--unit='+fixture.spec.emitter_name,command)
            for expected in ('--property=MemoryMax=256M','--property=CPUQuota=25%','--property=TasksMax=64','--property=MemorySwapMax=0','--kill-after=5s','60s','HOME='+str(fixture.spec.home)):
                self.assertIn(expected,command)
            self.assertEqual(command[-2:],['--output',str(fixture.spec.evidence/'emitted.json')])
            self.assertIn(str(fixture.backend.old_state/'fixture'),next(item for item in command if item.startswith('PYTHONPATH=')))
            self.assertNotIn('HOME='+str(fixture.backend.old_state/'fixture/home'),command)


class EmitterTests(unittest.TestCase):
    def fake_spawn(self, fixture, *, exit_code=0):
        name=fixture.spec.emitter_name
        group=f'/user.slice/user-{os.geteuid()}.slice/user@{os.geteuid()}.service/app.slice/{name}'
        origins={}
        origin_dir=fixture.root/'approved-emitter-imports'; origin_dir.mkdir()
        for module_name in ('openai','opentelemetry.trace','opentelemetry.sdk.trace','opentelemetry.instrumentation.openai','opentelemetry.exporter.otlp.proto.http.trace_exporter','requests','yaml'):
            path=origin_dir/(module_name+'.py'); path.write_text('synthetic '+module_name)
            origins[module_name]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        fixture.backend.approved_emitter_origins=origins
        def spawn(command,**kw):
            directory=fixture.adapter.group(group); directory.mkdir(parents=True)
            for key,value in {'cgroup.procs':'800','memory.max':str(256*1024**2),'memory.swap.max':'0','pids.max':'64','cpu.max':'25000 100000','memory.events':'oom 0\noom_kill 0\n'}.items():
                (directory/key).write_text(value)
            proc=fixture.root/'proc/800'; proc.mkdir()
            (proc/'cmdline').write_bytes(b'\0'.join(part.encode() for part in command))
            fixture.states[name]={'Id':name,'LoadState':'loaded','ActiveState':'active','ControlGroup':group,'FragmentPath':'','Transient':'yes'}
            class Process:
                count=0
                def poll(self):
                    self.count+=1
                    if self.count==1: return None
                    if self.count>2: return exit_code
                    if exit_code==0:
                        limits={'memory.max':str(256*1024**2),'memory.swap.max':'0','pids.max':'64','cpu.max':'25000 100000'}
                        receipt={'synthetic_only':True,'outage_expected':False,'dry_run':False,'export_verdict':'SUCCESS','span_count':25,'canonical_api_count':5,
                                 'expected_spans':[{'trace_id':str(i%6)} for i in range(25)],'sensitive_sentinel_absent':True,'utility_qualified':False,'release_evaluated':False,
                                 'effective_emitter_resources':{'group':str(directory),'limits':limits,'memory_events':{'oom':'0','oom_kill':'0'}},'imported_origins':{key:dict(value) for key,value in origins.items()}}
                        fixture.adapter.write_exclusive(fixture.spec.evidence/'emitted.json',json.dumps(receipt))
                    (directory/'cgroup.procs').write_text(''); shutil.rmtree(proc)
                    fixture.states[name].update(LoadState='not-found',ActiveState='inactive')
                    return exit_code
            return Process()
        fixture.backend.spawn=spawn
        fixture.backend.reader=SimpleNamespace(validate_expected=lambda spans:{(i,0):span for i,span in enumerate(spans)})
        return group

    def test_emission_is_one_owned_scope_and_requires_full_65_second_allowance(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=StopTests().active(Path(temporary),module)
            group=self.fake_spawn(fixture)
            with self.assertRaises(TimeoutError): fixture.backend.emit(timeout=64)
            receipt=fixture.backend.emit(timeout=70)
            self.assertEqual(receipt['span_count'],25)
            self.assertEqual(fixture.backend.ownership[fixture.spec.emitter_name]['groups'],{group})
            with self.assertRaises(ValueError): fixture.backend.emit(timeout=70)

    def test_emitter_failure_stops_only_positive_owned_units_in_same_budget(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=StopTests().active(Path(temporary),module)
            self.fake_spawn(fixture,exit_code=1); fixture.stopped_runner()
            foreign=fixture.spec.unit_names['alloy']; fixture.states[foreign]['FragmentPath']='/foreign/alloy.service'
            with self.assertRaises(RuntimeError): fixture.backend.emit(timeout=70)
            stop=[(args,kw) for args,kw in fixture.calls if args[:3]==['systemctl','--user','stop']]
            self.assertTrue(stop)
            self.assertNotIn(foreign,stop[0][0])
            self.assertLessEqual(stop[0][1]['timeout'],70)

    def test_partial_registration_failure_never_stops_foreign_unit(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10)
            original=fixture.run
            def run(args,**kw):
                if args[:3]==['systemctl','--user','link']:
                    for name in fixture.spec.unit_names.values():
                        fixture.states[name]={'Id':name,'LoadState':'loaded','ActiveState':'inactive','MainPID':'0','FragmentPath':str(fixture.spec.units_dir/name),'ControlGroup':''}
                    fixture.states[fixture.spec.unit_names['alloy']]['FragmentPath']='/foreign/alloy.service'
                    fixture.calls.append((args,kw))
                    return SimpleNamespace(returncode=1,stdout='',stderr='injected_partial_registration')
                return original(args,**kw)
            fixture.backend.run=run
            with self.assertRaises(RuntimeError): fixture.backend.start(700,timeout=30)
            stop=[args for args,_ in fixture.calls if args[:3]==['systemctl','--user','stop']]
            self.assertEqual(len(stop),1)
            self.assertNotIn(fixture.spec.unit_names['alloy'],stop[0])


class StartOwnershipTests(unittest.TestCase):
    def test_active_ownership_requires_fragment_uid_and_exact_run_cgroup(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10); fixture.activate()
            name = fixture.spec.unit_names['tempo']
            fixture.backend._own(name, fixture.states[name])
            for key,value in [('FragmentPath', '/foreign/tempo.service'), ('ControlGroup', '/foreign/'+name), ('Id','foreign.service')]:
                state = dict(fixture.states[name]); state[key] = value
                with self.assertRaises(ValueError): fixture.backend._own(name,state)

    def test_effective_resources_listener_owners_and_environment_are_checked(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10); fixture.activate()
            fixture.backend.runtime_seconds = {name:700 for name in fixture.spec.unit_names.values()}
            proof = fixture.backend.verify_active(timeout=10)
            self.assertEqual(proof['service_memory_max_mib'],1920)
            self.assertEqual(proof['service_cpu_percent'],200)
            self.assertEqual(len(proof['listeners']),9)
            fixture.rows[0]['address']='0.0.0.0:'+str(fixture.rows[0]['port'])
            with self.assertRaises(ValueError): fixture.backend.verify_active(timeout=10)
            fixture.rows[0]['address']='127.0.0.1:'+str(fixture.rows[0]['port'])
            (fixture.root/'proc/100/environ').write_bytes(b'API_KEY=secret\0')
            with self.assertRaises(ValueError): fixture.backend.verify_active(timeout=10)

    def test_start_registers_exact_four_fresh_units_and_runtime_cap(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10); fixture.backend.prepare(timeout=10)
            original_run = fixture.run
            def run(args,**kw):
                if args[:3] == ['systemctl','--user','link']:
                    for name in fixture.spec.unit_names.values():
                        fixture.states[name]={'Id':name,'LoadState':'loaded','ActiveState':'inactive','MainPID':'0','FragmentPath':str(fixture.spec.units_dir/name),'ControlGroup':''}
                if args[:3] == ['systemctl','--user','start']: fixture.activate()
                return original_run(args,**kw)
            fixture.backend.run=run
            proof=fixture.backend.start(700,timeout=30)
            link=[args for args,_ in fixture.calls if args[:3]==['systemctl','--user','link']]
            self.assertEqual(len(link),1)
            self.assertEqual(set(link[0][4:]),{str(fixture.spec.units_dir/name) for name in fixture.spec.unit_names.values()})
            self.assertTrue(proof['passed'])
            with self.assertRaises(ValueError): fixture.backend.start(700,timeout=30)


class PreflightPreparationTests(unittest.TestCase):
    def test_readonly_preflight_requires_fresh_names_ports_and_controllers(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10)
            self.assertFalse(fixture.spec.state.exists())
            self.assertTrue(all(call[0][2] == 'show' for call in fixture.calls))
            fixture.rows = [{'port': 13200, 'owners': ['987'], 'address': '127.0.0.1:13200', 'protocol': 'tcp'}]
            with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)
            fixture.rows = []
            fixture.states[fixture.spec.unit_names['tempo']] = {'LoadState': 'loaded'}
            with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)

    def test_prepare_writes_only_exclusive_private_namespace_and_inert_validators(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10)
            fixture.calls.clear()
            fixture.backend.prepare(timeout=10)
            self.assertTrue((fixture.spec.config/'tempo.yaml').is_file())
            for path in fixture.spec.state.rglob('*'):
                self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)
            self.assertEqual(len(fixture.calls), 6)
            self.assertFalse(any(call[0][0] in ('systemctl', 'systemd-run') for call in fixture.calls))
            with self.assertRaises((ValueError, FileExistsError)): fixture.backend.prepare(timeout=10)

    def test_result_receipt_is_exclusive_and_old_receipts_are_preserved(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            fixture.backend.preflight(timeout=10)
            fixture.backend.prepare(timeout=10)
            result = {'passed': False, 'utility_qualified': False, 'release_evaluated': False}
            path = fixture.backend.record(result)
            self.assertEqual(json.loads(Path(path).read_text()), result)
            with self.assertRaises(FileExistsError): fixture.backend.record(result)


class PinTests(unittest.TestCase):
    def test_changed_pin_and_escaping_relative_pin_are_refused(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = Fixture(root, module)
            path = root/'approved'; path.write_bytes(b'approved')
            pin = {'path': 'approved', 'sha256': hashlib.sha256(b'approved').hexdigest()}
            fixture.backend._verify_file_pins([pin], 10, root=root)
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError): fixture.backend._verify_file_pins([pin], 10, root=root)
            with self.assertRaises(ValueError): fixture.backend._verify_file_pins([dict(pin,path='../escape')], 10, root=root)

    def test_extracted_binary_must_match_hash_verified_archive_bytes(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(Path(temporary), module)
            archive = Path(temporary)/'approved.tar.gz'
            binary = Path(temporary)/'tempo'; binary.write_bytes(b'exact binary')
            with tarfile.open(archive, 'w:gz') as bundle:
                info = tarfile.TarInfo('tempo'); info.size = 12
                bundle.addfile(info, io.BytesIO(b'exact binary'))
            fixture.backend._archive_binary(archive, 'tempo', binary, 10)
            binary.write_bytes(b'foreign binary')
            with self.assertRaises(ValueError): fixture.backend._archive_binary(archive, 'tempo', binary, 10)

    def test_only_explicit_manifest_approved_reader_transition_is_permitted(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            path=fixture.root/'observability/pilot/readback.py'; path.write_bytes(b'reviewednew')
            newhash=hashlib.sha256(b'reviewednew').hexdigest()
            oldpin={'path':'observability/pilot/readback.py','sha256':module.LEGACY_READBACK_SHA256}
            replacement=dict(oldpin,previous_sha256=oldpin['sha256'],sha256=newhash)
            manifest={'baseline_commit':'ecaa'+('0'*36),'replaced_original_sources':[replacement], 'source_pins':[dict(oldpin,sha256=newhash)]}
            fixture.backend._verify_source_transition([oldpin],manifest,10,original_root=fixture.root,new_root=fixture.root)
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError): fixture.backend._verify_source_transition([oldpin],manifest,10,original_root=fixture.root,new_root=fixture.root)
            path.write_bytes(b'reviewednew')
            with self.assertRaises(ValueError): fixture.backend._verify_source_transition([oldpin],dict(manifest,replaced_original_sources=[]),10,original_root=fixture.root,new_root=fixture.root)

    def test_own_group_writable_ancestor_allowed_outside_private_var(self):
        module=load()
        with tempfile.TemporaryDirectory() as temporary:
            fixture=Fixture(Path(temporary),module)
            fixture.root.chmod(0o775)
            fixture.backend.preflight(timeout=10)
            fixture.backend.prepare(timeout=10)
            (fixture.root/'var').chmod(0o775)
            with self.assertRaises(ValueError): fixture.adapter.directory(fixture.spec.state,private=True)


class AdapterBoundaryTests(unittest.TestCase):
    def test_one_deadline_shrinks_command_timeouts(self):
        module = load()
        clock = Clock()
        calls = []
        def run(args, **kw):
            calls.append(kw['timeout'])
            clock.now += 3
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        backend = module.SystemBackend(SimpleNamespace(), run=run, clock=clock)
        deadline = backend._deadline(10)
        backend._command(['true'], deadline)
        backend._command(['true'], deadline)
        self.assertEqual(calls, [10, 7])
        clock.now = 11
        with self.assertRaises(TimeoutError): backend._command(['true'], deadline)
        self.assertEqual(len(calls), 2)

    def test_directory_creation_refuses_links_unsafe_parents_and_reuse(self):
        module = load()
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            adapter = module.RealOS()
            adapter.directory(base / 'fresh', create=True, exclusive=True)
            self.assertEqual((base / 'fresh').stat().st_mode & 0o777, 0o700)
            with self.assertRaises((ValueError, FileExistsError)):
                adapter.directory(base / 'fresh', create=True, exclusive=True)
            (base / 'link').symlink_to(base / 'fresh', target_is_directory=True)
            with self.assertRaises((ValueError, OSError)):
                adapter.directory(base / 'link' / 'child', create=True)
            (base / 'unsafe').mkdir(mode=0o777)
            (base / 'unsafe').chmod(0o777)
            with self.assertRaises(ValueError): adapter.directory(base / 'unsafe' / 'child', create=True)


if __name__ == '__main__': unittest.main()
