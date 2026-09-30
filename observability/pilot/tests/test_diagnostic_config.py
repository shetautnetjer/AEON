from pathlib import Path
import configparser
import shlex
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

PILOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PILOT))
from diagnostic_config import DiagnosticSpec


class DiagnosticConfigTests(unittest.TestCase):
    def test_spec_binds_fresh_paths_and_exact_names(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-config-') as directory:
            root = Path(directory) / 'AEON'
            root.mkdir(mode=0o700)
            spec = DiagnosticSpec('Check123', aeon_root=root)
            self.assertEqual(spec.state, root / 'var/tempo-shutdown-check/Check123')
            for name in ('evidence', 'home', 'config'):
                self.assertEqual(getattr(spec, name), spec.state / name)
            self.assertEqual(spec.units_dir, spec.state / 'units')
            self.assertEqual(spec.source_root, PILOT)
            self.assertEqual(spec.unit_names, {
                component: f'aeon-tempo-check-{component}-Check123.service'
                for component in ('tempo', 'alloy', 'prometheus', 'grafana')})
            self.assertEqual(spec.emitter_name, 'aeon-tempo-check-emitter-Check123.scope')
            self.assertFalse(spec.state.exists())

    def test_run_id_is_bounded_alphanumeric_and_starts_with_a_letter(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-id-') as directory:
            root = Path(directory)
            for valid in ('A', 'check123', 'a' * 32):
                self.assertEqual(DiagnosticSpec(valid, aeon_root=root).run_id, valid)
            for invalid in ('', '1check', '../escape', 'a/b', 'a-b', 'a b',
                            'a\n', 'a' * 33, None, 7, b'check'):
                with self.subTest(run_id=invalid), self.assertRaises(ValueError):
                    DiagnosticSpec(invalid, aeon_root=root)

    def test_existing_namespace_and_unsafe_ancestors_are_refused(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-path-') as directory:
            root = Path(directory) / 'AEON'
            root.mkdir(mode=0o700)
            state = root / 'var/tempo-shutdown-check/Check'
            state.mkdir(parents=True, mode=0o700)
            with self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=root)

            state.rmdir()
            state.symlink_to(root / 'absent')
            with self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=root)
            state.unlink()
            base = state.parent
            base.chmod(0o777)
            with self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=root)
            base.chmod(0o700)
            with patch('diagnostic_config.os.getuid', return_value=root.stat().st_uid + 1):
                with self.assertRaises(ValueError):
                    DiagnosticSpec('Check', aeon_root=root)
            alias = Path(directory) / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=alias)
            base.rmdir()
            base.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=root)
        for root in (Path('relative'), Path('/tmp/../unsafe')):
            with self.subTest(root=root), self.assertRaises(ValueError):
                DiagnosticSpec('Check', aeon_root=root)

    def test_runtime_cap_is_an_integer_between_one_and_775_seconds(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-cap-') as directory:
            spec = DiagnosticSpec('Check', aeon_root=Path(directory))
            for cap in (1, 30, 774, 775):
                self.assertIsInstance(spec.render(cap), dict)
            for cap in (0, -1, 776, 900, True, 30.0, '775', None):
                with self.subTest(cap=cap), self.assertRaises(ValueError):
                    spec.render(cap)
            self.assertFalse(spec.state.exists())

    def test_render_rebinds_only_state_and_config_paths_without_writing(self):
        configs = ('README.md', 'config.alloy', 'grafana.ini', 'hermes_otel.synthetic.yaml',
                   'prometheus.yaml', 'provisioning/datasources/local.yaml', 'tempo.yaml')
        source_paths = [PILOT / 'config' / name for name in configs]
        source_paths += list((PILOT / 'units').glob('aeon-pilot-*.service'))
        before = {path: path.read_bytes() for path in source_paths}
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-render-') as directory:
            spec = DiagnosticSpec('Check', aeon_root=Path(directory))
            rendered = spec.render(775)
            self.assertEqual(set(rendered), {'config/' + name for name in configs} |
                             {'units/' + name for name in spec.unit_names.values()})
            self.assertTrue(all(type(text) is str for text in rendered.values()))
            joined = '\n'.join(rendered.values())
            old = '/home/aya-hmw/Documents/ChatGPT/AEON'
            self.assertNotIn(old + '/var/observability-pilot', joined)
            self.assertNotIn(old + '/observability/pilot/config', joined)
            self.assertIn(str(spec.state / 'tempo/live-store/traces'), rendered['config/tempo.yaml'])
            self.assertIn(str(spec.config / 'provisioning'), rendered['config/grafana.ini'])
            self.assertIn(str(spec.state / 'grafana/grafana.db'), rendered['config/grafana.ini'])
            self.assertIn(str(spec.state / 'alloy'), rendered['units/' + spec.unit_names['alloy']])
            self.assertIn(str(spec.state / 'prometheus'), rendered['units/' + spec.unit_names['prometheus']])
            self.assertEqual(rendered['config/provisioning/datasources/local.yaml'],
                             before[PILOT / 'config/provisioning/datasources/local.yaml'].decode())
            self.assertEqual(rendered['config/config.alloy'], before[PILOT / 'config/config.alloy'].decode())
            self.assertEqual(rendered['config/hermes_otel.synthetic.yaml'],
                             before[PILOT / 'config/hermes_otel.synthetic.yaml'].decode())
            for component, binary in (
                    ('tempo', old + '/artifacts/observability/tempo-3.1.0/tempo'),
                    ('grafana', old + '/artifacts/observability/grafana-13.2.3/bin/grafana'),
                    ('alloy', '/home/aya-hmw/.local/bin/alloy'),
                    ('prometheus', '/home/aya-hmw/.local/bin/prometheus')):
                self.assertIn(binary, rendered['units/' + spec.unit_names[component]])
            self.assertFalse(spec.state.exists())
        self.assertEqual(before, {path: path.read_bytes() for path in source_paths})

    def test_units_bound_stops_and_runtime_without_changing_resource_ceilings(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-units-') as directory:
            spec = DiagnosticSpec('Check', aeon_root=Path(directory))
            for runtime in (1, 17, 775):
                rendered = spec.render(runtime)
                total_memory = total_cpu = 0
                for component, name in spec.unit_names.items():
                    parser = configparser.ConfigParser(interpolation=None)
                    parser.read_string(rendered['units/' + name])
                    service = parser['Service']
                    self.assertEqual(service['RuntimeMaxSec'], f'{runtime}s')
                    self.assertEqual(service['TimeoutStopSec'], '90s' if component == 'tempo' else '25s')
                    self.assertEqual(service['KillMode'], 'control-group')
                    self.assertEqual(service['Restart'], 'no')
                    self.assertEqual(service['MemorySwapMax'], '0')
                    self.assertEqual(service['TasksMax'], '128')
                    self.assertEqual(service['UMask'], '0077')
                    self.assertEqual(service['NoNewPrivileges'], 'true')
                    self.assertNotIn('Install', parser)
                    expected_memory, expected_high, expected_cpu = {
                        'tempo': (768, 640, 75), 'alloy': (384, 320, 50),
                        'prometheus': (384, 320, 50), 'grafana': (384, 320, 25)}[component]
                    self.assertEqual(service['MemoryMax'], f'{expected_memory}M')
                    self.assertEqual(service['MemoryHigh'], f'{expected_high}M')
                    self.assertEqual(service['CPUQuota'], f'{expected_cpu}%')
                    total_memory += int(service['MemoryMax'].removesuffix('M'))
                    total_cpu += int(service['CPUQuota'].removesuffix('%'))
                self.assertEqual(total_memory + 256, 2176)
                self.assertEqual(total_cpu + 25, 225)

    def test_tempo_info_lifecycle_keeps_span_body_logging_and_other_timings_off(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-privacy-') as directory:
            spec = DiagnosticSpec('Check', aeon_root=Path(directory))
            rendered = spec.render(775)
            tempo = rendered['config/tempo.yaml']
            self.assertIn('  log_level: info\n', tempo)
            self.assertNotIn('log_level: debug', tempo)
            parser = configparser.ConfigParser(interpolation=None)
            parser.read_string(rendered['units/' + spec.unit_names['tempo']])
            arguments = shlex.split(parser['Service']['ExecStart'])
            for kind in ('received', 'discarded'):
                for field in ('enabled', 'include-attributes'):
                    flag = f'-distributor.log-{kind}-spans.{field}=false'
                    self.assertEqual(arguments.count(flag), 1)
            original = (PILOT / 'config/tempo.yaml').read_text()
            normalized = tempo.replace(str(spec.state), '/home/aya-hmw/Documents/ChatGPT/AEON/var/observability-pilot')
            self.assertEqual(normalized.replace('  log_level: info\n', '  log_level: warn\n'), original)

    def test_changed_templates_cannot_silently_bypass_diagnostic_controls(self):
        with tempfile.TemporaryDirectory(prefix='aeon-diagnostic-template-') as directory:
            root = Path(directory)
            source = root / 'source'
            for name in ('config', 'units'):
                shutil.copytree(PILOT / name, source / name)
            spec = DiagnosticSpec('Check', aeon_root=root, source_root=source)
            unit = source / 'units/aeon-pilot-tempo.service'
            original = unit.read_text()
            for changed in (original.replace('RuntimeMaxSec=30min\n', ''),
                            original + 'TimeoutStopSec=25s\n',
                            original.replace('ExecStart=', 'UnexpectedStart=')):
                unit.write_text(changed)
                with self.subTest(unit=changed), self.assertRaises(ValueError):
                    spec.render(775)
            unit.write_text(original)
            tempo = source / 'config/tempo.yaml'
            tempo.write_text(tempo.read_text().replace('  log_level: warn\n', '  log_level: debug\n'))
            with self.assertRaises(ValueError):
                spec.render(775)


if __name__ == '__main__':
    unittest.main()
