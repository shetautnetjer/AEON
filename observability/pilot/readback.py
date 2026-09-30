#!/usr/bin/env python3
"""Finite synthetic-only loopback readback. Importing this file performs no I/O."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.parse
import urllib.request

PORTS = {13200, 13000, 19090, 12346}
MAX_BYTES = 16 * 1024 * 1024
DISK_LIMIT = 10 * 1024**3
STATE = Path('/home/aya-hmw/Documents/ChatGPT/AEON/var/observability-pilot')
ARTIFACTS = Path('/home/aya-hmw/Documents/ChatGPT/AEON/artifacts/observability')
APPROVED_PYTHON = Path('/home/aya-hmw/.hermes/tools/python-3.14.7+20260901-linux-x64/bin/python3.14')
NAMES = {'agent', 'cron', 'llm', 'api', 'tool', 'approval', 'lookup', 'decision', 'subagent', 'skill', 'error', 'sdk', 'other'}
ATTRS = {'session.id', 'gen_ai.conversation.id', 'gen_ai.tool.call.id', 'hermes.api_request.id', 'hermes.turn.number', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'hermes.api.retry_count', 'gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.request.model', 'gen_ai.response.model', 'gen_ai.tool.name', 'hermes.tool.outcome', 'error.type', 'hermes.lookup.result', 'hermes.verification.result', 'operation', 'outcome'}
OPERATIONS = {'chat', 'execute_tool', 'lookup', 'verify', 'approval'}
OUTCOMES = {'completed', 'error', 'blocked', 'timeout', 'cancelled', 'abstained', 'verified', 'rejected'}
STATUS = {'UNSET': 0, 'OK': 1, 'ERROR': 2}
RESOURCE = {'service.name': 'hermes-offline-pilot', 'deployment.environment.name': 'synthetic'}
STATUS_LABELS = {'STATUS_CODE_UNSET', 'STATUS_CODE_OK', 'STATUS_CODE_ERROR', 'UNSET', 'OK', 'ERROR', 'Unset', 'Ok', 'Error'}
ERROR_LABELS = {'STATUS_CODE_ERROR', 'ERROR', 'Error'}


def reject(code):
    raise ValueError(code)


def no_canary(value):
    # Check keys as well as values, without copying forbidden content into errors.
    serialized = json.dumps(value, ensure_ascii=True).upper()
    if any(marker in serialized for marker in ('CANARY', 'SYNTHETIC_CONTENT_SENTINEL')):
        reject('canary_detected')


def fields(value, allowed, code):
    if not isinstance(value, dict) or set(value) - set(allowed):
        reject(code)


def normalize_id(value, size, *, parent=False):
    if value is None or value == '':
        if parent:
            return ''
        reject('missing_id')
    if not isinstance(value, str):
        reject('invalid_id_type')
    if re.fullmatch('[0-9a-fA-F]{' + str(size * 2) + '}', value):
        raw = bytes.fromhex(value)
    else:
        try:
            raw = base64.b64decode(value, validate=True)
        except (ValueError, TypeError):
            reject('invalid_id_encoding')
        if base64.b64encode(raw).decode('ascii') != value:
            reject('noncanonical_id_encoding')
    if len(raw) != size:
        reject('invalid_id_width')
    if not any(raw):
        if parent:
            return ''
        reject('invalid_zero_id')
    return raw.hex()


def status_code(value):
    if type(value) is int and value in (0, 1, 2):
        return value
    if isinstance(value, str):
        name = value.removeprefix('STATUS_CODE_')
        if name in STATUS:
            return STATUS[name]
    reject('invalid_status_code')


def scalar(value):
    if not isinstance(value, dict) or len(value) != 1:
        reject('invalid_attribute_value')
    key, item = next(iter(value.items()))
    if key == 'stringValue' and isinstance(item, str):
        return item
    if key == 'intValue' and (type(item) is int or isinstance(item, str) and re.fullmatch('-?[0-9]+', item)):
        return int(item)
    if key == 'boolValue' and type(item) is bool:
        return item
    if key == 'doubleValue' and type(item) in (int, float) and math.isfinite(item):
        return float(item)
    reject('invalid_attribute_scalar')


def attributes(value):
    if not isinstance(value, list) or len(value) > 32:
        reject('invalid_attribute_list')
    result = {}
    for entry in value:
        fields(entry, {'key', 'value'}, 'invalid_attribute_shape')
        key = entry.get('key')
        if not isinstance(key, str) or key in result:
            reject('duplicate_or_invalid_attribute')
        result[key] = scalar(entry.get('value'))
    return result


def typed_equal(left, right):
    return set(left) == set(right) and all(type(left[key]) is type(right[key]) and left[key] == right[key] for key in left)


def validate_expected(expected):
    no_canary(expected)
    if not isinstance(expected, list) or len(expected) != 25:
        reject('expected_span_count_not_25')
    result = {}
    for span in expected:
        fields(span, {'trace_id', 'span_id', 'parent_span_id', 'name', 'status', 'attributes'}, 'invalid_expected_span')
        if set(span) != {'trace_id', 'span_id', 'parent_span_id', 'name', 'status', 'attributes'}:
            reject('incomplete_expected_span')
        tid = normalize_id(span['trace_id'], 16)
        sid = normalize_id(span['span_id'], 8)
        parent = normalize_id(span['parent_span_id'], 8, parent=True)
        attrs = span['attributes']
        if span['name'] not in NAMES or not isinstance(attrs, dict) or set(attrs) - ATTRS:
            reject('unapproved_expected_metadata')
        if any(type(v) not in (str, int) for v in attrs.values()):
            reject('invalid_expected_metadata_type')
        if 'operation' in attrs and attrs['operation'] not in OPERATIONS or 'outcome' in attrs and attrs['outcome'] not in OUTCOMES:
            reject('unbounded_expected_dimension')
        attrs = dict(attrs)
        op, outcome = attrs.get('gen_ai.operation.name'), attrs.get('hermes.tool.outcome')
        if op in OPERATIONS:
            if 'operation' in attrs and attrs['operation'] != op: reject('expected_operation_alias_conflict')
            attrs['operation'] = op
        if outcome in OUTCOMES:
            if 'outcome' in attrs and attrs['outcome'] != outcome: reject('expected_outcome_alias_conflict')
            attrs['outcome'] = outcome
        key = (tid, sid)
        if key in result: reject('duplicate_expected_span')
        result[key] = {'trace_id': tid, 'span_id': sid, 'parent_span_id': parent, 'name': span['name'], 'status': status_code(span['status']), 'attributes': attrs}
    for item in result.values():
        if item['parent_span_id'] and (item['trace_id'], item['parent_span_id']) not in result:
            reject('dangling_expected_parent')
    apis = [s for s in result.values() if s['name'] == 'api']
    if len(apis) != 5 or sum(s['status'] == 2 for s in apis) != 2:
        reject('expected_canonical_counts_not_5_2')
    return result


def verify_trace(payload, expected, trace_id):
    no_canary(payload)
    all_expected = validate_expected(expected)
    trace_id = normalize_id(trace_id, 16)
    selected = {k: v for k, v in all_expected.items() if k[0] == trace_id}
    if not selected: reject('unknown_expected_trace')
    fields(payload, {'batches', 'resourceSpans'}, 'unknown_trace_envelope')
    if len(payload) != 1: reject('ambiguous_trace_envelope')
    groups = payload.get('batches', payload.get('resourceSpans'))
    if not isinstance(groups, list) or not groups: reject('empty_trace_groups')
    observed = {}
    for group in groups:
        fields(group, {'resource', 'scopeSpans', 'instrumentationLibrarySpans', 'schemaUrl'}, 'unknown_resource_group_field')
        if group.get('schemaUrl'): reject('resource_schema_url_present')
        resource = group.get('resource')
        fields(resource, {'attributes', 'droppedAttributesCount'}, 'unknown_resource_field')
        if not typed_equal(attributes(resource.get('attributes', [])), RESOURCE): reject('unapproved_resource_metadata')
        if resource.get('droppedAttributesCount', 0) != 0: reject('dropped_resource_metadata')
        if 'scopeSpans' in group and 'instrumentationLibrarySpans' in group: reject('ambiguous_scope_groups')
        scopes = group.get('scopeSpans', group.get('instrumentationLibrarySpans'))
        if not isinstance(scopes, list) or not scopes: reject('empty_scope_groups')
        for scope_group in scopes:
            fields(scope_group, {'scope', 'instrumentationLibrary', 'spans', 'schemaUrl'}, 'unknown_scope_group_field')
            if scope_group.get('schemaUrl'): reject('scope_schema_url_present')
            if 'scope' in scope_group and 'instrumentationLibrary' in scope_group: reject('ambiguous_scope')
            scope = scope_group.get('scope', scope_group.get('instrumentationLibrary'))
            fields(scope, {'name', 'version', 'attributes', 'droppedAttributesCount'}, 'unknown_scope_field')
            if scope.get('name') != 'aeon.offline.synthetic' or scope.get('version') != '1' or attributes(scope.get('attributes', [])) or scope.get('droppedAttributesCount', 0) != 0:
                reject('unapproved_scope_metadata')
            spans = scope_group.get('spans')
            if not isinstance(spans, list) or len(spans) > 1000: reject('invalid_span_list')
            for span in spans:
                fields(span, {'traceId', 'spanId', 'parentSpanId', 'name', 'kind', 'startTimeUnixNano', 'endTimeUnixNano', 'attributes', 'droppedAttributesCount', 'events', 'droppedEventsCount', 'links', 'droppedLinksCount', 'status', 'traceState', 'flags'}, 'unknown_span_field')
                if span.get('events') or span.get('links') or span.get('traceState'): reject('forbidden_span_content')
                for key in ('droppedAttributesCount', 'droppedEventsCount', 'droppedLinksCount'):
                    if span.get(key, 0) != 0: reject('dropped_span_metadata')
                stat = span.get('status', {})
                fields(stat, {'code', 'message'}, 'unknown_status_field')
                if stat.get('message'): reject('status_description_present')
                tid, sid = normalize_id(span.get('traceId'), 16), normalize_id(span.get('spanId'), 8)
                key = (tid, sid)
                if tid != trace_id or key in observed: reject('foreign_or_duplicate_span')
                attrs = attributes(span.get('attributes', []))
                if set(attrs) - ATTRS: reject('unapproved_span_attribute')
                for alias, allowed in (('operation', OPERATIONS), ('outcome', OUTCOMES)):
                    if alias in attrs and attrs[alias] not in allowed: reject('unbounded_span_dimension')
                item = {'trace_id': tid, 'span_id': sid, 'parent_span_id': normalize_id(span.get('parentSpanId'), 8, parent=True), 'name': span.get('name'), 'status': status_code(stat.get('code', 0)), 'attributes': attrs}
                observed[key] = item
    if set(observed) != set(selected): reject('trace_span_set_mismatch')
    for key, wanted in selected.items():
        actual = observed[key]
        if any(actual[k] != wanted[k] for k in ('parent_span_id', 'name', 'status')) or not typed_equal(actual['attributes'], wanted['attributes']):
            reject('trace_metadata_mismatch')
    return {'trace_id': trace_id, 'span_count': len(observed), 'spans': sorted(observed.values(), key=lambda s: s['span_id'])}


def vector(payload, *, buckets=False):
    no_canary(payload)
    if not isinstance(payload, dict) or payload.get('status') != 'success': reject('prometheus_request_failed')
    data = payload.get('data', {})
    if data.get('resultType') != 'vector' or not isinstance(data.get('result'), list) or len(data['result']) > 256: reject('invalid_metric_vector')
    rows = {}
    for entry in data['result']:
        labels, value = entry.get('metric'), entry.get('value')
        allowed = {'__name__', 'operation', 'outcome', 'status_code', 'job', 'instance'} | ({'le'} if buckets else set())
        if not isinstance(labels, dict) or set(labels) - allowed: reject('unapproved_metric_label')
        if any(not isinstance(v, str) for v in labels.values()): reject('invalid_metric_label_type')
        name = labels.get('__name__', '')
        if not re.fullmatch('aeon_pilot_[a-zA-Z0-9_:]+', name): reject('foreign_metric_name')
        if ('operation' in labels and labels['operation'] not in OPERATIONS or
                'outcome' in labels and labels['outcome'] not in OUTCOMES or
                labels.get('status_code') not in STATUS_LABELS): reject('unbounded_metric_dimension')
        if 'job' in labels and labels['job'] not in {'hermes-offline-pilot', 'aeon-pilot-alloy'}: reject('unapproved_metric_job')
        if 'instance' in labels and labels['instance'] not in {'127.0.0.1:12346', 'hermes-offline-pilot'}: reject('unapproved_metric_instance')
        if 'le' in labels and labels['le'] not in {'5', '10', '50', '100', '500', '1000', '5000', '15000', '0.005', '0.01', '0.05', '0.1', '0.5', '1', '15', '+Inf'}: reject('unapproved_histogram_bound')
        if not isinstance(value, list) or len(value) != 2: reject('invalid_metric_value')
        try: number = float(value[1])
        except (ValueError, TypeError): reject('invalid_metric_value')
        if not math.isfinite(number) or number < 0: reject('invalid_metric_value')
        normalized_labels = {k: v for k, v in labels.items() if k != '__name__'}
        key = tuple(sorted(normalized_labels.items()))
        if key in rows: reject('duplicate_metric_series')
        rows[key] = number
    return rows


def verify_metrics(calls, histogram, expected=None):
    call_rows, histogram_rows = vector(calls), vector(histogram)
    if any(not v.is_integer() for v in [*call_rows.values(), *histogram_rows.values()]): reject('fractional_metric_count')
    count, hcount = sum(call_rows.values()), sum(histogram_rows.values())
    errors = sum(value for key, value in call_rows.items() if dict(key)['status_code'] in ERROR_LABELS)
    if count != 5 or errors != 2 or hcount != 5 or call_rows != histogram_rows: reject('canonical_metric_counts_mismatch')
    if expected is not None:
        wanted = {}
        for span in validate_expected(expected).values():
            if span['name'] != 'api': continue
            labels = {'status_code': next(name for name, code in STATUS.items() if code == span['status'])}
            for key in ('operation', 'outcome'):
                if key in span['attributes']: labels[key] = span['attributes'][key]
            key = tuple(sorted(labels.items()))
            wanted[key] = wanted.get(key, 0) + 1
        actual = {}
        for labels, value in call_rows.items():
            labels = {k: v for k, v in labels if k not in {'job', 'instance'}}
            code = labels['status_code']
            labels['status_code'] = code.removeprefix('STATUS_CODE_').upper()
            key = tuple(sorted(labels.items()))
            actual[key] = actual.get(key, 0) + int(value)
        if actual != wanted: reject('receipt_metric_distribution_mismatch')
    return {'calls': int(count), 'errors': int(errors), 'duration_count': int(hcount), 'series': len(call_rows)}


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    try: port = parsed.port
    except ValueError: reject('invalid_url_port')
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.netloc != f'127.0.0.1:{port}' or port not in PORTS or parsed.username is not None or parsed.password is not None or parsed.fragment:
        reject('nonpilot_url')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        reject('redirect_refused')


def json_loads(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: reject('duplicate_json_key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: reject('nonfinite_json'))


def get(opener, url, deadline, *, text=False):
    validate_url(url)
    remaining = deadline - time.monotonic()
    if remaining <= 0: reject('poll_deadline_reached')
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with opener.open(req, timeout=min(3, remaining)) as response:
        if response.status != 200: reject('http_status_not_200')
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES: reject('response_too_large')
    return body.decode('utf-8') if text else json_loads(body)


def poll(opener, url, deadline, validator, *, text=False):
    attempts = 0
    last = 'not_attempted'
    while time.monotonic() < deadline:
        attempts += 1
        try:
            payload = get(opener, url, deadline, text=text)
            result = validator(payload)
            return {'url': url, 'attempts': attempts, 'verified': result, 'response': payload}
        except urllib.error.HTTPError as error:
            last = f'http_{error.code}'
        except (ValueError, urllib.error.URLError, TimeoutError, OSError) as error:
            last = str(error) if type(error) is ValueError and re.fullmatch('[a-z0-9_]+', str(error)) else type(error).__name__
        remaining = deadline - time.monotonic()
        if remaining <= 0: break
        time.sleep(min(1, remaining))
    reject('poll_failed_' + last)


def disk_usage(root=STATE, artifacts=ARTIFACTS, *, limit=DISK_LIMIT):
    roots = [Path(root), Path(artifacts)]
    if any(not p.is_dir() or p.is_symlink() for p in roots): reject('budget_root_missing_or_link')
    roots = [p.resolve() for p in roots]
    logical = allocated = links = 0
    seen = set()
    def account(path):
        nonlocal logical, allocated, links
        info = path.lstat()
        if info.st_uid != os.getuid(): reject('budget_inode_owner_mismatch')
        if stat.S_ISLNK(info.st_mode):
            links += 1
            try: target = path.resolve(strict=True)
            except (OSError, RuntimeError): reject('budget_link_unresolvable')
            internal = any(target.is_relative_to(p) for p in roots)
            python_link = (path.is_relative_to(roots[0]) and
                str(path.relative_to(roots[0])) in {'python/bin/python', 'python/bin/python3', 'python/bin/python3.14'} and target == APPROVED_PYTHON)
            if not internal and not python_link: reject('budget_link_escape_refused')
        elif not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            reject('budget_unexpected_inode_type')
        inode = (info.st_dev, info.st_ino)
        if inode not in seen:
            seen.add(inode)
            allocated += info.st_blocks * 512
            if stat.S_ISREG(info.st_mode): logical += info.st_size
        if max(logical, allocated) > limit: reject('disk_budget_exceeded')
    def unavailable(_): reject('budget_inventory_unavailable')
    for selected in roots:
        account(selected)
        for directory, dirs, files in os.walk(selected, followlinks=False, onerror=unavailable):
            for name in dirs + files: account(Path(directory) / name)
    return {'roots': [str(p) for p in roots], 'bytes': max(logical, allocated), 'logical_file_bytes': logical, 'allocated_bytes': allocated, 'symlinks_not_followed': links, 'unique_inodes': len(seen), 'limit_bytes': limit, 'hard_quota': False, 'approved_external_python_target_bytes_counted': False}


def run(emitted, phase):
    expected = emitted.get('expected_spans') if isinstance(emitted, dict) else None
    wanted = validate_expected(expected)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + 60
    evidence = {'phase': phase, 'capture': 'synthetic_metadata_only', 'metric_count_scope': 'Alloy connector reset before recovery' if phase == 'recovery' else 'first canonical synthetic batch', 'deadline_seconds': 60, 'endpoints': []}
    def keep(item): evidence['endpoints'].append(item); return item
    def ready(body):
        if not isinstance(body, str) or 'ready' not in body.lower(): reject('tempo_not_ready')
        return True
    keep(poll(opener, 'http://127.0.0.1:13200/ready', deadline, ready, text=True))
    def health(body):
        if body.get('database') != 'ok' or body.get('version') != '13.2.3': reject('grafana_health_mismatch')
        return {'database': 'ok', 'version': body['version']}
    keep(poll(opener, 'http://127.0.0.1:13000/api/health', deadline, health))
    for uid, kind, url in [('aeon-pilot-tempo', 'tempo', 'http://127.0.0.1:13200'), ('aeon-pilot-prometheus', 'prometheus', 'http://127.0.0.1:19090')]:
        def datasource(body, uid=uid, kind=kind, url=url):
            no_canary(body)
            if body.get('uid') != uid or body.get('type') != kind or body.get('url', '').rstrip('/') != url or body.get('access') != 'proxy' or body.get('readOnly') is not True: reject('anonymous_datasource_mismatch')
            return {'uid': uid, 'type': kind, 'url': url, 'anonymous_readback': True}
        keep(poll(opener, f'http://127.0.0.1:13000/api/datasources/uid/{uid}', deadline, datasource))
    trace_evidence = []
    for tid in sorted({key[0] for key in wanted}):
        direct = keep(poll(opener, 'http://127.0.0.1:13200/api/traces/' + tid, deadline, lambda payload, tid=tid: verify_trace(payload, expected, tid)))
        viewer = keep(poll(opener, 'http://127.0.0.1:13000/api/datasources/proxy/uid/aeon-pilot-tempo/api/traces/' + tid, deadline, lambda payload, tid=tid: verify_trace(payload, expected, tid)))
        if direct['verified'] != viewer['verified']: reject('tempo_grafana_readback_disagree')
        trace_evidence.append(direct['verified'])
    evidence['traces'] = trace_evidence
    evidence['span_count'] = sum(item['span_count'] for item in trace_evidence)
    selector = urllib.parse.urlencode({'match[]': '{__name__=~"aeon_pilot_.*"}'})
    def discovery(payload):
        names = payload.get('data')
        if payload.get('status') != 'success' or not isinstance(names, list) or not all(isinstance(n, str) and re.fullmatch('aeon_pilot_[a-zA-Z0-9_:]+', n) for n in names): reject('metric_discovery_mismatch')
        calls = [n for n in names if n.endswith('calls_total')]
        histograms = [n for n in names if 'duration' in n and n.endswith('_count')]
        if len(calls) != 1 or len(histograms) != 1: reject('canonical_metric_names_unavailable')
        return {'names': sorted(names), 'calls': calls[0], 'duration_count': histograms[0]}
    names = keep(poll(opener, 'http://127.0.0.1:19090/api/v1/label/__name__/values?' + selector, deadline, discovery))['verified']
    def query_url(name): return 'http://127.0.0.1:19090/api/v1/query?' + urllib.parse.urlencode({'query': '{__name__="' + name + '"}'})
    while time.monotonic() < deadline:
        try:
            calls = get(opener, query_url(names['calls']), deadline)
            histogram = get(opener, query_url(names['duration_count']), deadline)
            counts = verify_metrics(calls, histogram, expected)
            break
        except (ValueError, urllib.error.URLError, TimeoutError, OSError):
            remaining = deadline - time.monotonic()
            if remaining <= 0: reject('canonical_metrics_unavailable')
            time.sleep(min(1, remaining))
    else: reject('canonical_metrics_unavailable')
    evidence['canonical_metrics'] = {'verified': counts, 'queries': [{'url': query_url(names['calls']), 'response': calls}, {'url': query_url(names['duration_count']), 'response': histogram}]}
    for name in names['names']:
        response = get(opener, query_url(name), deadline)
        vector(response, buckets=name.endswith('_bucket'))
        evidence['endpoints'].append({'url': query_url(name), 'response': response, 'verified': 'bounded_labels'})
    evidence['disk'] = disk_usage(STATE)
    evidence['passed'] = True
    return evidence


def save(output, evidence):
    output = Path(output)
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.parent.is_symlink(): reject('output_parent_symlink')
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(evidence, handle, indent=2, allow_nan=False)
        handle.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emitted', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--phase', choices=['normal', 'recovery'], required=True)
    args = parser.parse_args()
    receipt = Path(args.emitted).read_bytes()
    if len(receipt) > 4 * 1024 * 1024: reject('emitted_receipt_too_large')
    try:
        evidence = run(json_loads(receipt), args.phase)
        exit_code = 0
    except (ValueError, urllib.error.URLError, OSError, TimeoutError, KeyError, TypeError) as error:
        reason = str(error) if type(error) is ValueError and re.fullmatch('[a-z0-9_]+', str(error)) else type(error).__name__
        evidence = {'phase': args.phase, 'passed': False, 'reason': reason, 'responses_retained': False}
        exit_code = 1
    evidence['emitted_receipt_sha256'] = hashlib.sha256(receipt).hexdigest()
    save(args.output, evidence)
    print(json.dumps({'phase': args.phase, 'passed': evidence['passed'], 'reason': evidence.get('reason'), 'evidence': str(args.output)}))
    return exit_code

if __name__ == '__main__':
    raise SystemExit(main())
