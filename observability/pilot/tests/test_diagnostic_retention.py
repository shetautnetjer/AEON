"""Retention tests stay offline: temporary files and an injected sd-bus adapter."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import shutil
import errno
import hashlib
import math
import ctypes
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'diagnostic_retention.py'


def load():
    if not MODULE.exists():
        return None
    spec = importlib.util.spec_from_file_location('diagnostic_retention', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Clock:
    now = 0.0
    def monotonic(self): return self.now


class Bus:
    """A process-external boundary: model per-connection unit reference counts."""
    def __init__(self):
        self.connections = []
        self.references = {}
        self.calls = []
        self.owner = ':1.7'
        self.timeout = None
    def open_user(self, *, deadline):
        connection = object()
        self.connections.append(connection)
        self.references[connection] = set()
        return connection
    def set_method_timeout(self, connection, microseconds):
        self.timeout = (connection, microseconds)
    def session_identity(self, connection): return ':1.9'
    def healthy(self, connection): return connection in self.references
    def manager_owner(self, connection):
        self.calls.append(('owner', connection, self.timeout))
        return self.owner
    def call_method(self, connection, method, name):
        self.calls.append((method, connection, name, self.timeout))
        if method == 'RefUnit': self.references[connection].add(name)
        elif method == 'UnrefUnit': self.references[connection].remove(name)
        else: raise AssertionError('unexpected manager method')
    def close(self, connection): self.references.pop(connection, None)


class UnitReferencesTests(unittest.TestCase):
    def keeper(self, bus=None, clock=None):
        return load().UnitReferences(('aeon-tempo-check-tempo-Test1.service',),
                                     adapter=bus or Bus(), clock=clock or Clock())

    def test_reference_survives_until_bounded_release_on_original_connection(self):
        module = load()
        self.assertIsNotNone(module, 'retention helper is missing')
        bus, clock = Bus(), Clock()
        name = 'aeon-tempo-check-tempo-Test1.service'
        keeper = module.UnitReferences((name,), adapter=bus, clock=clock)
        self.assertEqual(bus.connections, [])
        keeper.acquire(name, deadline=10)
        connection = bus.connections[0]
        self.assertEqual(bus.references[connection], {name})
        clock.now = 7
        self.assertTrue(keeper.close(deadline=10))
        self.assertNotIn(connection, bus.references)
        manager_calls = [row for row in bus.calls if row[0] != 'owner']
        self.assertEqual([row[0] for row in manager_calls], ['RefUnit', 'UnrefUnit'])
        self.assertTrue(all(row[1] is connection for row in manager_calls))
        self.assertEqual([row[3][1] for row in manager_calls], [10000000, 3000000])

    def test_expired_or_nonfinite_deadline_never_opens_connection(self):
        for deadline in (0, -1, math.inf, math.nan):
            with self.subTest(deadline=deadline):
                bus = Bus()
                with self.assertRaises((ValueError, TimeoutError)):
                    self.keeper(bus).acquire('aeon-tempo-check-tempo-Test1.service', deadline=deadline)
                self.assertEqual(bus.connections, [])

    def test_allowlist_rejects_foreign_name_without_opening_connection(self):
        bus = Bus()
        with self.assertRaises(ValueError): self.keeper(bus).acquire('foreign.service', deadline=10)
        self.assertEqual(bus.connections, [])

    def test_expired_release_closes_without_resetting_runtime_deadline(self):
        bus, clock = Bus(), Clock()
        keeper = self.keeper(bus, clock)
        keeper.acquire('aeon-tempo-check-tempo-Test1.service', deadline=10)
        clock.now = 10
        self.assertFalse(keeper.close(deadline=10))
        self.assertEqual(bus.references, {})
        self.assertFalse(any(row[0] == 'UnrefUnit' for row in bus.calls))

    def test_manager_replacement_fails_closed_without_unref_to_new_manager(self):
        bus = Bus()
        keeper = self.keeper(bus)
        keeper.acquire('aeon-tempo-check-tempo-Test1.service', deadline=10)
        bus.owner = ':1.8'
        with self.assertRaises(ValueError): keeper.check(deadline=10)
        self.assertEqual(bus.references, {})
        self.assertFalse(any(row[0] == 'UnrefUnit' for row in bus.calls))

    def test_session_replacement_never_reconnects_or_references_new_session(self):
        bus = Bus()
        keeper = self.keeper(bus)
        keeper.acquire('aeon-tempo-check-tempo-Test1.service', deadline=10)
        bus.session_identity = lambda connection: ':1.10'
        with self.assertRaises(ValueError): keeper.check(deadline=10)
        self.assertEqual(bus.references, {})
        with self.assertRaises(ValueError): keeper.acquire('aeon-tempo-check-tempo-Test1.service', deadline=10)
        self.assertEqual(len(bus.connections), 1)

    def test_call_expiration_closes_existing_connection_and_does_not_extend_budget(self):
        bus, clock = Bus(), Clock()
        keeper = self.keeper(bus, clock)
        original = bus.manager_owner
        def slow_owner(connection):
            result = original(connection)
            clock.now = 10
            return result
        bus.manager_owner = slow_owner
        with self.assertRaises(TimeoutError): keeper.acquire('aeon-tempo-check-tempo-Test1.service', deadline=10)
        self.assertEqual(bus.references, {})
        self.assertFalse(any(row[0] == 'RefUnit' for row in bus.calls))


class Function:
    def __init__(self, action): self.action = action
    def __call__(self, *args): return self.action(*args)


class Library:
    def __init__(self, clock, *, ready=True):
        self.clock, self.ready = clock, ready
        self.closed = False
        self.freed_errors = self.freed_replies = 0
        self.timeouts = []
        self.methods = []
        def opening(ret):
            ctypes.cast(ret, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.c_void_p(42)
            return 0
        def waiting(bus, usec):
            clock.now += usec / 1000000
            return 0
        def call(bus, destination, path, interface, member, error, reply, signature, value):
            self.methods.append((destination, path, interface, member, signature, value.value))
            ctypes.cast(reply, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.c_void_p(43)
            return 0
        def reading(reply, signature, ret):
            ctypes.cast(ret, ctypes.POINTER(ctypes.c_char_p))[0] = b':1.7'
            return 1
        def closing(bus): self.closed = True
        def error_free(error): self.freed_errors += 1
        def reply_free(reply): self.freed_replies += 1
        def unique(bus, ret):
            ctypes.cast(ret, ctypes.POINTER(ctypes.c_char_p))[0] = b':1.9'
            return 0
        self.sd_bus_open_user = Function(opening)
        self.sd_bus_is_open = Function(lambda bus: 1)
        self.sd_bus_is_ready = Function(lambda bus: int(self.ready))
        self.sd_bus_process = Function(lambda bus, reply: 0)
        self.sd_bus_wait = Function(waiting)
        self.sd_bus_close_unref = Function(closing)
        self.sd_bus_set_method_call_timeout = Function(lambda bus, usec: self.timeouts.append(usec) or 0)
        self.sd_bus_get_unique_name = Function(unique)
        self.sd_bus_call_method = Function(call)
        self.sd_bus_message_read = Function(reading)
        self.sd_bus_error_free = Function(error_free)
        self.sd_bus_message_unref = Function(reply_free)


class SystemdABITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-systemd-abi-')
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'libsystemd.so'
        self.path.write_bytes(b'controlled ABI test library placeholder')
        self.sha = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.clock = Clock()

    def adapter(self, library):
        module = load()
        self.assertTrue(hasattr(module, '_SystemdBus'), 'pinned ctypes adapter is missing')
        with patch.object(module.ctypes, 'CDLL', return_value=library):
            return module._SystemdBus(self.path, self.sha, clock=self.clock)

    def test_pinned_library_calls_exact_methods_and_frees_replies_without_ipc(self):
        library = Library(self.clock)
        adapter = self.adapter(library)
        with patch.dict(os.environ, {'XDG_RUNTIME_DIR': f'/run/user/{os.geteuid()}',
                                     'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{os.geteuid()}/bus'}):
            bus = adapter.open_user(deadline=10)
        adapter.set_method_timeout(bus, 3000000)
        self.assertEqual(adapter.manager_owner(bus), ':1.7')
        adapter.call_method(bus, 'RefUnit', 'aeon-tempo-check-tempo-Test1.service')
        adapter.call_method(bus, 'UnrefUnit', 'aeon-tempo-check-tempo-Test1.service')
        self.assertEqual(library.methods[1], (b':1.7', b'/org/freedesktop/systemd1',
                                            b'org.freedesktop.systemd1.Manager', b'RefUnit', b's',
                                            b'aeon-tempo-check-tempo-Test1.service'))
        self.assertEqual((library.freed_errors, library.freed_replies), (3, 3))
        adapter.close(bus)
        self.assertTrue(library.closed)

    def test_handshake_expires_before_any_manager_call_and_closes_locally(self):
        library = Library(self.clock, ready=False)
        adapter = self.adapter(library)
        with patch.dict(os.environ, {'XDG_RUNTIME_DIR': f'/run/user/{os.geteuid()}',
                                     'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{os.geteuid()}/bus'}):
            with self.assertRaises(TimeoutError): adapter.open_user(deadline=1)
        self.assertEqual(self.clock.now, 1)
        self.assertEqual(library.methods, [])
        self.assertTrue(library.closed)

    def test_hash_mismatch_and_symlink_rejected_before_library_loading(self):
        module = load()
        link = self.path.with_name('symlink.so')
        link.symlink_to(self.path)
        with patch.object(module.ctypes, 'CDLL', side_effect=AssertionError('load before pin validation')):
            with self.assertRaises(ValueError): module._SystemdBus(self.path, '0' * 64)
            with self.assertRaises(ValueError): module._SystemdBus(link, self.sha)

    def test_library_path_replacement_during_load_cannot_substitute_unpinned_bytes(self):
        module = load()
        library = Library(self.clock)
        loaded = []
        def loading(path):
            self.path.rename(self.path.with_suffix('.old'))
            self.path.write_bytes(b'unpinned replacement')
            loaded.append(Path(path).read_bytes())
            return library
        with patch.object(module.ctypes, 'CDLL', side_effect=loading):
            module._SystemdBus(self.path, self.sha)
        self.assertEqual(loaded, [b'controlled ABI test library placeholder'])

    def test_second_library_pin_in_same_process_is_rejected(self):
        module = load()
        other = self.path.with_name('another-library.so')
        other.write_bytes(b'another library pin')
        with patch.object(module.ctypes, 'CDLL', return_value=Library(self.clock)):
            module._SystemdBus(self.path, self.sha)
            with self.assertRaises(ValueError):
                module._SystemdBus(other, hashlib.sha256(other.read_bytes()).hexdigest())

    def test_cached_library_inode_cannot_be_replaced_or_relabelled(self):
        module = load()
        library = Library(self.clock)
        with patch.object(module.ctypes, 'CDLL', return_value=library):
            module._SystemdBus(self.path, self.sha)
            old = self.path.with_suffix('.old')
            self.path.rename(old)
            self.path.write_bytes(b'controlled ABI test library placeholder')
            old.write_bytes(b'changed retained inode')
            with self.assertRaises(ValueError): module._SystemdBus(self.path, self.sha)

    def test_remote_or_extended_bus_address_rejected_without_opening(self):
        library = Library(self.clock)
        library.sd_bus_open_user = Function(lambda ret: self.fail('bus opened with unvalidated address'))
        adapter = self.adapter(library)
        for address in ('tcp:host=example.test,port=1', f'unix:path=/run/user/{os.geteuid()}/bus,uid=0'):
            with self.subTest(address=address), patch.dict(os.environ, {'DBUS_SESSION_BUS_ADDRESS': address}):
                with self.assertRaises(ValueError): adapter.open_user(deadline=10)

    def test_host_library_exports_abi_symbols_without_opening_bus(self):
        path = Path('/usr/lib/x86_64-linux-gnu/libsystemd.so.0.42.0')
        if not path.is_file(): self.skipTest('pinned host library unavailable')
        adapter = load()._SystemdBus(path, hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertTrue(callable(adapter.lib.sd_bus_open_user))

class HierarchicalOOMTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-retained-oom-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.uid = os.geteuid()
        self.group = f'/user.slice/user-{self.uid}.slice/user@{self.uid}.service/app.slice/app-aeonTempoCheckTest1.slice'
        self.directory = self.root / self.group.lstrip('/')
        self.directory.mkdir(parents=True)
        self.names = ('aeon-tempo-check-tempo-Test1.service', 'aeon-tempo-check-alloy-Test1.service',
                      'aeon-tempo-check-prometheus-Test1.service', 'aeon-tempo-check-grafana-Test1.service',
                      'aeon-tempo-check-emitter-Test1.scope')
        self.roots = tuple(self.group + '/' + name for name in self.names)
        device = self.root.stat().st_dev
        self.mountinfo = f'123 22 {os.major(device)}:{os.minor(device)} / {self.root} rw - cgroup2 cgroup rw,nsdelegate\n'
        self.events(0, 0)
        (self.directory / 'cgroup.procs').write_text('')

    def events(self, oom, killed):
        (self.directory / 'memory.events').write_text(f'low 0\nhigh 0\nmax 0\noom {oom}\noom_kill {killed}\noom_group_kill 0\n')

    def keeper(self, **kwargs):
        module = load()
        self.assertTrue(hasattr(module, 'HierarchicalOOM'), 'hierarchical OOM helper is missing')
        keeper = module.HierarchicalOOM(cgroup_root=self.root, group=self.group, uid=self.uid,
                                       mountinfo=self.mountinfo, expected_descendant_roots=self.roots,
                                       **kwargs)
        self.addCleanup(keeper.close)
        return keeper

    def test_surviving_isolated_ancestor_proves_zero_after_children_disappear(self):
        keeper = self.keeper()
        self.assertTrue(keeper.baseline_snapshot()['verified'])
        child = self.directory / self.names[0]
        child.mkdir()
        (child / 'memory.events').write_text('oom 0\noom_kill 0\n')
        shutil.rmtree(child)
        proof = keeper.finish(descendant_groups=self.roots)
        self.assertTrue(proof['verified'])
        self.assertEqual(proof['delta'], {'oom': 0, 'oom_kill': 0})
        self.assertEqual(proof['oom_events'], 0)

    def test_counter_decrease_after_observed_oom_cannot_become_zero(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        self.events(2, 1)
        self.assertEqual(keeper.finish(descendant_groups=self.roots)['oom_events'], 3)
        self.events(0, 0)
        proof = keeper.finish(descendant_groups=self.roots)
        self.assertFalse(proof['verified'])
        self.assertIsNone(proof['oom_events'])

    def test_missing_terminal_file_cannot_be_repaired_into_a_zero_proof(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        (self.directory / 'memory.events').unlink()
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_renamed_and_replaced_ancestor_cannot_supply_fresh_zero(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        self.directory.rename(self.directory.with_name(self.directory.name + '.old'))
        self.directory.mkdir()
        self.events(0, 0)
        (self.directory / 'cgroup.procs').write_text('')
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_deleted_directory_is_unverified_even_while_fd_is_held(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        shutil.rmtree(self.directory)
        self.assertIsNotNone(keeper.fd)
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_kernfs_enodev_is_unverified(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        module_os = load().os
        original = module_os.open
        def opening(path, *args, **kwargs):
            if path == 'memory.events': raise OSError(errno.ENODEV, 'fixture pruned kernfs')
            return original(path, *args, **kwargs)
        with patch.object(module_os, 'open', side_effect=opening):
            self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_positive_oom_and_oom_kill_remain_distinct_after_child_deletion(self):
        for oom, killed, want in ((2, 0, 2), (0, 1, 1)):
            with self.subTest(oom=oom, killed=killed):
                self.events(0, 0)
                keeper = self.keeper()
                keeper.baseline_snapshot()
                child = self.directory / self.names[0]
                child.mkdir()
                # Linux eagerly propagates each event to non-root ancestors.
                (child / 'memory.events').write_text(f'oom {oom}\noom_kill {killed}\n')
                self.events(oom, killed)
                shutil.rmtree(child)
                proof = keeper.finish(descendant_groups=self.roots)
                self.assertTrue(proof['verified'])
                self.assertEqual(proof['delta'], {'oom': oom, 'oom_kill': killed})
                self.assertEqual(proof['oom_events'], want)
                self.assertNotIn('child', proof)

    def test_incomplete_or_escaping_declared_membership_is_unverified(self):
        for groups in (self.roots[:-1], (*self.roots, '/foreign.service')):
            with self.subTest(groups=groups):
                keeper = self.keeper()
                keeper.baseline_snapshot()
                self.assertIsNone(keeper.finish(descendant_groups=groups)['oom_events'])

    def test_undeclared_actual_descendant_is_unverified(self):
        keeper = self.keeper()
        keeper.baseline_snapshot()
        (self.directory / 'foreign.service').mkdir()
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_baseline_nonzero_or_local_events_mode_never_proves_zero(self):
        self.events(1, 0)
        keeper = self.keeper()
        self.assertFalse(keeper.baseline_snapshot()['verified'])
        self.events(0, 0)
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])
        self.mountinfo = self.mountinfo.replace('rw,nsdelegate', 'rw,memory_localevents')
        other = self.keeper()
        self.assertIsNone(other.baseline_snapshot()['oom_events'])

    def test_nested_same_device_bind_mount_cannot_alias_foreign_accounting(self):
        device = self.root.stat().st_dev
        for mountpoint in (self.directory, self.directory / self.names[0]):
            with self.subTest(mountpoint=mountpoint):
                original = self.mountinfo
                self.mountinfo += f'124 123 {os.major(device)}:{os.minor(device)} /foreign {mountpoint} rw - cgroup2 cgroup rw\n'
                keeper = self.keeper()
                self.assertIsNone(keeper.baseline_snapshot()['oom_events'])
                self.mountinfo = original

    def test_missing_or_malformed_counter_never_proves_zero(self):
        for content in ('oom 0\n', 'oom -1\noom_kill 0\n', 'oom 0\noom 0\noom_kill 0\n'):
            with self.subTest(content=content):
                self.events(0, 0)
                keeper = self.keeper()
                keeper.baseline_snapshot()
                (self.directory / 'memory.events').write_text(content)
                self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])

    def test_shared_app_slice_is_rejected(self):
        with self.assertRaises(ValueError):
            load().HierarchicalOOM(cgroup_root=self.root, group=self.group.rsplit('/', 1)[0],
                                   uid=self.uid, mountinfo=self.mountinfo, expected_descendant_roots=self.roots)

    def test_expired_snapshot_does_no_counter_reads(self):
        keeper = self.keeper()
        with patch.object(load().os, 'read', side_effect=AssertionError('counter read with expired budget')):
            self.assertIsNone(keeper.baseline_snapshot(deadline=0)['oom_events'])
        self.events(0, 0)
        self.assertIsNone(keeper.finish(descendant_groups=self.roots)['oom_events'])


if __name__ == '__main__':
    unittest.main()
