"""Synthetic, socket-denied tests for explicit diagnostic readback bindings."""
import copy
import hashlib
import importlib.util
import json
import os
import socket
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_pilot_readback import TRACE, fixture, metrics


MODULE = Path(__file__).resolve().parents[1] / 'readback.py'
spec = importlib.util.spec_from_file_location('diagnostic_readback_under_test', MODULE)
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CONFIG = b'[auth.anonymous]\nhide_version = true\n'
DEFAULT_PIN = 'observability/pilot/config/grafana.ini'
DIAGNOSTIC_PIN = 'config/grafana.ini'


def binary_receipt(pin=DIAGNOSTIC_PIN):
    return {'passed': True, 'results': [{
        'command': [str(rb.GRAFANA_BINARY), 'server', '-v'],
        'exit_code': 0, 'stdout': 'Version 13.2.3 (commit: synthetic)\n',
    }], 'config_pins': [{'path': pin, 'sha256': hashlib.sha256(CONFIG).hexdigest()}]}


class SocketDeniedTests(unittest.TestCase):
    def setUp(self):
        self.socket_guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        self.socket_guard.start()
        self.addCleanup(self.socket_guard.stop)


class DiagnosticHealthTests(SocketDeniedTests):
    def test_explicit_diagnostic_config_pin_accepts_masked_health(self):
        result = rb.verify_grafana_health({'database': 'ok'}, CONFIG, binary_receipt(),
                                          config_pin_path=DIAGNOSTIC_PIN)
        self.assertEqual(result['verified_version'], '13.2.3')
        self.assertTrue(result['anonymous_version_masked'])
        self.assertEqual(result['grafana_config_sha256'], hashlib.sha256(CONFIG).hexdigest())

    def test_diagnostic_pin_never_changes_exact_acquired_binary_command(self):
        receipt = binary_receipt()
        receipt['results'][0]['command'][0] = '/tmp/new-state/bin/grafana'
        with self.assertRaisesRegex(ValueError, '^grafana_binary_receipt_mismatch$'):
            rb.verify_grafana_health({'database': 'ok'}, CONFIG, receipt,
                                     config_pin_path=DIAGNOSTIC_PIN)

    def test_explicit_pin_requires_matching_unique_receipt_and_bytes(self):
        changed = binary_receipt(DEFAULT_PIN)
        duplicate = binary_receipt()
        duplicate['config_pins'].append(copy.deepcopy(duplicate['config_pins'][0]))
        wrong_hash = binary_receipt()
        wrong_hash['config_pins'][0]['sha256'] = '0' * 64
        for receipt in (changed, duplicate, wrong_hash):
            with self.subTest(receipt=receipt), self.assertRaisesRegex(ValueError, '^grafana_config_pin_mismatch$'):
                rb.verify_grafana_health({'database': 'ok'}, CONFIG, receipt,
                                         config_pin_path=DIAGNOSTIC_PIN)

    def test_original_pin_remains_default_and_schema_is_unchanged(self):
        result = rb.verify_grafana_health({'database': 'ok'}, CONFIG, binary_receipt(DEFAULT_PIN))
        self.assertEqual(set(result), {'database', 'verified_version', 'version_source',
                                      'anonymous_version_masked', 'health_version', 'grafana_config_sha256'})
        with self.assertRaisesRegex(ValueError, '^grafana_config_pin_mismatch$'):
            rb.verify_grafana_health({'database': 'ok'}, CONFIG, binary_receipt())

    def test_config_pin_label_is_an_explicit_known_string(self):
        for label in (None, [], {}, 'elsewhere/grafana.ini'):
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, '^grafana_config_pin_mismatch$'):
                rb.verify_grafana_health({'database': 'ok'}, CONFIG, binary_receipt(),
                                         config_pin_path=label)


class DiagnosticDiskTests(SocketDeniedTests):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.old, self.artifacts, self.new = (Path(self.tmp.name) / label
                                             for label in ('old', 'artifacts', 'new'))
        for root in (self.old, self.artifacts, self.new):
            root.mkdir()

    def inventory(self, **kwargs):
        return rb.disk_usage(self.old, self.artifacts, additional_roots=(self.new,), **kwargs)

    def test_three_root_inventory_counts_cross_root_hardlinks_once(self):
        (self.old / 'old.data').write_bytes(b'old')
        (self.artifacts / 'archive').write_bytes(b'archive')
        (self.new / 'new.data').write_bytes(b'newer')
        os.link(self.old / 'old.data', self.new / 'hardlink')
        (self.new / 'internal').symlink_to(self.old / 'old.data')
        result = self.inventory()
        self.assertEqual(result['roots'], [str(self.old), str(self.artifacts), str(self.new)])
        self.assertEqual(result['logical_file_bytes'], 15)
        self.assertEqual(result['unique_inodes'], 7)
        self.assertEqual(result['symlinks_not_followed'], 1)
        self.assertEqual(result['limit_bytes'], 10 * 1024**3)
        self.assertTrue((self.old / 'old.data').exists())
        self.assertTrue((self.new / 'hardlink').exists())

    def test_extra_root_symlinks_cannot_escape_or_be_followed(self):
        outside = Path(self.tmp.name) / 'outside'
        outside.write_bytes(b'external')
        (self.new / 'escape').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, '^budget_link_escape_refused$'):
            self.inventory()
        self.assertTrue((self.new / 'escape').is_symlink())

    def test_aggregate_ten_gib_budget_includes_new_root_sparse_files(self):
        for root, size in ((self.old, 6 * 1024**3), (self.new, 5 * 1024**3)):
            with (root / 'sparse').open('wb') as handle:
                handle.truncate(size)
        with self.assertRaisesRegex(ValueError, '^disk_budget_exceeded$'):
            self.inventory()
        self.assertEqual((self.new / 'sparse').stat().st_size, 5 * 1024**3)

    def test_extra_root_owner_and_inode_type_are_checked(self):
        extra_file = self.new / 'new.data'
        extra_file.write_bytes(b'new')
        original_lstat = Path.lstat
        def changed_owner(path):
            info = original_lstat(path)
            if path == extra_file:
                return SimpleNamespace(st_uid=os.getuid() + 1, st_mode=info.st_mode,
                                       st_dev=info.st_dev, st_ino=info.st_ino,
                                       st_blocks=info.st_blocks, st_size=info.st_size)
            return info
        with patch.object(Path, 'lstat', changed_owner), self.assertRaisesRegex(ValueError, '^budget_inode_owner_mismatch$'):
            self.inventory()
        os.mkfifo(self.new / 'unexpected')
        with self.assertRaisesRegex(ValueError, '^budget_unexpected_inode_type$'):
            self.inventory()

    def test_extra_root_collection_and_directory_are_validated(self):
        with self.assertRaisesRegex(ValueError, '^invalid_additional_budget_roots$'):
            rb.disk_usage(self.old, self.artifacts, additional_roots=[self.new])
        linked = Path(self.tmp.name) / 'linked-root'
        linked.symlink_to(self.new, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, '^budget_root_missing_or_link$'):
            rb.disk_usage(self.old, self.artifacts, additional_roots=(linked,))
        with self.assertRaisesRegex(ValueError, '^budget_root_missing_or_link$'):
            rb.disk_usage(self.old, self.artifacts, additional_roots=(self.new / 'absent',))

    def test_original_two_root_default_schema_and_totals_are_preserved(self):
        (self.old / 'old.data').write_bytes(b'old')
        (self.new / 'unselected').write_bytes(b'not in original inventory')
        result = rb.disk_usage(self.old, self.artifacts)
        self.assertEqual(result['roots'], [str(self.old), str(self.artifacts)])
        self.assertEqual(result['logical_file_bytes'], 3)
        self.assertEqual(set(result), {'roots', 'bytes', 'logical_file_bytes', 'allocated_bytes',
                                      'symlinks_not_followed', 'unique_inodes', 'limit_bytes',
                                      'hard_quota', 'approved_external_python_target_bytes_counted'})


class Clock:
    def __init__(self, now=100):
        self.now = now

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Response:
    status = 200

    def __init__(self, payload):
        self.body = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, limit):
        return self.body[:limit]


class SyntheticOpener:
    def __init__(self, clock, *, step=0):
        self.clock, self.step, self.requests = clock, step, []
        _, self.trace = fixture()

    def open(self, request, timeout):
        url = request.full_url
        self.requests.append({'url': url, 'timeout': timeout, 'at': self.clock.now})
        self.clock.now += self.step
        parsed = urllib.parse.urlsplit(url)
        if parsed.path == '/ready':
            payload = 'ready'
        elif parsed.path == '/api/health':
            payload = {'database': 'ok'}
        elif parsed.path.startswith('/api/datasources/uid/'):
            kind = 'tempo' if parsed.path.endswith('-tempo') else 'prometheus'
            payload = {'uid': 'aeon-pilot-' + kind, 'type': kind,
                       'url': 'http://127.0.0.1:' + ('13200' if kind == 'tempo' else '19090'),
                       'access': 'proxy', 'readOnly': True}
        elif '/api/traces/' in parsed.path:
            payload = self.trace
        elif parsed.path.endswith('/label/__name__/values'):
            payload = {'status': 'success', 'data': ['aeon_pilot_calls_total', 'aeon_pilot_duration_milliseconds_count']}
        elif parsed.path == '/api/v1/query':
            name = urllib.parse.parse_qs(parsed.query)['query'][0].split('"')[1]
            payload = metrics(name)
        else:
            raise AssertionError('unexpected synthetic endpoint: ' + parsed.path)
        return Response(payload)


class DiagnosticRunTests(SocketDeniedTests):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.old, self.artifacts, self.new = (Path(self.tmp.name) / label
                                             for label in ('old', 'artifacts', 'new'))
        for root in (self.old, self.artifacts, self.new):
            root.mkdir()
        self.config = self.new / 'config' / 'grafana.ini'
        self.prereqs = self.new / 'evidence' / 'binary-prereqs.json'
        self.config.parent.mkdir()
        self.prereqs.parent.mkdir()
        self.config.write_bytes(CONFIG)
        self.prereqs.write_text(json.dumps(binary_receipt()))
        self.emitted = {'expected_spans': fixture()[0]}
        self.clock = Clock()
        self.opener = SyntheticOpener(self.clock)
        self.clock_patch = patch.object(rb.time, 'monotonic', self.clock.monotonic)
        self.sleep_patch = patch.object(rb.time, 'sleep', self.clock.sleep)
        self.opener_patch = patch.object(rb.urllib.request, 'build_opener', return_value=self.opener)
        for mocked in (self.clock_patch, self.sleep_patch, self.opener_patch):
            mocked.start()
            self.addCleanup(mocked.stop)

    def diagnostic_run(self, **overrides):
        kwargs = {'grafana_config_path': self.config, 'binary_prereqs_path': self.prereqs,
                  'inventory_roots': (self.old, self.artifacts, self.new),
                  'absolute_deadline': 120, 'metric_scope': 'first canonical synthetic batch; Alloy unchanged',
                  'config_pin_path': DIAGNOSTIC_PIN}
        kwargs.update(overrides)
        return rb.run(self.emitted, 'normal', **kwargs)

    def test_explicit_context_uses_new_files_all_roots_and_normal_metrics(self):
        (self.old / 'old.data').write_bytes(b'old')
        (self.artifacts / 'archive').write_bytes(b'archive')
        evidence = self.diagnostic_run()
        self.assertTrue(evidence['passed'])
        self.assertEqual(evidence['phase'], 'normal')
        self.assertEqual(evidence['span_count'], 25)
        self.assertEqual(evidence['canonical_metrics']['verified']['calls'], 5)
        self.assertEqual(evidence['metric_count_scope'], 'first canonical synthetic batch; Alloy unchanged')
        self.assertEqual(evidence['disk']['roots'], [str(self.old), str(self.artifacts), str(self.new)])
        self.assertEqual(evidence['grafana_version_evidence'], {
            'source': str(self.prereqs), 'sha256': hashlib.sha256(self.prereqs.read_bytes()).hexdigest(),
            'config_source': str(self.config)})
        self.assertEqual((rb.STATE, rb.ARTIFACTS, rb.GRAFANA_CONFIG, rb.BINARY_PREREQS), (
            Path('/home/aya-hmw/Documents/ChatGPT/AEON/var/observability-pilot'),
            Path('/home/aya-hmw/Documents/ChatGPT/AEON/artifacts/observability'),
            Path('/home/aya-hmw/Documents/ChatGPT/AEON/observability/pilot/config/grafana.ini'),
            Path('/home/aya-hmw/Documents/ChatGPT/AEON/var/observability-pilot/evidence/binary-prereqs.json')))

    def test_config_receipt_pin_is_passed_to_health_validator(self):
        with self.assertRaisesRegex(ValueError, '^poll_failed_grafana_config_pin_mismatch$'):
            self.diagnostic_run(config_pin_path=DEFAULT_PIN, absolute_deadline=101)
        self.assertLessEqual(self.clock.now, 101)

    def test_every_request_uses_remaining_shared_deadline_without_extension(self):
        self.opener.step = 0.1
        evidence = self.diagnostic_run(absolute_deadline=102)
        self.assertEqual(evidence['deadline_seconds'], 2)
        self.assertEqual(len(self.opener.requests), 11)
        for request in self.opener.requests:
            self.assertAlmostEqual(request['timeout'], min(3, 102 - request['at']))
        self.assertLess(self.clock.now, 102)

    def test_later_shared_deadline_is_clamped_to_sixty_seconds(self):
        self.opener.step = 6
        with self.assertRaises(ValueError):
            self.diagnostic_run(absolute_deadline=1000)
        self.assertLessEqual(len(self.opener.requests), 10)
        self.assertEqual(self.clock.now, 160)
        self.assertEqual(self.opener.requests[0]['timeout'], 3)

    def test_exhausted_shared_deadline_is_refused_before_new_requests(self):
        self.opener.step = 5
        with self.assertRaises(ValueError):
            self.diagnostic_run(absolute_deadline=105)
        self.assertEqual(len(self.opener.requests), 1)
        self.assertEqual(self.clock.now, 105)

    def test_expired_and_invalid_deadlines_are_refused_before_context_io(self):
        for deadline in (99, 100, float('nan'), float('inf'), True, '120'):
            with self.subTest(deadline=deadline), patch.object(Path, 'read_bytes', side_effect=AssertionError('context read after invalid deadline')):
                with self.assertRaises(ValueError):
                    self.diagnostic_run(absolute_deadline=deadline)
        self.assertEqual(self.opener.requests, [])

    def test_context_preparation_cannot_start_an_independent_sixty_seconds(self):
        original_read = Path.read_bytes
        def slow_read(path):
            data = original_read(path)
            self.clock.now += 3
            return data
        with patch.object(Path, 'read_bytes', slow_read), self.assertRaises(ValueError):
            self.diagnostic_run(absolute_deadline=105)
        self.assertEqual(self.opener.requests, [])
        self.assertEqual(self.clock.now, 106)

    def test_inventory_tuple_requires_three_distinct_absolute_disjoint_roots(self):
        bad_roots = ([self.old, self.artifacts, self.new], (self.old, self.artifacts),
                     (self.old, self.artifacts, self.old), (self.old, self.artifacts, Path('relative')),
                     (self.old, self.artifacts, self.old / 'nested'), (self.old, self.artifacts, None))
        for roots in bad_roots:
            with self.subTest(roots=roots), self.assertRaisesRegex(ValueError, '^invalid_inventory_roots$'):
                self.diagnostic_run(inventory_roots=roots)
        self.assertEqual(self.opener.requests, [])

    def test_metric_scope_is_explicit_bounded_metadata(self):
        for scope in ('', False, 7, 'CANARY', 'x' * 1025):
            with self.subTest(scope=scope), self.assertRaises(ValueError):
                self.diagnostic_run(metric_scope=scope)
        self.assertEqual(self.opener.requests, [])

    def test_original_normal_and_recovery_defaults_keep_paths_budget_and_schema(self):
        receipt = json.dumps(binary_receipt(DEFAULT_PIN)).encode()
        def synthetic_default_read(path):
            if path == rb.GRAFANA_CONFIG:
                return CONFIG
            if path == rb.BINARY_PREREQS:
                return receipt
            raise AssertionError('unexpected default file read')
        for phase, scope in (('normal', 'first canonical synthetic batch'),
                             ('recovery', 'Alloy connector reset before recovery')):
            with self.subTest(phase=phase), patch.object(Path, 'read_bytes', synthetic_default_read), patch.object(rb, 'disk_usage', return_value={'roots': [str(rb.STATE), str(rb.ARTIFACTS)]}) as inventory:
                evidence = rb.run(self.emitted, phase)
            self.assertEqual(evidence['metric_count_scope'], scope)
            self.assertEqual(evidence['deadline_seconds'], 60)
            self.assertEqual(evidence['grafana_version_evidence']['source'], str(rb.BINARY_PREREQS))
            self.assertEqual(evidence['grafana_version_evidence']['config_source'], str(rb.GRAFANA_CONFIG))
            self.assertEqual(set(evidence), {'phase', 'capture', 'metric_count_scope', 'deadline_seconds',
                                            'endpoints', 'metric_query_time', 'metric_sample_scope',
                                            'grafana_version_evidence', 'traces', 'span_count',
                                            'canonical_metrics', 'disk', 'passed'})
            inventory.assert_called_once_with(rb.STATE)


if __name__ == '__main__':
    unittest.main()
