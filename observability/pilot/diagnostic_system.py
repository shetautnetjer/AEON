"""Explicitly invoked OS adapter for the single isolated Tempo diagnostic.

Import and construction are inert. Commands, sockets, clocks, process creation,
and OS roots are injectable; the original controller globals are never changed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import time

EXPECTED_PORTS = {14317: 'alloy', 14318: 'alloy', 12346: 'alloy', 13200: 'tempo',
                  24317: 'tempo', 24318: 'tempo', 19095: 'tempo', 19090: 'prometheus', 13000: 'grafana'}
COLLECTOR_PORTS = {4317, 4318, 4320, 13133}
EMITTER_IMPORT_MODULES = ('openai','opentelemetry.trace','opentelemetry.sdk.trace','opentelemetry.instrumentation.openai',
                         'opentelemetry.exporter.otlp.proto.http.trace_exporter','requests','yaml')
LIMITS = {'alloy': (384, 320, 50), 'tempo': (768, 640, 75),
          'prometheus': (384, 320, 50), 'grafana': (384, 320, 25)}
SHOW_PROPERTIES = ('Id,LoadState,ActiveState,SubState,Result,MainPID,ControlGroup,FragmentPath,'
                   'MemoryMax,MemoryHigh,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,'
                   'Restart,NoNewPrivileges,UMask,TimeoutStopUSec,KillMode,ExecMainCode,ExecMainStatus,Transient')
LEGACY_READBACK_SHA256 = 'dc8b1a78efb644e25c06e8b13e75df3ccb8d430b017fe720a9855680126480c3'


class RealOS:
    def __init__(self, *, uid=None, cgroup_root=Path('/sys/fs/cgroup'),
                 proc_root=Path('/proc'), runtime_root=None, persistent_root=None):
        self.uid = os.geteuid() if uid is None else uid
        self.root_uid = Path('/').stat().st_uid
        self.private_roots = ()
        self.cgroup_root = Path(cgroup_root)
        self.proc_root = Path(proc_root)
        self.runtime_root = Path(runtime_root or f'/run/user/{self.uid}/systemd/user')
        self.persistent_root = Path(persistent_root or Path.home() / '.config/systemd/user')

    def directory(self, path, *, create=False, exclusive=False, private=False):
        """Walk with directory fds and O_NOFOLLOW; mkdir never adopts a namespace."""
        path = Path(path)
        if not path.is_absolute() or '..' in path.parts:
            raise ValueError('unsafe_directory_path')
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            current = Path('/')
            for index, part in enumerate(path.parts[1:]):
                last = index == len(path.parts) - 2
                current = current / part
                if create:
                    try: os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        if exclusive and last: raise
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
                info = os.fstat(fd)
                trusted_tmp = current == Path('/tmp') and info.st_uid == self.root_uid and info.st_mode & stat.S_ISVTX
                protected = any(current.is_relative_to(root) for root in self.private_roots)
                unsafe_mode = info.st_mode & (0o022 if protected or info.st_uid != self.uid else 0o002)
                if info.st_uid not in {self.root_uid, self.uid} or unsafe_mode and not trusted_tmp:
                    raise ValueError('unsafe_directory_owner_or_mode')
                if protected and info.st_uid != self.uid: raise ValueError('private_ancestor_not_owned')
                if last and private and (info.st_uid != self.uid or stat.S_IMODE(info.st_mode) != 0o700):
                    raise ValueError('namespace_directory_not_private')
        finally: os.close(fd)

    def write_exclusive(self, path, data):
        path = Path(path)
        self.directory(path.parent, private=True)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data if isinstance(data, bytes) else data.encode())
                stream.flush()
                os.fsync(stream.fileno())
        finally: os.close(parent)

    def replace_owned(self, path, data, expected_hash):
        path = Path(path)
        self.directory(path.parent, private=True)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('replacement_file_not_owned_private')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
            raise ValueError('replacement_file_changed')
        temporary = path.with_name('.'+path.name+'.'+os.urandom(12).hex())
        self.write_exclusive(temporary, data)
        os.replace(temporary, path)

    def group(self, name):
        if not name.startswith('/') or '..' in name.split('/') or name == '/':
            raise ValueError('unsafe_control_group')
        return self.cgroup_root / name.lstrip('/')

    def group_pids(self, name):
        group = self.group(name)
        if not group.exists(): return set()
        result = set()
        for file in (group / 'cgroup.procs', *group.rglob('cgroup.procs')):
            try: result.update(file.read_text().split())
            except FileNotFoundError: continue
        if any(not pid.isdigit() or int(pid) <= 0 for pid in result):
            raise ValueError('invalid_cgroup_pid')
        return result

    def pid_alive(self, pid): return (self.proc_root / str(pid)).exists()
    def pid_uid(self, pid): return (self.proc_root / str(pid)).stat().st_uid
    def command_line(self, pid):
        return (self.proc_root / str(pid) / 'cmdline').read_bytes().split(b'\0')
    def environment_keys(self, pid):
        return {part.split(b'=', 1)[0].decode() for part in
                (self.proc_root / str(pid) / 'environ').read_bytes().split(b'\0') if part}

    def group_identity(self, name):
        fd = os.open(self.group(name), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if info.st_uid != self.uid: raise ValueError('control_group_owner_mismatch')
            return (info.st_dev, info.st_ino)
        finally: os.close(fd)

    def kill_group(self, name, expected_identity):
        """Nonblocking kernel kill, only for an exact previously proved cgroup."""
        group = self.group(name)
        fd = os.open(group, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if info.st_uid != self.uid: raise ValueError('kill_group_owner_mismatch')
            if (info.st_dev, info.st_ino) != expected_identity:
                raise ValueError('kill_group_identity_mismatch')
            pids = self.group_pids(name)
            if any(self.pid_uid(pid)!=self.uid for pid in pids): raise ValueError('kill_group_process_owner_mismatch')
            target = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW, dir_fd=fd)
            try: os.write(target,b'1')
            finally: os.close(target)
        finally: os.close(fd)


class SystemBackend:
    def __init__(self, spec, *, os_adapter=None, run=None, sockets=None,
                 clock=None, reader=None, http=None, spawn=None):
        self.spec = spec
        self.os = os_adapter or RealOS()
        if hasattr(spec,'aeon_root'):
            self.os.private_roots = (*self.os.private_roots, spec.aeon_root/'var')
        self.run = run or subprocess.run
        self.socket_adapter = sockets
        self.clock = clock or time
        self.reader = reader
        self.http = http
        self.spawn = spawn or subprocess.Popen
        self.ownership = {}
        self.registered = set()
        self.runtime_seconds = {}
        self.prepared = False
        self.started = False
        self.emitted = False
        self.preservation = {}
        self.verified_files = {}
        self.collectors = None
        self.forced = set()
        self.stop_proofs = []

    def _deadline(self, timeout):
        if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('invalid_phase_timeout')
        return self.clock.monotonic() + timeout

    def _remaining(self, deadline):
        remaining = deadline - self.clock.monotonic()
        if remaining <= 0: raise TimeoutError('diagnostic_phase_deadline')
        return remaining

    def _command(self, args, deadline, *, check=True, env=None):
        result = self.run(list(map(str, args)), timeout=self._remaining(deadline),
                          text=True, capture_output=True, check=False, env=env)
        if check and result.returncode:
            raise RuntimeError('diagnostic_command_failed:' + Path(str(args[0])).name)
        return result

    @property
    def old_state(self): return self.spec.aeon_root / 'var/observability-pilot'

    def _show(self, name, deadline):
        output = self._command(['systemctl', '--user', 'show', name,
                                '--property=' + SHOW_PROPERTIES], deadline, check=False)
        return dict(line.split('=', 1) for line in output.stdout.splitlines() if '=' in line)

    def _sockets(self, deadline, *, established=False):
        if self.socket_adapter is not None:
            return self.socket_adapter(deadline)
        output = self._command(['ss', '-H', '-tnp' if established else '-ltnup'], deadline).stdout
        rows = []
        for line in output.splitlines():
            fields = line.split()
            if len(fields) < (5 if established else 6): raise ValueError('invalid_socket_row')
            address = fields[3] if established else fields[4]
            rows.append({'protocol': 'tcp' if established else fields[0],
                         'port': int(address.rsplit(':', 1)[1]), 'address': address,
                         'owners': re.findall(r'pid=(\d+)', line),
                         **({'peer': fields[4]} if established else {})})
        return rows

    def _collector_snapshot(self, rows):
        return sorted((dict(row, owners=sorted(map(str, row.get('owners', [])))) for row in rows
                       if row['port'] in COLLECTOR_PORTS), key=lambda row: (row['port'], row['address']))

    def _check_collectors(self, deadline):
        current = self._collector_snapshot(self._sockets(deadline))
        if self.collectors is None or current != self.collectors:
            raise ValueError('existing_collector_ownership_changed')
        return True

    def _save(self, name, value):
        path = self.spec.evidence / name
        self.os.write_exclusive(path, json.dumps(value, indent=2, allow_nan=False) + '\n')
        return str(path)

    def preflight(self, timeout=60):
        deadline = self._deadline(timeout)
        if self.spec.state.exists() or self.spec.state.is_symlink():
            raise ValueError('diagnostic_namespace_already_owned')
        parent = self.spec.state.parent
        while not parent.exists(): parent = parent.parent
        self.os.directory(parent)
        pins = self._verify_pins(deadline)
        rows = self._sockets(deadline)
        if any(row['port'] in set(EXPECTED_PORTS) | {13101, 17946} for row in rows):
            raise ValueError('diagnostic_port_conflict')
        names = list(self.spec.unit_names.values()) + [self.spec.emitter_name]
        for name in names:
            if self._show(name, deadline).get('LoadState') != 'not-found':
                raise ValueError('diagnostic_unit_name_already_owned')
            for root in (self.os.persistent_root, self.os.runtime_root):
                for path in (root / name, root / (name + '.d')):
                    if path.exists() or path.is_symlink(): raise ValueError('diagnostic_registration_already_owned')
        controllers = self.os.cgroup_root / 'user.slice' / f'user-{self.os.uid}.slice' / f'user@{self.os.uid}.service' / 'cgroup.controllers'
        if not {'cpu', 'memory', 'pids'} <= set(controllers.read_text().split()):
            raise ValueError('resource_controllers_unavailable')
        self.collectors = self._collector_snapshot(rows)
        self.preflight_proof = {'passed': True, 'pins': pins, 'collectors': self.collectors,
                                'ports_free': sorted(EXPECTED_PORTS), 'inventory': self._inventory(deadline)}
        return self.preflight_proof

    def prepare(self, timeout=60):
        deadline = self._deadline(timeout)
        if not hasattr(self, 'preflight_proof'): raise ValueError('preflight_required')
        self.os.directory(self.spec.state, create=True, exclusive=True, private=True)
        for path in (self.spec.evidence, self.spec.home, self.spec.config, self.spec.units_dir,
                     self.spec.state/'tempo', self.spec.state/'tempo/wal', self.spec.state/'tempo/blocks',
                     self.spec.state/'alloy', self.spec.state/'prometheus', self.spec.state/'grafana',
                     self.spec.state/'grafana/plugins', self.spec.home/'runtime'):
            self.os.directory(path, create=True, private=True)
        contents = self.spec.render(700)
        if len(contents) != 11: raise ValueError('diagnostic_render_set_changed')
        self.rendered = {}
        for relative, content in contents.items():
            selected = Path(relative)
            if selected.is_absolute() or '..' in selected.parts or selected.parts[0] not in {'config', 'units'}:
                raise ValueError('diagnostic_render_path_escape')
            path = self.spec.state / selected
            self.os.directory(path.parent, create=True, private=True)
            self.os.write_exclusive(path, content)
            self.rendered[relative] = hashlib.sha256(content.encode()).hexdigest()
        commands = [
            [self.binaries['alloy'], 'validate', self.spec.config/'config.alloy'],
            [self.binaries['promtool'], 'check', 'config', self.spec.config/'prometheus.yaml'],
            [self.binaries['tempo'], '-target=all', '-config.file='+str(self.spec.config/'tempo.yaml'), '-config.verify=true'],
            [self.binaries['tempo'], '-version'], [self.binaries['grafana'], 'server', '-v'],
            ['systemd-analyze', '--user', 'verify', *[self.spec.units_dir/name for name in self.spec.unit_names.values()]],
        ]
        results = []
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.spec.home), 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
        for command in commands:
            result = self._command(command, deadline, env=env)
            results.append({'command': list(map(str, command)), 'exit_code': result.returncode,
                            'stdout': result.stdout, 'stderr': result.stderr})
        self.prepared = True
        self._save('preflight.json', self.preflight_proof)
        proof = {'passed': True, 'results': results, 'config_pins':
                 [{'path': path, 'sha256': digest} for path, digest in self.rendered.items()]}
        self._save('binary-prereqs.json', proof)
        return proof

    def record(self, result):
        return self._save('result.json', result)

    def _hash_stream(self, stream, deadline):
        digest = hashlib.sha256()
        while True:
            self._remaining(deadline)
            chunk = stream.read(1024 * 1024)
            if not chunk: return digest.hexdigest()
            digest.update(chunk)

    def _hash(self, path, deadline):
        with Path(path).open('rb') as stream: return self._hash_stream(stream, deadline)

    def _verify_file_pins(self, pins, deadline, *, root=None):
        seen = set()
        for pin in pins:
            path = Path(pin['path'])
            if root is not None:
                if path.is_absolute() or '..' in path.parts: raise ValueError('unsafe_relative_pin')
                path = Path(root) / path
                if not path.resolve().is_relative_to(Path(root).resolve()): raise ValueError('pin_escaped_root')
            elif not path.is_absolute(): raise ValueError('absolute_pin_required')
            if str(path) in seen: raise ValueError('duplicate_source_pin')
            seen.add(str(path))
            if self._hash(path, deadline) != pin['sha256']: raise ValueError('approved_file_hash_changed')
            self.verified_files[str(path)] = pin['sha256']
        return len(seen)

    def _archive_binary(self, archive, member, binary, deadline):
        with tarfile.open(archive, 'r:gz') as bundle:
            selected = bundle.getmember(member)
            if not selected.isfile(): raise ValueError('approved_archive_binary_not_regular')
            with bundle.extractfile(selected) as stream: expected = self._hash_stream(stream, deadline)
        if self._hash(binary, deadline) != expected: raise ValueError('extracted_binary_changed')
        self.verified_files[str(binary)] = expected

    def _json(self, path):
        return json.loads(Path(path).read_bytes())

    def _verify_pins(self, deadline):
        original = self.spec.aeon_root / 'observability/pilot'
        evidence = self.old_state / 'evidence'
        pins = self._json(original/'artifact-pins.json')
        acquisition = self._json(evidence/'acquisition.json')
        counts = {}
        for pin in acquisition['verified_artifacts']:
            filename = Path(pin['filename'])
            if filename.name != str(filename): raise ValueError('artifact_filename_escape')
            directory = 'wheelhouse' if filename.suffix == '.whl' else 'archives'
            artifact = self.spec.aeon_root / 'artifacts/observability' / directory / filename
            if self._hash(artifact, deadline) != pin['sha256']: raise ValueError('approved_artifact_changed')
            self.verified_files[str(artifact)] = pin['sha256']
        counts['artifacts'] = len(acquisition['verified_artifacts'])
        self.binaries = {}
        for pin in pins['artifacts']:
            if 'installed_path' in pin:
                self._verify_file_pins([{'path': pin['installed_path'], 'sha256': pin['installed_binary_sha256']}], deadline)
                if Path(pin['installed_path']).resolve() != Path(pin['resolved_path']).resolve():
                    raise ValueError('installed_binary_owner_changed')
                self.binaries[pin['component']] = pin['installed_path']
        tool = pins['promtool']
        self._verify_file_pins([{'path': tool['installed_path'], 'sha256': tool['installed_binary_sha256']}], deadline)
        if Path(tool['installed_path']).resolve() != Path(tool['resolved_path']).resolve():
            raise ValueError('promtool_owner_changed')
        self.binaries['promtool'] = tool['installed_path']
        artifacts = self.spec.aeon_root / 'artifacts/observability'
        self.binaries['tempo'] = str(artifacts/'tempo-3.1.0/tempo')
        self.binaries['grafana'] = str(artifacts/'grafana-13.2.3/bin/grafana')
        archive_by_component = {pin['component']: pin for pin in pins['artifacts']}
        for component, member in (('tempo', 'tempo'), ('grafana', 'grafana-13.2.3/bin/grafana')):
            pin = archive_by_component['grafana-oss' if component == 'grafana' else component]
            self._archive_binary(artifacts/'archives'/pin['filename'], member, self.binaries[component], deadline)
        self.custody = self._json(original/'source-custody.json')
        counts['source'] = self._verify_file_pins(self.custody['source_pins'], deadline)
        baseline = self._json(original/'source-baseline.json')
        counts['plugin'] = self._verify_file_pins(baseline['sources'], deadline)
        self.native = self._json(evidence/'native-existing-dependencies.json')
        counts['native'] = self._verify_file_pins([file for dist in self.native['distributions'] for file in dist['files']], deadline)
        imports = self._json(evidence/'instrumentor-imports-final.json')
        if imports.get('passed') is not True: raise ValueError('fixture_import_receipt_failed')
        imported_files = {}
        for item in imports['imported_origins'].values():
            if item['path'] in imported_files and imported_files[item['path']]['sha256']!=item['sha256']:
                raise ValueError('import_alias_hash_mismatch')
            imported_files[item['path']] = item
        counts['fixture'] = self._verify_file_pins(list(imported_files.values()), deadline)
        try:
            self.approved_emitter_origins = {name:{key:imports['imported_origins'][name][key] for key in ('path','sha256')}
                                            for name in EMITTER_IMPORT_MODULES}
        except (KeyError,TypeError): raise ValueError('approved_emitter_import_origin_missing')
        protected = self._json(evidence/'protected-before.json')
        counts['protected'] = self._verify_file_pins([{'path': p, 'sha256': h} for p,h in protected.items()], deadline)
        prereqs = self._json(evidence/'binary-prereqs.json')
        if prereqs.get('passed') is not True: raise ValueError('original_binary_receipt_failed')
        expected = {'observability/pilot/config/'+name for name in ('README.md', 'config.alloy', 'grafana.ini',
                    'hermes_otel.synthetic.yaml', 'prometheus.yaml', 'provisioning/datasources/local.yaml', 'tempo.yaml')}
        expected |= {'observability/pilot/units/aeon-pilot-'+component+'.service' for component in LIMITS}
        if {pin['path'] for pin in prereqs['config_pins']} != expected:
            raise ValueError('original_config_pin_set_changed')
        counts['config'] = self._verify_file_pins(prereqs['config_pins'], deadline, root=self.spec.aeon_root)
        gates = self._json(evidence/'prestart-gates.json')
        manifest = self._json(self.spec.source_root/'diagnostic-source-pins.json')
        expected_new = {'observability/pilot/'+name for name in ('diagnostic.py','diagnostic_config.py','diagnostic_system.py','readback.py')}
        expected_new |= {'observability/pilot/tests/'+name for name in ('test_diagnostic_flow.py','test_diagnostic_config.py','test_diagnostic_system.py','test_pilot_readback.py','test_diagnostic_readback.py','test_diagnostic_disk_deadline.py','test_diagnostic_terminal.py','test_diagnostic_record.py')}
        expected_new |= expected
        manifest_paths = {pin['path'] for pin in manifest['source_pins']}
        if not expected_new <= manifest_paths: raise ValueError('diagnostic_source_manifest_incomplete')
        counts['original_runtime_source'] = self._verify_source_transition(gates['source_pins'],manifest,deadline,
                                            original_root=self.spec.aeon_root,new_root=self.spec.source_root.parents[1])
        emitter = next(pin for pin in gates['source_pins'] if pin['path'] == 'observability/pilot/emit_synthetic.py')
        self._verify_file_pins([dict(emitter, path=str(self.spec.source_root/'emit_synthetic.py'))], deadline)
        self.preservation = {str(path): self._hash(path, deadline) for path in evidence.rglob('*') if path.is_file()}
        self.original_evidence_paths = set(self.preservation)
        self.preservation.update({str(self.spec.aeon_root/pin['path']): pin['sha256'] for pin in prereqs['config_pins']})
        self.preservation.update(protected)
        counts['retained_evidence'] = len(self.original_evidence_paths)
        return counts

    def _verify_source_transition(self, old_pins, manifest, deadline, *, original_root, new_root):
        if not isinstance(manifest.get('baseline_commit'),str) or not re.fullmatch(r'ecaa[0-9a-f]{36}',manifest['baseline_commit']):
            raise ValueError('diagnostic_manifest_baseline_mismatch')
        self._verify_file_pins(manifest['source_pins'],deadline,root=new_root)
        replacements = manifest.get('replaced_original_sources')
        if not isinstance(replacements,list) or len(replacements)!=1: raise ValueError('explicit_reader_transition_required')
        replacement = replacements[0]
        path = 'observability/pilot/readback.py'
        original = next((pin for pin in old_pins if pin['path']==path),None)
        approved = next((pin for pin in manifest['source_pins'] if pin['path']==path),None)
        if replacement.get('path')!=path or original is None or approved is None or original['sha256']!=LEGACY_READBACK_SHA256:
            raise ValueError('legacy_reader_transition_mismatch')
        if replacement.get('previous_sha256')!=original['sha256'] or replacement.get('sha256')!=approved['sha256']:
            raise ValueError('reviewed_reader_transition_mismatch')
        allowed = {original['sha256'],replacement['sha256']}
        original_path = Path(original_root)/path
        observed = self._hash(original_path,deadline)
        if observed not in allowed:
            raise ValueError('original_reader_unapproved_change')
        self.verified_files[str(original_path)] = observed
        other = [pin for pin in old_pins if pin['path']!=path]
        return self._verify_file_pins(other,deadline,root=original_root)+1

    def _preserved(self, deadline):
        if not self.preservation: raise ValueError('original_preservation_baseline_missing')
        current = {str(path) for path in (self.old_state/'evidence').rglob('*') if path.is_file()}
        if current != self.original_evidence_paths: raise ValueError('original_evidence_set_changed')
        self._verify_file_pins([{'path': path, 'sha256': digest} for path,digest in self.verified_files.items()], deadline)
        self._verify_file_pins([{'path': path, 'sha256': digest} for path,digest in self.preservation.items()], deadline)
        return True

    def _inventory(self, deadline):
        self._remaining(deadline)
        reader = self._reader()
        roots = (self.old_state, self.spec.aeon_root/'artifacts/observability')
        if self.spec.state.exists(): roots += (self.spec.state,)
        result = reader.disk_usage(roots[0], roots[1], additional_roots=roots[2:], absolute_deadline=deadline)
        self._remaining(deadline)
        return result

    def _reader(self):
        if self.reader is None:
            import readback
            self.reader = readback
        return self.reader

    def _own(self, name, state, *, active=True):
        if name not in set(self.spec.unit_names.values()) | {self.spec.emitter_name}:
            raise ValueError('unit_outside_diagnostic_scope')
        if state.get('Id') != name or state.get('LoadState') != 'loaded':
            raise ValueError('diagnostic_unit_identity_mismatch')
        if name != self.spec.emitter_name:
            fragment = Path(state.get('FragmentPath', ''))
            expected = self.spec.units_dir / name
            try: matching = fragment.is_absolute() and fragment.resolve(strict=True) == expected.resolve(strict=True)
            except (OSError, RuntimeError): matching = False
            if not matching:
                raise ValueError('diagnostic_unit_fragment_mismatch')
            info = expected.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != self.os.uid or stat.S_IMODE(info.st_mode) != 0o600:
                raise ValueError('diagnostic_fragment_not_private_owned')
            relative = 'units/' + name
            if hashlib.sha256(expected.read_bytes()).hexdigest() != self.rendered[relative]:
                raise ValueError('diagnostic_fragment_changed')
        else:
            if state.get('Transient') != 'yes': raise ValueError('emitter_scope_not_owned_transient')
            if state.get('FragmentPath'):
                fragment = Path(state['FragmentPath'])
                expected = self.os.runtime_root.parent / 'transient' / name
                if fragment != expected: raise ValueError('emitter_scope_not_owned_transient')
                info = fragment.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_uid != self.os.uid:
                    raise ValueError('emitter_scope_not_owned_transient')
        group = state.get('ControlGroup', '')
        approved = f'/user.slice/user-{self.os.uid}.slice/user@{self.os.uid}.service/app.slice/{name}'
        if group and group != approved: raise ValueError('diagnostic_cgroup_identity_mismatch')
        if active and (state.get('ActiveState') != 'active' or group != approved):
            raise ValueError('diagnostic_unit_not_active_owned')
        pids = self.os.group_pids(group) if group else set()
        if any(self.os.pid_uid(pid) != self.os.uid for pid in pids):
            raise ValueError('diagnostic_process_uid_mismatch')
        main = state.get('MainPID', '0')
        if name != self.spec.emitter_name and active and (not main.isdigit() or int(main) <= 0 or main not in pids):
            raise ValueError('diagnostic_main_pid_not_owned')
        if name == self.spec.emitter_name and pids:
            wanted = str(self.spec.source_root/'emit_synthetic.py').encode()
            output = str(self.spec.evidence/'emitted.json').encode()
            if not getattr(self,'emitter_attempted',False) or not any(wanted in self.os.command_line(pid) and output in self.os.command_line(pid) for pid in pids):
                raise ValueError('emitter_process_command_not_owned')
        saved = self.ownership.setdefault(name, {'pids': set(), 'groups': set(), 'main_pid': main})
        if group and self.os.group(group).exists():
            identity = self.os.group_identity(group)
            previous = saved.setdefault('group_identities', {}).get(group)
            if previous is not None and previous != identity and not (active and getattr(self,'restarting_group',None)==name):
                raise ValueError('diagnostic_cgroup_lifetime_changed')
            saved['group_identities'][group] = identity
            if active and getattr(self,'restarting_group',None)==name:
                self.restarting_group = None
        saved['pids'].update(pids)
        if group: saved['groups'].add(group)
        if main.isdigit() and int(main)>0: saved['main_pid'] = main
        self.registered.add(name)
        return pids

    @staticmethod
    def _seconds(value):
        text = str(value).replace(' ', '')
        if text.isdigit(): return int(text) / 1000000
        parts = re.findall(r'(\d+(?:\.\d+)?)(us|ms|min|s|h|d)', text)
        if not parts or ''.join(n+u for n,u in parts) != text: raise ValueError('invalid_effective_duration')
        scale = {'us': .000001, 'ms': .001, 's': 1, 'min': 60, 'h': 3600, 'd': 86400}
        return sum(float(n)*scale[u] for n,u in parts)

    def _properties(self, component, state):
        name = self.spec.unit_names[component]
        if self._seconds(state.get('RuntimeMaxUSec')) != self.runtime_seconds[name]:
            raise ValueError('effective_runtime_cap_changed')
        if self._seconds(state.get('TimeoutStopUSec')) != (90 if component=='tempo' else 25):
            raise ValueError('effective_stop_grace_changed')
        if state.get('Restart') != 'no' or state.get('KillMode') != 'control-group':
            raise ValueError('effective_stop_or_restart_policy_changed')
        if state.get('NoNewPrivileges') not in {'yes', 'true', '1'} or int(state.get('UMask','0'),8) != 0o077:
            raise ValueError('effective_service_privacy_changed')
        mx, hi, quota = LIMITS[component]
        checks = {'MemoryMax':mx*1024**2, 'MemoryHigh':hi*1024**2, 'MemorySwapMax':0, 'TasksMax':128}
        if any(int(state.get(key, '-1')) != value for key,value in checks.items()):
            raise ValueError('effective_systemd_resources_changed')
        if self._seconds(state.get('CPUQuotaPerSecUSec')) != quota/100:
            raise ValueError('effective_systemd_cpu_changed')

    def _events(self, group):
        expected = {entry.get('group_identities', {}).get(group) for entry in self.ownership.values()
                    if group in entry['groups']}
        if len(expected) != 1 or None in expected or self.os.group_identity(group) not in expected:
            raise ValueError('memory_events_unverifiable')
        file = self.os.group(group) / 'memory.events'
        if not file.exists():
            raise ValueError('memory_events_unverifiable')
        events = dict((key, int(value)) for key,value in (line.split() for line in file.read_text().splitlines()))
        if not {'oom','oom_kill'} <= set(events): raise ValueError('memory_events_incomplete')
        if not hasattr(self, 'memory_events'): self.memory_events = {}
        self.memory_events[group] = events
        return events

    def _final_oom(self, groups):
        """A vanished cgroup cannot turn a pre-stop sample into a final counter."""
        if not groups: return None
        try:
            events = [self._events(group) for group in groups]
        except (OSError, ValueError):
            return None
        return sum(item['oom'] + item['oom_kill'] for item in events)

    def _verify_active(self, deadline):
        components = {}
        units = []
        for component, name in self.spec.unit_names.items():
            state = self._show(name, deadline)
            pids = self._own(name, state)
            self._properties(component, state)
            group = self.os.group(state['ControlGroup'])
            cg = {key:(group/key).read_text().strip() for key in ('memory.max','memory.high','memory.swap.max','pids.max','cpu.max')}
            mx, hi, quota = LIMITS[component]
            if int(cg['memory.max']) != mx*1024**2 or int(cg['memory.high']) != hi*1024**2 or cg['memory.swap.max'] != '0' or cg['pids.max'] != '128':
                raise ValueError('effective_cgroup_resources_changed')
            q, period = map(int,cg['cpu.max'].split())
            if q/period != quota/100: raise ValueError('effective_cgroup_cpu_changed')
            keys = self.os.environment_keys(state['MainPID'])
            if not keys <= {'PATH','GOMAXPROCS','GOMEMLIMIT'}: raise ValueError('unexpected_service_environment_key')
            events = self._events(state['ControlGroup'])
            if events['oom'] or events['oom_kill']: raise ValueError('diagnostic_oom_event')
            components[component] = pids
            units.append({'unit':name, 'properties':state, 'effective_cgroup':cg,
                          'environment_keys':sorted(keys), 'memory_events':events})
        owners = {pid:component for component,pids in components.items() for pid in pids}
        if len(owners) != sum(map(len,components.values())): raise ValueError('diagnostic_pid_shared_between_units')
        listeners = []
        for row in self._sockets(deadline):
            pids = set(map(str,row.get('owners',[])))
            if row['port'] not in set(EXPECTED_PORTS)|{13101,17946} and not pids.intersection(owners): continue
            if not pids or not pids <= set(owners) or row['port'] not in EXPECTED_PORTS:
                raise ValueError('unexpected_or_unowned_diagnostic_listener')
            if row['protocol'] != 'tcp' or row['address'] != f"127.0.0.1:{row['port']}":
                raise ValueError('diagnostic_listener_not_tcp_loopback')
            if {owners[pid] for pid in pids} != {EXPECTED_PORTS[row['port']]}:
                raise ValueError('diagnostic_listener_component_mismatch')
            listeners.append(row)
        if len(listeners)!=9 or {row['port'] for row in listeners}!=set(EXPECTED_PORTS):
            raise ValueError('diagnostic_listener_set_incomplete')
        for row in self._sockets(deadline, established=True):
            if set(map(str,row.get('owners',[]))).intersection(owners) and 'peer' in row:
                if not row['peer'].startswith('127.0.0.1:'): raise ValueError('diagnostic_established_peer_not_loopback')
        self._check_collectors(deadline)
        return {'passed':True, 'units':units, 'component_pids':{key:sorted(value) for key,value in components.items()},
                'listeners':sorted(listeners,key=lambda row:row['port']), 'service_memory_max_mib':1920,
                'service_cpu_percent':200, 'inventory':self._inventory(deadline)}

    def verify_active(self, timeout): return self._verify_active(self._deadline(timeout))

    def _render_runtime(self, names, runtime_seconds):
        if type(runtime_seconds) is not int or not 0 < runtime_seconds <= 775:
            raise ValueError('invalid_diagnostic_runtime_cap')
        contents = self.spec.render(runtime_seconds)
        for name in names:
            if name in self.runtime_seconds and runtime_seconds > self.runtime_seconds[name]:
                raise ValueError('runtime_cap_must_not_increase')
            relative = 'units/'+name
            self.os.replace_owned(self.spec.units_dir/name, contents[relative], self.rendered[relative])
            self.rendered[relative] = hashlib.sha256(contents[relative].encode()).hexdigest()
            self.runtime_seconds[name] = runtime_seconds

    def _ready(self, deadline):
        while True:
            states = {name:self._show(name,deadline) for name in self.spec.unit_names.values()}
            if any(state.get('ActiveState')=='failed' for state in states.values()):
                raise ValueError('diagnostic_startup_failed')
            if all(state.get('ActiveState')=='active' for state in states.values()):
                rows = self._sockets(deadline)
                if {row['port'] for row in rows if row['port'] in EXPECTED_PORTS} == set(EXPECTED_PORTS):
                    return self._verify_active(deadline)
            self.clock.sleep(min(.25,self._remaining(deadline)))

    def start(self, runtime_seconds, timeout):
        deadline = self._deadline(timeout)
        if not self.prepared or self.started: raise ValueError('diagnostic_start_not_fresh_prepared')
        self._check_collectors(deadline)
        if any(row['port'] in set(EXPECTED_PORTS)|{13101,17946} for row in self._sockets(deadline)):
            raise ValueError('diagnostic_port_conflict_at_start')
        names = list(self.spec.unit_names.values())
        if any(self._show(name,deadline).get('LoadState')!='not-found' for name in names):
            raise ValueError('diagnostic_unit_claimed_since_preflight')
        self._render_runtime(names,runtime_seconds)
        self.started = True
        self.first_start_epoch = self.clock.time()
        try:
            self._command(['systemctl','--user','link','--runtime',*[self.spec.units_dir/name for name in names]],deadline)
            self._command(['systemctl','--user','daemon-reload'],deadline)
            for name in names: self._own(name,self._show(name,deadline),active=False)
            self._command(['systemctl','--user','start',*names],deadline)
            proof = self._ready(deadline)
            self._save('start.json',proof)
            return proof
        except BaseException:
            self._cleanup_partial(deadline)
            raise

    def _peer_snapshot(self, deadline):
        result = {}
        for component,name in self.spec.unit_names.items():
            if component=='tempo': continue
            state = self._show(name,deadline)
            pids = self._own(name,state)
            result[name] = {'MainPID':state['MainPID'], 'ControlGroup':state['ControlGroup'], 'pids':sorted(pids)}
        return result

    def _logs(self, name, pid, since, deadline):
        output = self._command(['journalctl','--user','--unit='+name,'--since=@'+str(since),
                                '--until=@'+str(self.clock.time()),'--output=json','--no-pager'],deadline).stdout
        if len(output)>4*1024*1024: raise ValueError('lifecycle_journal_too_large')
        milestones = []
        for line in output.splitlines():
            row = json.loads(line)
            if row.get('_PID') != str(pid) or row.get('PRIORITY') != '6': continue
            stamp = int(row.get('__REALTIME_TIMESTAMP','0')) / 1000000
            if not since <= stamp <= self.clock.time(): continue
            message = row.get('MESSAGE','')
            match = re.search(r'\bmsg="(Tempo stopped|stopping module|module stopped|starting module|module started)"',message)
            if not match: continue
            item = {'pid':str(pid), 'time_epoch':stamp, 'milestone':match[1]}
            module = re.search(r'\bmodule=([a-zA-Z0-9_-]{1,80})(?:\s|$)',message)
            if module: item['module'] = module[1]
            milestones.append(item)
        return milestones

    def _force_owned(self, names):
        for name in names:
            entry = self.ownership.get(name)
            if not entry: continue
            for group in entry['groups']:
                approved = f'/user.slice/user-{self.os.uid}.slice/user@{self.os.uid}.service/app.slice/{name}'
                if group != approved: continue
                try:
                    identity = entry.get('group_identities', {}).get(group)
                    if identity is None or self.os.group_identity(group) != identity: continue
                    current = self.os.group_pids(group)
                    if current and all(self.os.pid_uid(pid) == self.os.uid for pid in current):
                        entry['pids'].update(current)
                        self.os.kill_group(group, identity)
                        self.forced.add(name)
                except (OSError, ValueError):
                    self.forced.add(name)

    def _select_owned(self, deadline):
        selected = []
        rejected = []
        candidates = list(self.spec.unit_names.values())
        if getattr(self,'emitter_attempted',False) or self.spec.emitter_name in self.ownership:
            candidates.append(self.spec.emitter_name)
        for name in candidates:
            state = self._show(name,deadline)
            if state.get('LoadState')=='not-found': continue
            try: self._own(name,state,active=False)
            except (ValueError,OSError):
                rejected.append(name)
                continue
            selected.append(name)
        return selected,rejected

    def _stop_batch(self, names, deadline):
        if not names: return True
        reserve = min(5, max(0,self._remaining(deadline)-.001))
        try:
            self._command(['systemctl','--user','stop',*names],deadline-reserve)
            return True
        except (TimeoutError,subprocess.TimeoutExpired,RuntimeError,OSError):
            self._force_owned(names)
            return False

    def _cleanup_partial(self, deadline):
        """An exception must not widen either the unit set or the phase budget."""
        try:
            names,_ = self._select_owned(deadline)
            self._stop_batch(names,deadline)
        except (TimeoutError,subprocess.TimeoutExpired,OSError,ValueError):
            self._force_owned(list(self.ownership))
        finally:
            self._stop_emitter_launcher(deadline)

    def _stop_emitter_launcher(self, deadline):
        """Stop only the retained Popen child, within the existing phase deadline."""
        process = getattr(self,'emitter_process',None)
        if process is None: return True
        try:
            if process.poll() is not None: return True
            process.kill()
            process.wait(timeout=max(0,min(1,deadline-self.clock.monotonic())))
        except (OSError,TimeoutError,subprocess.TimeoutExpired):
            pass
        return process.poll() is not None

    def _tempo_proof(self, state, requested_at, deadline, *, peers_unchanged=True, command_ok=True):
        name = self.spec.unit_names['tempo']
        entry = self.ownership.get(name, {'pids':set(),'groups':set(),'main_pid':'0'})
        groups = {group:sorted(self.os.group_pids(group)) for group in entry['groups']}
        pids = sorted(pid for pid in entry['pids'] if self.os.pid_alive(pid))
        rows = [row for row in self._sockets(deadline) if row['port'] in {port for port,owner in EXPECTED_PORTS.items() if owner=='tempo'}
                or set(map(str,row.get('owners',[]))).intersection(entry['pids'])]
        oom = self._final_oom(entry['groups'])
        milestones = self._logs(name,entry['main_pid'],requested_at,deadline)
        code = int(state.get('ExecMainCode','-1'))
        status = int(state.get('ExecMainStatus','-1'))
        proof = {'result':state.get('Result'), 'exit_code':status if code==1 else None,
                 'signal':status if code in {2,3} else None,
                 'forced_kill':name in self.forced or code in {2,3} and status==9,
                 'oom_events':oom, 'oom_verification':'verified_final_counter' if oom is not None else 'unverified_final_counter_unavailable',
                 'completion_milestone':any(item['milestone']=='Tempo stopped' for item in milestones),
                 'cgroup_pids':sorted({pid for value in groups.values() for pid in value}),
                 'pids_alive':pids, 'listeners':rows, 'peers_unchanged':peers_unchanged,
                 'request_epoch':requested_at, 'exit_observed_epoch':self.clock.time(),
                 'lifecycle':milestones, 'command_succeeded':command_ok}
        proof['passed'] = bool(command_ok and proof['result']=='success' and code==1 and status==0
                               and not proof['forced_kill'] and oom==0 and proof['completion_milestone']
                               and not proof['cgroup_pids'] and not pids and not rows and peers_unchanged
                               and state.get('MainPID')=='0' and state.get('ActiveState')=='inactive')
        return proof

    def stop_tempo(self, timeout):
        deadline = self._deadline(timeout)
        name = self.spec.unit_names['tempo']
        state = self._show(name,deadline)
        self._own(name,state)
        before = self._peer_snapshot(deadline)
        self._events(state['ControlGroup'])
        requested_at = self.clock.time()
        command_ok = self._stop_batch([name],deadline)
        after = self._show(name,deadline)
        try: peers = self._peer_snapshot(deadline)==before
        except (ValueError,OSError): peers = False
        proof = self._tempo_proof(after,requested_at,deadline,peers_unchanged=peers,command_ok=command_ok)
        self.first_stop = proof
        self.stop_proofs.append(proof)
        self.peer_baseline = before
        self._save('tempo-first-stop.json',proof)
        return proof

    def cleanup(self, timeout):
        if not isinstance(timeout,(int,float)) or not math.isfinite(timeout) or timeout<0:
            raise ValueError('invalid_cleanup_timeout')
        failed = {'passed':False, 'graceful_tempo':None, 'owned_emitter_stopped':False,
                  'remaining_pids':[], 'remaining_groups':[], 'remaining_listeners':[],
                  'collectors_unchanged':False, 'original_preserved':False,
                  'oom_events':None, 'oom_verification':'unverified_final_counter_unavailable'}
        if timeout==0:
            self._stop_emitter_launcher(self.clock.monotonic())
            self._force_owned(list(self.ownership))
            failed['reason']='cleanup_deadline_expired_verification_unavailable'
            failed['remaining_pids']=sorted({pid for entry in self.ownership.values() for pid in entry['pids'] if self.os.pid_alive(pid)})
            failed['remaining_groups']=sorted({group for entry in self.ownership.values() for group in entry['groups'] if self.os.group_pids(group)})
            return failed
        deadline = self._deadline(timeout)
        self._stop_emitter_launcher(deadline)
        try:
            selected,rejected = self._select_owned(deadline)
            tempo = self.spec.unit_names['tempo']
            before = self._show(tempo,deadline) if tempo in selected else None
            active_tempo = bool(before and before.get('ActiveState')=='active')
            for name in selected:
                for group in self.ownership[name]['groups']: self._events(group)
            requested_at = self.clock.time()
            command_ok = self._stop_batch(selected,deadline)
            states = {name:self._show(name,deadline) for name in selected}
            if active_tempo:
                graceful = self._tempo_proof(states[tempo],requested_at,deadline,command_ok=command_ok)
                self.stop_proofs.append(graceful)
            else:
                graceful = self.stop_proofs[-1] if self.stop_proofs and not getattr(self,'restart_attempted',False) else None
            owned_pids = {pid for entry in self.ownership.values() for pid in entry['pids']}
            groups = {group for entry in self.ownership.values() for group in entry['groups']}
            remaining_groups = sorted(group for group in groups if self.os.group_pids(group))
            remaining_pids = sorted(pid for pid in owned_pids if self.os.pid_alive(pid))
            remaining_listeners = [row for row in self._sockets(deadline) if row['port'] in set(EXPECTED_PORTS)|{13101,17946}
                                   or set(map(str,row.get('owners',[]))).intersection(owned_pids)]
            collectors = self._check_collectors(deadline)
            preserved = self._preserved(deadline)
            oom = self._final_oom(groups)
            stopped = all(state.get('MainPID','0')=='0' and state.get('ActiveState') in {'inactive','failed'} for state in states.values())
            emitter = self.ownership.get(self.spec.emitter_name,{'pids':set(),'groups':set()})
            launcher = getattr(self,'emitter_process',None)
            emitter_stopped = (launcher is None or launcher.poll() is not None) and not any(self.os.pid_alive(pid) for pid in emitter['pids']) and not any(self.os.group_pids(group) for group in emitter['groups'])
            passed = bool(command_ok and not rejected and stopped and not remaining_groups and not remaining_pids
                          and not remaining_listeners and collectors and preserved and oom==0 and emitter_stopped
                          and (not self.started or graceful and graceful['passed']))
            proof = {'passed':passed, 'graceful_tempo':graceful, 'owned_emitter_stopped':emitter_stopped,
                     'remaining_pids':remaining_pids, 'remaining_groups':remaining_groups,
                     'remaining_listeners':remaining_listeners, 'collectors_unchanged':collectors,
                     'original_preserved':preserved, 'oom_events':oom, 'rejected_foreign_units':rejected,
                     'oom_verification':'verified_final_counter' if oom is not None else 'unverified_final_counter_unavailable',
                     'forced_units':sorted(self.forced), 'state_retained':True, 'units':states}
            if getattr(self,'restart_attempted',False) and not active_tempo:
                proof['reason'] = 'tempo_not_active_for_fresh_final_stop'
            if self.prepared: self._save('cleanup.json',proof)
            return proof
        except (ValueError,OSError,TimeoutError,subprocess.TimeoutExpired,KeyError) as error:
            self._force_owned(list(self.ownership))
            failed['reason']=type(error).__name__
            return failed

    def readback(self, emitted, timeout, stage):
        deadline = self._deadline(timeout)
        if stage not in {'initial','durability'}: raise ValueError('invalid_diagnostic_readback_stage')
        proof = self._reader().run(emitted,'normal',
                    grafana_config_path=self.spec.config/'grafana.ini',
                    binary_prereqs_path=self.spec.evidence/'binary-prereqs.json',
                    inventory_roots=(self.old_state,self.spec.aeon_root/'artifacts/observability',self.spec.state),
                    absolute_deadline=deadline, metric_scope='first canonical synthetic batch; Alloy unchanged',
                    config_pin_path='config/grafana.ini')
        self._remaining(deadline)
        self._save('readback-'+stage+'.json',proof)
        return proof

    def quiesce(self, seconds, timeout):
        deadline = self._deadline(timeout)
        if type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=40:
            raise ValueError('invalid_diagnostic_quiescence')
        if self._remaining(deadline)<seconds: raise TimeoutError('insufficient_quiescence_budget')
        until = self.clock.monotonic()+seconds
        while self.clock.monotonic()<until:
            self.clock.sleep(min(.5,until-self.clock.monotonic(),self._remaining(deadline)))
        return {'seconds':seconds,'requests':0}

    def _selected_config(self, content):
        if not isinstance(content,str) or len(content.encode())>1024*1024:
            raise ValueError('effective_config_size_or_type')
        selected = {'shutdown_delay','backend_worker.finish_on_shutdown_timeout','server.log_level',
                    'server.http_server_graceful_shutdown_timeout','server.grpc_server_graceful_shutdown_timeout',
                    'live_store.flush_check_period','live_store.trace_idle_period','live_store.max_block_duration',
                    'live_store.flush_all_on_shutdown', 'live_store.wal.flush_on_shutdown',
                    'distributor.log_received_spans.enabled','distributor.log_received_spans.include_attributes',
                    'distributor.log_discarded_spans.enabled','distributor.log_discarded_spans.include_attributes'}
        stack = []
        result = {}
        for line in content.splitlines():
            match = re.fullmatch(r'( *)([a-z_][a-z_0-9]*):(?:\s+(.*))?',line)
            if not match: continue
            indent,key,value = match.groups(); level = len(indent)
            while stack and stack[-1][0]>=level: stack.pop()
            path = '.'.join([entry[1] for entry in stack]+[key])
            if value is None or not value.strip():
                stack.append((level,key)); continue
            if path not in selected: continue
            if path in result: raise ValueError('duplicate_selected_config_field')
            value = value.strip().strip('"\'')
            if not re.fullmatch(r'[a-zA-Z0-9_.+-]{1,80}',value): raise ValueError('selected_config_value_not_scalar')
            result[path] = {'true':True,'false':False}.get(value,value)
        if result.get('server.log_level')!='info': raise ValueError('tempo_lifecycle_info_not_effective')
        for path,value in result.items():
            if path.startswith('distributor.log_') and value is not False:
                raise ValueError('tempo_span_body_logging_enabled')
        return result

    def effective_config(self, timeout):
        deadline = self._deadline(timeout)
        name = self.spec.unit_names['tempo']
        state = self._show(name,deadline)
        self._own(name,state)
        url = 'http://127.0.0.1:13200/status/config'
        if self.http is None:
            import urllib.request
            reader = self._reader()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),reader.NoRedirect())
            content = reader.get(opener,url,deadline,text=True)
        else: content = self.http(url,deadline,text=True)
        selected = self._selected_config(content)
        self._remaining(deadline)
        lifecycle = self._logs(name,state['MainPID'],getattr(self,'first_start_epoch',self.clock.time()),deadline)
        proof = {'selected_fields':selected,'lifecycle':lifecycle,'unit':name,'pid':state['MainPID'],
                 'capture':'selected_effective_fields_and_info_lifecycle_only', 'raw_config_retained':False}
        self._save('effective-tempo-config.json',proof)
        return proof

    def restart_tempo(self, runtime_seconds, timeout):
        deadline = self._deadline(timeout)
        if not getattr(self,'first_stop',{}).get('passed') or getattr(self,'restart_attempted',False):
            raise ValueError('restart_requires_first_graceful_gate_and_one_attempt')
        name = self.spec.unit_names['tempo']
        state = self._show(name,deadline)
        self._own(name,state,active=False)
        if state.get('ActiveState')!='inactive' or state.get('MainPID')!='0' or any(self.os.group_pids(group) for group in self.ownership[name]['groups']):
            raise ValueError('tempo_restart_requires_stopped_owned_group')
        before = self._peer_snapshot(deadline)
        if before!=self.peer_baseline: raise ValueError('diagnostic_peers_changed_before_restart')
        self.restart_attempted = True
        self._render_runtime([name],runtime_seconds)
        try:
            self._command(['systemctl','--user','daemon-reload'],deadline)
            self.restarting_group = name
            self._command(['systemctl','--user','start',name],deadline)
            proof = self._ready(deadline)
            proof['peers_unchanged'] = self._peer_snapshot(deadline)==before
            if not proof['peers_unchanged']: raise ValueError('diagnostic_peers_changed_during_restart')
            proof['additional_spans_emitted'] = 0
            self._save('tempo-restart.json',proof)
            return proof
        except BaseException:
            self.restarting_group = None
            self._cleanup_partial(deadline)
            raise

    def _emitter_command(self):
        return ['systemd-run','--user','--scope','--unit='+self.spec.emitter_name,
                '--property=MemoryAccounting=true','--property=MemoryMax=256M',
                '--property=MemorySwapMax=0','--property=CPUQuota=25%', '--property=TasksMax=64',
                '--property=RuntimeMaxSec=65s','/usr/bin/env','-i','PATH=/usr/bin:/bin',
                'HOME='+str(self.spec.home),'HERMES_HOME='+str(self.spec.home),
                'HERMES_RUNTIME_DIR='+str(self.spec.home/'runtime'),
                'HERMES_OTEL_CONFIG='+str(self.spec.home/'absent.yaml'),
                'TRACELOOP_TRACE_CONTENT=false','TRACELOOP_METRICS_ENABLED=false','PYTHONDONTWRITEBYTECODE=1',
                'PYTHONPATH='+str(self.old_state/'fixture')+os.pathsep+str(self.custody['core_owner']['path'])+os.pathsep+str(self.spec.source_root),
                '/usr/bin/timeout','--kill-after=5s','60s',str(self.old_state/'python/bin/python'),'-B',
                str(self.spec.source_root/'emit_synthetic.py'),'--fallback-site',self.native['site'],
                '--output',str(self.spec.evidence/'emitted.json')]

    def _emitter_limits(self, group):
        directory = self.os.group(group)
        limits = {key:(directory/key).read_text().strip() for key in ('memory.max','memory.swap.max','pids.max','cpu.max')}
        self._check_emitter_limits(limits)
        events = self._events(group)
        if events['oom'] or events['oom_kill']: raise ValueError('emitter_oom_event')
        return limits

    @staticmethod
    def _check_emitter_limits(limits):
        quota, period = map(int,limits['cpu.max'].split())
        if int(limits['memory.max'])!=256*1024**2 or limits['memory.swap.max']!='0' or limits['pids.max']!='64' or quota/period!=.25:
            raise ValueError('effective_emitter_resources_changed')

    def emit(self, timeout):
        deadline = self._deadline(timeout)
        if not self.prepared or self.emitted or getattr(self,'emitter_attempted',False):
            raise ValueError('diagnostic_emitter_not_fresh')
        if self._remaining(deadline)<65: raise TimeoutError('emitter_requires_full_65_second_allowance')
        self.os.directory(self.spec.home,private=True)
        output = self.spec.evidence/'emitted.json'
        if output.exists() or output.is_symlink(): raise ValueError('emitted_receipt_already_owned')
        name = self.spec.emitter_name
        if self._show(name,deadline).get('LoadState')!='not-found': raise ValueError('emitter_scope_already_owned')
        self.emitter_attempted = True
        observed = False
        try:
            if self._remaining(deadline)<65: raise TimeoutError('emitter_requires_full_65_second_allowance')
            process = self.spawn(self._emitter_command(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            self.emitter_process = process
            running_deadline = min(deadline,self.clock.monotonic()+65)
            while process.poll() is None:
                self._remaining(running_deadline)
                state = self._show(name,running_deadline)
                if state.get('ActiveState')=='active':
                    self._own(name,state)
                    self._emitter_limits(state['ControlGroup'])
                    observed = True
                self.clock.sleep(min(.1,self._remaining(running_deadline)))
            if process.poll()!=0: raise RuntimeError('synthetic_emitter_failed')
            if not observed: raise ValueError('emitter_positive_ownership_not_observed')
            self._remaining(deadline)
            if output.is_symlink() or output.stat().st_uid!=self.os.uid or stat.S_IMODE(output.stat().st_mode)!=0o600 or output.stat().st_size>4*1024*1024:
                raise ValueError('emitted_receipt_not_private_owned_bounded')
            receipt = self._json(output)
            expected = {'synthetic_only':True,'outage_expected':False,'dry_run':False,'export_verdict':'SUCCESS',
                        'span_count':25,'canonical_api_count':5,'sensitive_sentinel_absent':True,
                        'utility_qualified':False,'release_evaluated':False}
            if any(type(receipt.get(key)) is not type(value) or receipt[key]!=value for key,value in expected.items()):
                raise ValueError('emitted_batch_receipt_mismatch')
            spans = receipt.get('expected_spans')
            self._reader().validate_expected(spans)
            if len(spans)!=25 or len({span['trace_id'] for span in spans})!=6:
                raise ValueError('emitted_span_denominators_mismatch')
            resources = receipt['effective_emitter_resources']
            entry = self.ownership[name]
            if {Path(resources['group']).resolve()}!={self.os.group(group).resolve() for group in entry['groups']}:
                raise ValueError('emitter_receipt_control_group_mismatch')
            self._check_emitter_limits(resources['limits'])
            events = {key:int(value) for key,value in resources['memory_events'].items()}
            if events.get('oom',-1)!=0 or events.get('oom_kill',-1)!=0: raise ValueError('emitter_receipt_oom_events')
            for group in entry['groups']:
                self.memory_events[group] = events
                if self.os.group_pids(group): raise ValueError('emitter_control_group_survived')
            if any(self.os.pid_alive(pid) for pid in entry['pids']): raise ValueError('emitter_process_survived')
            approved = getattr(self,'approved_emitter_origins',None)
            if not isinstance(approved,dict) or set(approved)!=set(EMITTER_IMPORT_MODULES) or receipt.get('imported_origins')!=approved:
                raise ValueError('emitter_import_origin_mismatch')
            self._verify_file_pins(list(approved.values()),deadline)
            self._check_collectors(deadline)
            self.emitted = True
            self._save('emitter-scope.json',{'unit':name,'control_groups':sorted(entry['groups']),
                       'owned_pids':sorted(entry['pids']),'empty_groups':True,'dead_pids':True,
                       'limits':resources['limits'],'memory_events':events})
            return receipt
        except BaseException:
            self._cleanup_partial(deadline)
            raise
