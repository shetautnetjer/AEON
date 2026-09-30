import base64
import copy
import hashlib
import importlib.util
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

MODULE = Path(str(Path(__file__).resolve().parents[1]/'readback.py'))
try:
    spec = importlib.util.spec_from_file_location('aeon_pilot_readback', MODULE)
    rb = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = rb
    spec.loader.exec_module(rb)
except FileNotFoundError:
    rb = None

TRACE = '0123456789abcdef0123456789abcdef'

def av(key, value):
    return {'key': key, 'value': {'intValue': str(value)} if type(value) is int else {'stringValue': value}}

def fixture():
    expected = []
    spans = []
    for i in range(1, 26):
        name = 'agent' if i == 1 else 'api' if i <= 6 else 'tool'
        status = 'ERROR' if i in (3, 5) else 'UNSET'
        attrs = {'session.id': 'synthetic-session', 'hermes.turn.number': 1}
        if name == 'api':
            attrs.update({'gen_ai.operation.name': 'chat', 'hermes.tool.outcome': 'error' if status == 'ERROR' else 'completed'})
        sid, parent = f'{i:016x}', '' if i == 1 else '0000000000000001'
        expected.append({'trace_id': TRACE, 'span_id': sid, 'parent_span_id': parent, 'name': name, 'status': status, 'attributes': attrs})
        output_attrs = dict(attrs)
        if 'gen_ai.operation.name' in attrs:
            output_attrs['operation'] = attrs['gen_ai.operation.name']
        if 'hermes.tool.outcome' in attrs:
            output_attrs['outcome'] = attrs['hermes.tool.outcome']
        spans.append({'traceId': TRACE, 'spanId': sid, 'parentSpanId': parent, 'name': name, 'startTimeUnixNano': '1', 'endTimeUnixNano': '2', 'status': {'code': 2 if status == 'ERROR' else 0}, 'attributes': [av(k, v) for k, v in output_attrs.items()]})
    group = {'resource': {'attributes': [av('service.name', 'hermes-offline-pilot'), av('deployment.environment.name', 'synthetic')]}, 'scopeSpans': [{'scope': {'name': 'aeon.offline.synthetic', 'version': '1'}, 'spans': spans}]}
    return expected, {'batches': [group]}

def metrics(name):
    return {'status': 'success', 'data': {'resultType': 'vector', 'result': [
        {'metric': {'__name__': name, 'operation': 'chat', 'outcome': 'completed', 'status_code': 'STATUS_CODE_UNSET', 'job': 'hermes-offline-pilot'}, 'value': [1, '3']},
        {'metric': {'__name__': name, 'operation': 'chat', 'outcome': 'error', 'status_code': 'STATUS_CODE_ERROR', 'job': 'hermes-offline-pilot'}, 'value': [1, '2']},
    ]}}

class TraceParserTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(rb, 'readback verifier not implemented')
        self.expected, self.payload = fixture()
    def test_exact_hex_trace_is_accepted(self):
        result = rb.verify_trace(self.payload, self.expected, TRACE)
        self.assertEqual(result['span_count'], 25)
    def test_base64_ids_and_resource_spans_shape_are_accepted(self):
        payload = {'resourceSpans': self.payload['batches']}
        for span in payload['resourceSpans'][0]['scopeSpans'][0]['spans']:
            for field in ('traceId', 'spanId', 'parentSpanId'):
                if span[field]:
                    span[field] = base64.b64encode(bytes.fromhex(span[field])).decode()
        self.assertEqual(rb.verify_trace(payload, self.expected, TRACE)['span_count'], 25)
    def test_invalid_or_ambiguous_id_refuses(self):
        for value in ('x', '0000000000000000', 'AAAAAAAAAAA', 'A' * 32):
            with self.subTest(value=value), self.assertRaises(ValueError):
                rb.normalize_id(value, 8)
    def test_duplicate_or_missing_span_refuses(self):
        for spans in [self.payload['batches'][0]['scopeSpans'][0]['spans'][:-1], self.payload['batches'][0]['scopeSpans'][0]['spans'] + [self.payload['batches'][0]['scopeSpans'][0]['spans'][0]]]:
            changed = copy.deepcopy(self.payload); changed['batches'][0]['scopeSpans'][0]['spans'] = spans
            with self.assertRaises(ValueError): rb.verify_trace(changed, self.expected, TRACE)
    def test_parent_name_status_or_typed_attribute_drift_refuses(self):
        mutations = [('parentSpanId', '0000000000000009'), ('name', 'other'), ('status', {'code': 1}), ('attributes', [av('session.id', 'different')])]
        for key, value in mutations:
            with self.subTest(key=key):
                changed = copy.deepcopy(self.payload); changed['batches'][0]['scopeSpans'][0]['spans'][1][key] = value
                with self.assertRaises(ValueError): rb.verify_trace(changed, self.expected, TRACE)
    def test_events_links_tracestate_or_status_description_refuses(self):
        mutations = [('events', [{'name': 'CANARY'}]), ('links', [{'spanId': '0000000000000001'}]), ('traceState', 'opaque'), ('status', {'code': 0, 'message': 'private'})]
        for key, value in mutations:
            with self.subTest(key=key):
                changed = copy.deepcopy(self.payload); changed['batches'][0]['scopeSpans'][0]['spans'][0][key] = value
                with self.assertRaises(ValueError): rb.verify_trace(changed, self.expected, TRACE)
    def test_unapproved_resource_scope_and_attribute_refuses(self):
        for location in ('resource', 'scope', 'span'):
            changed = copy.deepcopy(self.payload); group = changed['batches'][0]
            target = group['resource'] if location == 'resource' else group['scopeSpans'][0]['scope'] if location == 'scope' else group['scopeSpans'][0]['spans'][0]
            target.setdefault('attributes', []).append(av('private.content', 'secret'))
            with self.subTest(location=location), self.assertRaises(ValueError): rb.verify_trace(changed, self.expected, TRACE)
    def test_canary_anywhere_refuses_without_content_in_error(self):
        changed = copy.deepcopy(self.payload); changed['CANARY_BODY'] = 'AEON_CANARY_SECRET'
        with self.assertRaises(ValueError) as error: rb.verify_trace(changed, self.expected, TRACE)
        self.assertNotIn('SECRET', str(error.exception))
    def test_actual_harness_sentinel_is_refused_in_keys_or_values(self):
        for value in ({'note': 'SYNTHETIC_CONTENT_SENTINEL'}, {'SYNTHETIC_CONTENT_SENTINEL': 'ordinary'}):
            with self.subTest(value=value), self.assertRaises(ValueError): rb.no_canary(value)
    def test_boolean_numeric_alias_refuses(self):
        changed = copy.deepcopy(self.payload)
        attrs = changed['batches'][0]['scopeSpans'][0]['spans'][0]['attributes']
        attrs[1]['value'] = {'boolValue': True}
        with self.assertRaises(ValueError): rb.verify_trace(changed, self.expected, TRACE)

class MetricParserTests(unittest.TestCase):
    def setUp(self): self.assertIsNotNone(rb, 'readback verifier not implemented')
    def test_exact_five_calls_two_errors_and_five_histogram_refuses_duplicate_counting(self):
        result = rb.verify_metrics(metrics('aeon_pilot_calls_total'), metrics('aeon_pilot_duration_milliseconds_count'))
        self.assertEqual((result['calls'], result['errors'], result['duration_count']), (5, 2, 5))
    def test_metric_wrong_total_or_histogram_distribution_refuses(self):
        for kind in ('calls', 'histogram'):
            calls, hist = metrics('aeon_pilot_calls_total'), metrics('aeon_pilot_duration_milliseconds_count')
            (calls if kind == 'calls' else hist)['data']['result'][0]['value'][1] = '4'
            with self.assertRaises(ValueError): rb.verify_metrics(calls, hist)
    def test_metric_correlation_label_or_unbounded_enum_refuses(self):
        for key, value in [('session_id', 'synthetic-session'), ('operation', 'private'), ('status_code', 'bogus'), ('outcome', 'bogus')]:
            calls = metrics('aeon_pilot_calls_total'); calls['data']['result'][0]['metric'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): rb.verify_metrics(calls, metrics('aeon_pilot_duration_milliseconds_count'))
    def test_nonfinite_or_duplicate_metric_series_refuses(self):
        for value in ('NaN', '+Inf', '-1', '0.5'):
            calls = metrics('aeon_pilot_calls_total'); calls['data']['result'][0]['value'][1] = value
            with self.subTest(value=value), self.assertRaises(ValueError): rb.verify_metrics(calls, metrics('aeon_pilot_duration_milliseconds_count'))
        calls = metrics('aeon_pilot_calls_total'); calls['data']['result'].append(copy.deepcopy(calls['data']['result'][0]))
        with self.assertRaises(ValueError): rb.verify_metrics(calls, metrics('aeon_pilot_duration_milliseconds_count'))
    def test_receipt_derived_distribution_accepts_missing_outcome_without_fabrication(self):
        expected, _ = fixture()
        calls, hist = metrics('aeon_pilot_calls_total'), metrics('aeon_pilot_duration_milliseconds_count')
        for item in expected:
            item['attributes'].pop('hermes.tool.outcome', None)
        for payload in (calls, hist):
            for row in payload['data']['result']: row['metric'].pop('outcome')
        self.assertEqual(rb.verify_metrics(calls, hist, expected)['calls'], 5)
        for payload in (calls, hist):
            for row in payload['data']['result']: row['metric']['outcome'] = 'completed'
        with self.assertRaises(ValueError): rb.verify_metrics(calls, hist, expected)

class DiskTests(unittest.TestCase):
    def setUp(self): self.assertIsNotNone(rb, 'readback verifier not implemented')
    def test_state_artifact_internal_links_and_hardlinks_count_without_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            state, artifacts = Path(tmp) / 'state', Path(tmp) / 'artifacts'
            state.mkdir(); artifacts.mkdir()
            (state / 'data').write_bytes(b'a' * 8); (artifacts / 'archive').write_bytes(b'b' * 9)
            (state / 'internal').symlink_to('data')
            __import__('os').link(state / 'data', artifacts / 'hardlink')
            result = rb.disk_usage(state, artifacts)
            self.assertEqual(result['logical_file_bytes'], 17)
            self.assertEqual(result['symlinks_not_followed'], 1)
    def test_unrecognized_escape_or_aggregate_budget_overflow_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            state, artifacts = Path(tmp) / 'state', Path(tmp) / 'artifacts'
            state.mkdir(); artifacts.mkdir(); (state / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError): rb.disk_usage(state, artifacts)
            (state / 'escape').unlink(); (state / 'data').write_bytes(b'a' * 8); (artifacts / 'data').write_bytes(b'b' * 9)
            with self.assertRaises(ValueError): rb.disk_usage(state, artifacts, limit=10)

class BoundaryTests(unittest.TestCase):
    def setUp(self): self.assertIsNotNone(rb, 'readback verifier not implemented')
    def test_only_literal_pilot_loopback_http_urls_are_allowed(self):
        rb.validate_url('http://127.0.0.1:13200/api/traces/' + TRACE)
        for url in ('https://example.com/', 'http://localhost:13200/', 'http://127.0.0.1:4320/', 'http://user@127.0.0.1:13200/', 'http://127.0.0.1:13200/x#fragment'):
            with self.subTest(url=url), self.assertRaises(ValueError): rb.validate_url(url)
    def test_expected_receipt_count_and_canary_are_rejected(self):
        expected, _ = fixture()
        with self.assertRaises(ValueError): rb.validate_expected(expected[:-1])
        expected[0]['attributes']['session.id'] = 'CANARY'
        with self.assertRaises(ValueError): rb.validate_expected(expected)

class ReadbackRepairTests(unittest.TestCase):
    def setUp(self):
        self.config = b'[auth.anonymous]\nhide_version = true\n'
        self.prereqs = {'passed': True, 'results': [{'command': [str(rb.GRAFANA_BINARY), 'server', '-v'], 'exit_code': 0, 'stdout': 'Version 13.2.3 (commit: synthetic)\n'}], 'config_pins': [{'path': 'observability/pilot/config/grafana.ini', 'sha256': hashlib.sha256(self.config).hexdigest()}]}
    def test_masked_health_uses_pinned_binary_version_without_claiming_http_version(self):
        for body in ({'database': 'ok'}, {'database': 'ok', 'version': None, 'commit': None}):
            verified = rb.verify_grafana_health(body, self.config, self.prereqs)
            self.assertEqual(verified['verified_version'], '13.2.3')
            self.assertEqual(verified['version_source'], 'binary-prereqs.json: grafana server -v')
            self.assertTrue(verified['anonymous_version_masked'])
            self.assertIsNone(verified['health_version'])
    def test_database_failure_or_wrong_reported_version_still_refuses(self):
        for body in ({'database': 'failed'}, {'database': 'ok', 'version': '13.2.2'}, {'database': 'ok', 'version': ''}):
            with self.subTest(body=body), self.assertRaises(ValueError):
                rb.verify_grafana_health(body, self.config, self.prereqs)
    def test_mask_requires_exact_config_pin_and_successful_exact_version_receipt(self):
        altered = self.config.replace(b'true', b'false')
        cases = [(altered, self.prereqs)]
        unmasked = copy.deepcopy(self.prereqs); unmasked['config_pins'][0]['sha256'] = hashlib.sha256(altered).hexdigest()
        cases.append((altered, unmasked))
        for key, value in (('passed', False), ('results', [])):
            receipt = copy.deepcopy(self.prereqs); receipt[key] = value; cases.append((self.config, receipt))
        receipt = copy.deepcopy(self.prereqs); receipt['results'][0]['stdout'] = 'Version 13.2.30\n'; cases.append((self.config, receipt))
        receipt = copy.deepcopy(self.prereqs); receipt['results'][0]['exit_code'] = 1; cases.append((self.config, receipt))
        for config, prereqs in cases:
            with self.subTest(config=config, prereqs=prereqs), self.assertRaises(ValueError):
                rb.verify_grafana_health({'database': 'ok'}, config, prereqs)
    def test_historical_query_uses_canonical_utc_time_and_current_has_no_time(self):
        when = rb.validate_metrics_time('2026-09-30T18:44:16Z', 'normal')
        parsed = urllib.parse.parse_qs(urllib.parse.urlsplit(rb.metric_query_url('aeon_pilot_calls_total', when)).query)
        self.assertEqual(parsed, {'query': ['{__name__="aeon_pilot_calls_total"}'], 'time': ['2026-09-30T18:44:16Z']})
        current = urllib.parse.parse_qs(urllib.parse.urlsplit(rb.metric_query_url('aeon_pilot_calls_total')).query)
        self.assertNotIn('time', current)
        self.assertIsNone(rb.validate_metrics_time(None, 'recovery'))
    def test_noncanonical_nonfinite_invalid_or_recovery_time_refuses(self):
        for value in ('NaN', '+Inf', '2026-09-30T18%3A44%3A16Z', '2026-09-30T18:44:16+00:00', '2026-02-30T18:44:16Z', '2026-09-30T18:44:16.0Z'):
            with self.subTest(value=value), self.assertRaises(ValueError): rb.validate_metrics_time(value, 'normal')
        with self.assertRaises(ValueError): rb.validate_metrics_time('2026-09-30T18:44:16Z', 'recovery')

if __name__ == '__main__': unittest.main()
