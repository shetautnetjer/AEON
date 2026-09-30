"""Small retention keepers; unit references retain metadata, never cgroups."""
import math
import ctypes
import hashlib
import os
from pathlib import Path
import re
import stat
import time


class _BusError(ctypes.Structure):
    _fields_ = [('name', ctypes.c_char_p), ('message', ctypes.c_char_p), ('_need_free', ctypes.c_int)]


class _SystemdBus:
    """Pinned host libsystemd ABI; construction does no bus IPC.

    Signatures and nonblocking startup follow systemd v259.5 sd-bus.h,
    sd-bus-protocol.h, sd-bus.c, bus-socket.c, and bus-convenience.c.
    Exactly one library/FD is retained until process exit: dlopen caches pathname
    aliases, so its descriptor name must never be reused for a different pin.
    The bound host library must remain stable during its initial native load.
    """
    _loaded = None

    def __init__(self, path, sha256, *, clock=time):
        if path is None or not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256):
            raise ValueError('systemd_library_pin_required')
        path = Path(path)
        if not path.is_absolute() or path.resolve(strict=True) != path:
            raise ValueError('systemd_library_actual_path_required')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        retained = False
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode): raise ValueError('systemd_library_not_regular')
            digest = self._digest(fd)
            after = os.fstat(fd)
            fingerprint = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            if digest != sha256 or fingerprint(before) != fingerprint(after) or fingerprint(after) != fingerprint(path.lstat()):
                raise ValueError('systemd_library_pin_mismatch')
            loaded = type(self)._loaded
            if loaded is not None:
                pin, info, library, original = loaded
                if pin != (str(path), sha256): raise ValueError('systemd_library_pin_changed_in_process')
                if fingerprint(after) != info or fingerprint(os.fstat(original)) != info or self._digest(original) != sha256 or fingerprint(os.fstat(original)) != info:
                    raise ValueError('systemd_loaded_library_identity_changed')
                self.lib = library
            else:
                # Load the verified inode even if its directory entry is replaced.
                self.lib = ctypes.CDLL(f'/proc/self/fd/{fd}')
                type(self)._loaded = ((str(path), sha256), fingerprint(after), self.lib, fd)
                retained = True
        finally:
            if not retained: os.close(fd)
        self.clock = clock
        self.manager = None
        pointer = ctypes.c_void_p
        signatures = {
            'sd_bus_open_user': ([ctypes.POINTER(pointer)], ctypes.c_int),
            'sd_bus_is_open': ([pointer], ctypes.c_int),
            'sd_bus_is_ready': ([pointer], ctypes.c_int),
            'sd_bus_process': ([pointer, ctypes.POINTER(pointer)], ctypes.c_int),
            'sd_bus_wait': ([pointer, ctypes.c_uint64], ctypes.c_int),
            'sd_bus_close_unref': ([pointer], pointer),
            'sd_bus_set_method_call_timeout': ([pointer, ctypes.c_uint64], ctypes.c_int),
            'sd_bus_get_unique_name': ([pointer, ctypes.POINTER(ctypes.c_char_p)], ctypes.c_int),
            'sd_bus_call_method': ([pointer, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p,
                                   ctypes.c_char_p, ctypes.POINTER(_BusError), ctypes.POINTER(pointer),
                                   ctypes.c_char_p], ctypes.c_int),
            'sd_bus_message_read': ([pointer, ctypes.c_char_p], ctypes.c_int),
            'sd_bus_message_unref': ([pointer], pointer),
            'sd_bus_error_free': ([ctypes.POINTER(_BusError)], None),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.lib, name)
            function.argtypes, function.restype = arguments, result

    @staticmethod
    def _digest(fd):
        os.lseek(fd, 0, os.SEEK_SET)
        digest = hashlib.sha256()
        while chunk := os.read(fd, 1024 * 1024): digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _checked(result):
        if result < 0: raise OSError(-result, 'systemd_bus_operation_failed')
        return result

    def _remaining(self, deadline):
        if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
            raise ValueError('invalid_phase_deadline')
        remaining = deadline - self.clock.monotonic()
        if not math.isfinite(remaining) or remaining <= 0:
            raise TimeoutError('diagnostic_phase_deadline')
        microseconds = min(int(remaining * 1000000), 2**64 - 2)
        if microseconds <= 0: raise TimeoutError('diagnostic_phase_deadline')
        return microseconds

    def open_user(self, *, deadline):
        self._remaining(deadline)
        runtime = f'/run/user/{os.geteuid()}'
        address = os.environ.get('DBUS_SESSION_BUS_ADDRESS')
        directory = os.environ.get('XDG_RUNTIME_DIR')
        if address is not None and address != f'unix:path={runtime}/bus':
            raise ValueError('user_bus_address_not_exact_local_unix')
        if (address is None and directory != runtime) or (directory is not None and directory != runtime):
            raise ValueError('user_bus_runtime_directory_not_exact')
        bus = ctypes.c_void_p()
        try:
            self._checked(self.lib.sd_bus_open_user(ctypes.byref(bus)))
            while True:
                self._remaining(deadline)
                if self._checked(self.lib.sd_bus_is_ready(bus)) > 0: return bus
                processed = self._checked(self.lib.sd_bus_process(bus, None))
                if processed == 0:
                    self._checked(self.lib.sd_bus_wait(bus, self._remaining(deadline)))
        except Exception:
            if bus.value: self.close(bus)
            raise

    def healthy(self, bus):
        return self.lib.sd_bus_is_open(bus) > 0 and self.lib.sd_bus_is_ready(bus) > 0

    def session_identity(self, bus):
        if not self.healthy(bus): raise ValueError('unit_reference_connection_unavailable')
        value = ctypes.c_char_p()
        self._checked(self.lib.sd_bus_get_unique_name(bus, ctypes.byref(value)))
        return value.value.decode('ascii') if value.value else None

    def set_method_timeout(self, bus, microseconds):
        if not isinstance(microseconds, int) or not 0 < microseconds < 2**64 - 1:
            raise ValueError('invalid_bus_method_timeout')
        self._checked(self.lib.sd_bus_set_method_call_timeout(bus, microseconds))

    def _call(self, bus, destination, path, interface, member, value, *, read_string=False):
        if not self.healthy(bus): raise ValueError('unit_reference_connection_unavailable')
        error, reply = _BusError(), ctypes.c_void_p()
        try:
            self._checked(self.lib.sd_bus_call_method(bus, destination, path, interface, member,
                ctypes.byref(error), ctypes.byref(reply), b's', ctypes.c_char_p(value.encode('ascii'))))
            if read_string:
                result = ctypes.c_char_p()
                if self._checked(self.lib.sd_bus_message_read(reply, b's', ctypes.byref(result))) != 1 or not result.value:
                    raise ValueError('systemd_manager_owner_unavailable')
                return result.value.decode('ascii')
        finally:
            if reply.value: self.lib.sd_bus_message_unref(reply)
            self.lib.sd_bus_error_free(ctypes.byref(error))

    def manager_owner(self, bus):
        value = self._call(bus, b'org.freedesktop.DBus', b'/org/freedesktop/DBus',
                          b'org.freedesktop.DBus', b'GetNameOwner', 'org.freedesktop.systemd1', read_string=True)
        if not re.fullmatch(r':[0-9]+\.[0-9]+', value): raise ValueError('invalid_systemd_manager_owner')
        if self.manager is None: self.manager = value
        return value

    def call_method(self, bus, method, name):
        if method not in {'RefUnit', 'UnrefUnit'}: raise ValueError('invalid_unit_reference_method')
        if self.manager is None: raise ValueError('systemd_manager_owner_not_pinned')
        self._call(bus, self.manager.encode('ascii'), b'/org/freedesktop/systemd1',
                   b'org.freedesktop.systemd1.Manager', method.encode('ascii'), name)

    def close(self, bus):
        self.lib.sd_bus_close_unref(bus)


class UnitReferences:
    def __init__(self, owned_units, *, library_path=None, library_sha256=None,
                 clock=time, adapter=None):
        self.owned_units = frozenset(owned_units)
        if not self.owned_units or any(not isinstance(name, str) or not re.fullmatch(
                r'(?:aeon-tempo-check-[A-Za-z0-9_-]+\.(?:service|scope)|'
                r'app-aeonTempoCheck[A-Za-z0-9]+\.slice)', name) for name in self.owned_units):
            raise ValueError('invalid_owned_unit_names')
        self.clock = clock
        self.adapter = adapter
        self.library_path, self.library_sha256 = library_path, library_sha256
        self.bus = None
        self.session = self.owner = None
        self.held = set()
        self.closed = False

    def _remaining(self, deadline):
        if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
            raise ValueError('invalid_phase_deadline')
        remaining = deadline - self.clock.monotonic()
        if not math.isfinite(remaining) or remaining <= 0:
            raise TimeoutError('diagnostic_phase_deadline')
        return remaining

    def _bounded(self, deadline, operation, *args):
        microseconds = min(int(self._remaining(deadline) * 1000000), 2**64 - 2)
        if microseconds <= 0: raise TimeoutError('diagnostic_phase_deadline')
        self.adapter.set_method_timeout(self.bus, microseconds)
        return operation(self.bus, *args)

    def check(self, *, deadline):
        try:
            self._remaining(deadline)
            if self.closed or self.bus is None or not self.adapter.healthy(self.bus):
                raise ValueError('unit_reference_connection_unavailable')
            if self.adapter.session_identity(self.bus) != self.session:
                raise ValueError('unit_reference_session_changed')
            if self._bounded(deadline, self.adapter.manager_owner) != self.owner:
                raise ValueError('unit_reference_manager_changed')
            return True
        except Exception:
            if self.bus is not None: self.adapter.close(self.bus)
            self.bus = None
            self.held.clear()
            self.closed = True
            raise

    def acquire(self, name, *, deadline):
        if name not in self.owned_units: raise ValueError('unit_not_in_owned_allowlist')
        self._remaining(deadline)
        if self.closed: raise ValueError('unit_references_closed')
        try:
            if self.bus is None:
                if self.adapter is None:
                    self.adapter = _SystemdBus(self.library_path, self.library_sha256, clock=self.clock)
                self._remaining(deadline)
                self.bus = self.adapter.open_user(deadline=deadline)
                self.session = self.adapter.session_identity(self.bus)
                if not self.session or not self.adapter.healthy(self.bus):
                    raise ValueError('unit_reference_connection_unavailable')
                self.owner = self._bounded(deadline, self.adapter.manager_owner)
            self.check(deadline=deadline)
            if name not in self.held:
                self._bounded(deadline, self.adapter.call_method, 'RefUnit', name)
                self.held.add(name)
            self.check(deadline=deadline)
            return True
        except Exception:
            self.close(deadline=deadline)
            raise

    def close(self, *, deadline):
        if self.closed: return True
        released = True
        try:
            if self.bus is not None:
                self.check(deadline=deadline)
                for name in sorted(self.held):
                    self._bounded(deadline, self.adapter.call_method, 'UnrefUnit', name)
        except Exception:
            released = False
        finally:
            if self.bus is not None: self.adapter.close(self.bus)
            self.bus = None
            self.held.clear()
            self.closed = True
        return released

    release = close


class HierarchicalOOM:
    """An FD pins identity, not readable lifetime: pruned kernfs is unverified.

    The caller routes every pilot child through this dedicated, surviving,
    process-free slice. Kernel memory.events propagates eagerly to this ancestor
    unless memory_localevents is enabled. Aggregate positives identify no child.
    """
    def __init__(self, *, cgroup_root, group, uid, mountinfo,
                 expected_descendant_roots, clock=time):
        prefix = f'/user.slice/user-{uid}.slice/user@{uid}.service/app.slice/'
        if not isinstance(group, str) or not group.startswith(prefix) or not re.fullmatch(
                r'app-aeonTempoCheck[A-Za-z0-9]+\.slice', group[len(prefix):]):
            raise ValueError('not_dedicated_user_accounting_slice')
        self.root, self.group, self.uid = Path(cgroup_root), group, uid
        self.path = self.root / group.lstrip('/')
        self.mountinfo, self.clock = mountinfo, clock
        self.expected = frozenset(expected_descendant_roots)
        if not self.expected or any(not isinstance(value, str) or not value.startswith(group + '/')
                or '/' in value[len(group) + 1:] or not re.fullmatch(
                    r'aeon-tempo-check-[A-Za-z0-9_-]+\.(?:service|scope)', value[len(group) + 1:])
                for value in self.expected):
            raise ValueError('invalid_accounting_descendant_roots')
        self.fd = self._open_directory(self.path)
        info = os.fstat(self.fd)
        self.identity = (info.st_dev, info.st_ino)
        self.baseline = None
        self.last = None
        self.baseline_attempted = False
        self.invalid = None

    def _budget(self, deadline):
        if deadline is None: return
        if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
            raise ValueError('invalid_phase_deadline')
        remaining = deadline - self.clock.monotonic()
        if not math.isfinite(remaining) or remaining <= 0:
            raise TimeoutError('diagnostic_phase_deadline')

    def _open_directory(self, path, deadline=None):
        if not path.is_absolute() or '..' in path.parts:
            raise ValueError('unsafe_cgroup_path')
        self._budget(deadline)
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in path.parts[1:]:
                self._budget(deadline)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            return fd
        except Exception:
            os.close(fd)
            raise

    def _mount(self, deadline):
        self._budget(deadline)
        content = self.mountinfo.read_text() if isinstance(self.mountinfo, Path) else self.mountinfo
        if not isinstance(content, str): raise ValueError('invalid_cgroup_mountinfo')
        mounts = []
        for line in content.splitlines():
            left, separator, right = line.partition(' - ')
            before, after = left.split(), right.split()
            if not separator or len(before) < 6 or len(after) < 3: continue
            mount = Path(re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), before[4]))
            if self.path in mount.parents:
                raise ValueError('accounting_nested_mount_unsupported')
            if mount == self.path or mount in self.path.parents:
                mounts.append((len(mount.parts), mount, before, after))
        if not mounts: raise ValueError('cgroup2_mount_unverified')
        _, mount, before, after = max(mounts, key=lambda item: item[0])
        device = self.identity[0]
        if mount != self.root or before[3] != '/' or after[0] != 'cgroup2' or before[2] != f'{os.major(device)}:{os.minor(device)}':
            raise ValueError('cgroup2_mount_unverified')
        options = ','.join((*before[5:], after[2])).split(',')
        if 'memory_localevents' in options: raise ValueError('cgroup_memory_localevents_unsupported')

    def _identity(self, deadline):
        self._budget(deadline)
        if self.fd is None: raise ValueError('accounting_ancestor_closed')
        info = os.fstat(self.fd)
        current = self._open_directory(self.path, deadline)
        try:
            other = os.fstat(current)
            if info.st_uid != self.uid or other.st_uid != self.uid:
                raise ValueError('accounting_ancestor_owner_changed')
            if (info.st_dev, info.st_ino) != self.identity or (other.st_dev, other.st_ino) != self.identity:
                raise ValueError('accounting_ancestor_replaced')
        finally: os.close(current)

    def _read(self, fd, name, deadline):
        self._budget(deadline)
        target = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            self._budget(deadline)
            data = os.read(target, 4097)
            if len(data) > 4096: raise ValueError('accounting_counter_oversized')
            return data.decode('ascii')
        finally: os.close(target)

    def _membership(self, deadline, fd=None, group=None):
        fd = self.fd if fd is None else fd
        group = self.group if group is None else group
        if group == self.group and self._read(fd, 'cgroup.procs', deadline).strip():
            raise ValueError('accounting_ancestor_has_direct_processes')
        self._budget(deadline)
        with os.scandir(fd) as entries:
            for entry in entries:
                self._budget(deadline)
                if entry.is_symlink(): raise ValueError('accounting_descendant_symlink')
                if not entry.is_dir(follow_symlinks=False): continue
                child_group = group + '/' + entry.name
                if not any(child_group == root or child_group.startswith(root + '/') for root in self.expected):
                    raise ValueError('accounting_descendant_not_declared')
                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    info = os.fstat(child)
                    if info.st_uid != self.uid or info.st_dev != self.identity[0]:
                        raise ValueError('accounting_descendant_identity_unverified')
                    self._membership(deadline, child, child_group)
                finally: os.close(child)

    def _snapshot(self, deadline):
        self._mount(deadline)
        self._identity(deadline)
        self._membership(deadline)
        counters = {}
        for line in self._read(self.fd, 'memory.events', deadline).splitlines():
            fields = line.split()
            if len(fields) != 2 or not fields[1].isascii() or not fields[1].isdigit() or fields[0] in counters:
                raise ValueError('invalid_accounting_memory_events')
            counters[fields[0]] = int(fields[1])
        if not {'oom', 'oom_kill'} <= counters.keys():
            raise ValueError('accounting_oom_counters_missing')
        self._identity(deadline)
        return {key: counters[key] for key in ('oom', 'oom_kill')}

    def _proof(self, *, end=None, reason=None):
        delta = None if self.baseline is None or end is None or reason else {
            key: end[key] - self.baseline[key] for key in ('oom', 'oom_kill')}
        return {'verified': reason is None, 'reason': reason or 'verified_isolated_ancestor',
                'group': self.group, 'baseline': dict(self.baseline) if self.baseline is not None else None,
                'end': end, 'delta': delta, 'oom_events': sum(delta.values()) if delta is not None else None,
                'coverage': 'isolated_hierarchical_ancestor'}

    def baseline_snapshot(self, *, deadline=None):
        if not self.baseline_attempted:
            self.baseline_attempted = True
            try:
                self.baseline = self._snapshot(deadline)
                self.last = dict(self.baseline)
                if any(self.baseline.values()): raise ValueError('accounting_baseline_not_zero')
            except (OSError, ValueError, TimeoutError, UnicodeError):
                self.invalid = 'unverified_accounting_baseline'
        return self._proof(end=self.baseline, reason=self.invalid)

    def finish(self, *, descendant_groups, deadline=None):
        if not self.baseline_attempted or self.invalid:
            return self._proof(reason=self.invalid or 'unverified_accounting_baseline_missing')
        try:
            if frozenset(descendant_groups) != self.expected:
                raise ValueError('accounting_declared_membership_changed')
            end = self._snapshot(deadline)
            if any(end[key] < self.last[key] for key in self.last):
                raise ValueError('accounting_counter_decreased')
            self.last = dict(end)
            return self._proof(end=end)
        except (OSError, ValueError, TimeoutError, UnicodeError):
            self.invalid = 'unverified_final_accounting_counter_or_membership'
            return self._proof(reason=self.invalid)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


RetainedOOM = HierarchicalOOM
