"""Replay systemd259's implicit inactive slice without live bus/process calls."""
from pathlib import Path
import tempfile
import unittest
import test_diagnostic_system as support


class ImplicitSliceTests(unittest.TestCase):
    def fixture(self, root):
        fixture = support.Fixture(root, support.load())
        name = fixture.spec.accounting_slice_name
        fixture.states[name] = {'Id': name, 'LoadState': 'loaded', 'ActiveState': 'inactive',
                               'SubState': 'dead', 'FragmentPath': '', 'SourcePath': '',
                               'DropInPaths': '', 'Transient': 'no', 'ControlGroup': '',
                               'InvocationID': '', 'Following': '', 'Job': ''}
        return fixture

    def test_implicit_slice_passes_preflight_and_reaches_own_registration(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.fixture(Path(temporary))
            self.assertTrue(fixture.backend.preflight(timeout=10)['passed'])
            fixture.backend.prepare(timeout=10)
            def refuse_link(args, **kwargs):
                if args[:3] == ['systemctl', '--user', 'link']:
                    fixture.calls.append((args, kwargs))
                    raise RuntimeError('registration_probe')
                return fixture.run(args, **kwargs)
            fixture.backend.run = refuse_link
            with self.assertRaisesRegex(RuntimeError, 'registration_probe'):
                fixture.backend.start(700, timeout=30)
            self.assertTrue(any(args[:3] == ['systemctl', '--user', 'link'] for args, _ in fixture.calls))
            self.assertFalse(any(args[:3] == ['systemctl', '--user', 'start'] for args, _ in fixture.calls))

    def test_changed_or_missing_implicit_metadata_is_rejected_before_registration(self):
        invalid = {'Id':'foreign.slice', 'LoadState':'error', 'ActiveState':'active',
                   'SubState':'waiting', 'FragmentPath':'/foreign/fragment', 'SourcePath':'/foreign/source',
                   'DropInPaths':'/foreign/dropin', 'Transient':'yes', 'ControlGroup':'/foreign',
                   'InvocationID':'f'*32, 'Following':'foreign.slice', 'Job':'1/start'}
        for key, value in invalid.items():
            for missing in (False, True):
                with self.subTest(field=key, missing=missing), tempfile.TemporaryDirectory() as temporary:
                    fixture = self.fixture(Path(temporary))
                    state = fixture.states[fixture.spec.accounting_slice_name]
                    if missing: state.pop(key)
                    else: state[key] = value
                    with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)
                    self.assertFalse(any(args[:3] == ['systemctl', '--user', 'link'] for args, _ in fixture.calls))

    def test_existing_or_symlink_cgroup_refuses_implicit_slice(self):
        for symlink in (False, True):
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as temporary:
                fixture = self.fixture(Path(temporary))
                path = fixture.adapter.group(fixture.backend.accounting_group)
                path.parent.mkdir(parents=True, exist_ok=True)
                if symlink: path.symlink_to(Path(temporary)/'absent')
                else: path.mkdir()
                with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)

    def test_services_and_scope_never_use_implicit_slice_exception(self):
        for kind in ('service', 'scope'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                fixture = self.fixture(Path(temporary))
                name = fixture.spec.unit_names['tempo'] if kind=='service' else fixture.spec.emitter_name
                state = dict(fixture.states[fixture.spec.accounting_slice_name], Id=name)
                fixture.states[name] = state
                with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)

    def test_changed_slice_between_preflight_and_start_refuses_before_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.fixture(Path(temporary))
            fixture.backend.preflight(timeout=10)
            fixture.backend.prepare(timeout=10)
            fixture.states[fixture.spec.accounting_slice_name]['DropInPaths']='/foreign/dropin'
            with self.assertRaises(ValueError): fixture.backend.start(700, timeout=30)
            self.assertFalse(any(args[:3] == ['systemctl', '--user', 'link'] for args, _ in fixture.calls))

    def test_registration_added_after_preflight_refuses_before_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.fixture(Path(temporary))
            fixture.backend.preflight(timeout=10)
            fixture.backend.prepare(timeout=10)
            (fixture.adapter.runtime_root/fixture.spec.accounting_slice_name).symlink_to(Path(temporary)/'absent')
            with self.assertRaises(ValueError): fixture.backend.start(700, timeout=30)
            self.assertFalse(any(args[:3] == ['systemctl', '--user', 'link'] for args, _ in fixture.calls))

    def test_not_found_slice_cannot_adopt_an_existing_cgroup(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.fixture(Path(temporary))
            fixture.states.pop(fixture.spec.accounting_slice_name)
            fixture.adapter.group(fixture.backend.accounting_group).mkdir(parents=True)
            with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)

    def test_existing_runtime_or_persistent_registration_refuses_implicit_slice(self):
        for root_kind in ('runtime_root', 'persistent_root'):
            for suffix in ('', '.d'):
                with self.subTest(root=root_kind,suffix=suffix), tempfile.TemporaryDirectory() as temporary:
                    fixture = self.fixture(Path(temporary))
                    path = getattr(fixture.adapter, root_kind)/(fixture.spec.accounting_slice_name+suffix)
                    path.symlink_to(Path(temporary)/'absent')
                    with self.assertRaises(ValueError): fixture.backend.preflight(timeout=10)


if __name__ == '__main__': unittest.main()
