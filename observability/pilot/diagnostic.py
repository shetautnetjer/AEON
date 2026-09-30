"""Inert by default; one explicitly approved, finite synthetic diagnostic."""
from __future__ import annotations

import math
import hashlib
import json
import argparse
import re
import time
from dataclasses import dataclass, field
from collections import Counter
import readback


def validate_emission(emitted):
    if not isinstance(emitted, dict): raise ValueError('invalid_emission_receipt')
    requirements = dict(span_count=25, canonical_api_count=5, synthetic_only=True,
                        dry_run=False, outage_expected=False, export_verdict='SUCCESS',
                        provider_instance_count=1, sensitive_sentinel_absent=True,
                        utility_qualified=False, release_evaluated=False)
    if any(type(emitted.get(k)) is not type(v) or emitted[k] != v for k,v in requirements.items()):
        raise ValueError('emission_contract_mismatch')
    wanted = readback.validate_expected(emitted.get('expected_spans'))
    categories = {'agent':6,'llm':5,'api':5,'sdk':5,'tool':1,'lookup':1,'decision':2}
    if emitted.get('categories') != categories or Counter(s['name'] for s in emitted['expected_spans']) != categories:
        raise ValueError('emission_category_mismatch')
    traces = sorted({tid for tid, _ in wanted})
    if len(traces) != 6: raise ValueError('emission_trace_count_not_6')
    return traces


def validate_readback(emitted, receipt):
    traces = validate_emission(emitted)
    if not isinstance(receipt, dict) or receipt.get('passed') is not True or receipt.get('span_count') != 25:
        raise ValueError('readback_not_passed')
    wanted = {prefix+tid:tid for tid in traces for prefix in (
        'http://127.0.0.1:13200/api/traces/',
        'http://127.0.0.1:13000/api/datasources/proxy/uid/aeon-pilot-tempo/api/traces/')}
    found = {}
    for item in receipt.get('endpoints', []):
        url = item.get('url')
        if url not in wanted: continue
        if url in found: raise ValueError('duplicate_trace_endpoint')
        verified = readback.verify_trace(item.get('response'), emitted['expected_spans'], wanted[url])
        if verified != item.get('verified'): raise ValueError('trace_summary_mismatch')
        found[url] = verified
    if set(found) != set(wanted): raise ValueError('missing_trace_endpoints')
    counts = receipt.get('canonical_metrics', {})
    queries = counts.get('queries', [])
    if len(queries) != 2: raise ValueError('missing_metric_denominators')
    verified = readback.verify_metrics(queries[0]['response'], queries[1]['response'], emitted['expected_spans'])
    if counts.get('verified') != verified: raise ValueError('metric_summary_mismatch')
    return {'traces':6, 'spans':25, 'trace_endpoints':12, **verified}


def finite(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('invalid_clock_or_allowance')
    return value


@dataclass(frozen=True)
class Budget:
    """A single wall/monotonic window; restart never grants a new lifetime."""
    clock: object
    wall_deadline: float = field(init=False)
    mono_deadline: float = field(init=False)
    mono_start: float = field(init=False)
    _last_mono: float = field(init=False,repr=False)

    def __post_init__(self):
        wall, mono = finite(self.clock.time()), finite(self.clock.monotonic())
        object.__setattr__(self, 'wall_deadline', wall + 900)
        object.__setattr__(self, 'mono_deadline', mono + 900)
        object.__setattr__(self, 'mono_start', mono)
        object.__setattr__(self, '_last_mono', mono)

    def remaining(self):
        wall, mono = finite(self.clock.time()), finite(self.clock.monotonic())
        if mono < self._last_mono: raise ValueError('monotonic_clock_rollback')
        object.__setattr__(self, '_last_mono', mono)
        return max(0, min(900, self.wall_deadline - wall, self.mono_deadline - mono))

    def phase(self, seconds):
        if finite(seconds) <= 0: raise ValueError('invalid_phase_allowance')
        if self.remaining() < seconds + 95:
            raise TimeoutError('cleanup_reserve_required')
        return seconds

    def runtime_cap(self):
        cap = math.floor(self.remaining() - 95 - 30)
        if cap < 1:
            raise TimeoutError('runtime_reserve_required')
        return min(775, cap)

    def cleanup_timeout(self):
        return min(95, self.remaining())


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class Runner:
    def __init__(self, backend, clock):
        self.backend, self.clock = backend, clock
        self.used = False

    def run(self):
        if self.used: raise ValueError('diagnostic_runner_already_used')
        self.used = True
        checks = {name:'not_run' for name in ('preflight','prepare','start','limits','configuration','emit',
                  'initial','first_graceful_stop','restart','restart_limits','durability','final_graceful_stop','cleanup')}
        checks['lifetime']='not_run'
        result = {'passed':False,'checks':checks,'utility_qualified':False,'release_evaluated':False}
        budget = None
        stage = 'preflight'
        flow_complete = False
        def step(name, seconds, action):
            nonlocal stage
            stage = name
            value = action(budget.phase(seconds) if budget else seconds)
            if budget and budget.remaining() < 95:
                raise TimeoutError('cleanup_reserve_consumed')
            checks[name] = 'passed'
            return value
        try:
            step('preflight',30,lambda t:self.backend.preflight(timeout=t))
            step('prepare',30,lambda t:self.backend.prepare(timeout=t))
            budget = Budget(self.clock)
            result['window'] = {'wall_deadline':budget.wall_deadline,'monotonic_deadline':budget.mono_deadline,
                                'maximum_seconds':900,'cleanup_reserve_seconds':95}
            stage = 'start'
            record_window = getattr(self.backend,'record_window',None)
            if record_window is not None: record_window(result['window'])
            step('start',30,lambda t:self.backend.start(runtime_seconds=budget.runtime_cap(),timeout=t))
            step('limits',10,lambda t:self.backend.verify_active(timeout=t))
            step('configuration',10,lambda t:self.backend.effective_config(timeout=t))
            def emit(timeout):
                value = self.backend.emit(timeout=timeout)
                validate_emission(value)
                return value
            emitted = step('emit',70,emit)
            original = fingerprint(emitted)
            result['emitted_receipt_sha256'] = original
            def read(stage,timeout):
                if fingerprint(emitted) != original: raise ValueError('emitted_receipt_changed')
                value = self.backend.readback(emitted,timeout=timeout,stage=stage)
                if fingerprint(emitted) != original: raise ValueError('emitted_receipt_changed')
                return validate_readback(emitted,value)
            result['initial_denominators'] = step('initial',60,lambda t:read('initial',t))
            stage = 'first_graceful_stop'
            self.backend.quiesce(seconds=40,timeout=budget.phase(41))
            def stop(timeout):
                proof=self.backend.stop_tempo(timeout=timeout)
                validate_graceful(proof,peers_required=True)
                return proof
            result['first_stop'] = step('first_graceful_stop',95,stop)
            step('restart',30,lambda t:self.backend.restart_tempo(runtime_seconds=budget.runtime_cap(),timeout=t))
            step('restart_limits',10,lambda t:self.backend.verify_active(timeout=t))
            result['durability_denominators'] = step('durability',60,lambda t:read('durability',t))
            stage='final_graceful_stop'
            self.backend.quiesce(seconds=40,timeout=budget.phase(41))
            flow_complete=True
        except BaseException as error:
            checks[stage]='failed'
            result['failure']={'stage':stage,'error_class':safe_error(error)}
        finally:
            try:
                timeout=budget.cleanup_timeout() if budget else 30
            except (ValueError,TypeError):
                timeout=0
            try:
                result['cleanup']=self.backend.cleanup(timeout=timeout)
                validate_cleanup(result['cleanup'])
                if flow_complete:
                    validate_graceful(result['cleanup'].get('graceful_tempo'))
                checks['cleanup']='passed'
                if flow_complete: checks['final_graceful_stop']='passed'
            except BaseException as error:
                checks['cleanup']='failed'
                if flow_complete: checks['final_graceful_stop']='failed'
                result['cleanup_failure']={'error_class':safe_error(error)}
            if budget:
                try:
                    budget.remaining()  # Also validate clock integrity after cleanup.
                    result['elapsed_seconds']=max(finite(self.clock.monotonic())-budget.mono_start,
                        finite(self.clock.time())-(budget.wall_deadline-900))
                    checks['lifetime']='passed' if 0 <= result['elapsed_seconds'] <= 900 else 'failed'
                except (ValueError,TypeError):
                    result['elapsed_seconds']=None
                    checks['lifetime']='failed'
        result['passed']=all(value=='passed' for value in checks.values())
        try:
            self.backend.record(result)
        except BaseException as error:
            result['passed']=False
            result['record_failure']={'error_class':safe_error(error)}
        return result


def safe_error(error):
    return type(error).__name__ if type(error) in (ValueError,TimeoutError,RuntimeError,OSError,
             TypeError,KeyError,KeyboardInterrupt,SystemExit) else 'Exception'


def validate_graceful(proof, *, peers_required=False):
    if not isinstance(proof,dict): raise ValueError('stop_proof_missing')
    expected=dict(result='success',exit_code=0,forced_kill=False,oom_events=0,completion_milestone=True,
                  cgroup_pids=[],pids_alive=[],listeners=[])
    if any(type(proof.get(k)) is not type(v) or proof[k]!=v for k,v in expected.items()):
        raise ValueError('graceful_stop_unproven')
    if proof.get('signal') not in (None,0) or type(proof.get('signal')) is bool:
        raise ValueError('graceful_stop_signal')
    if peers_required and proof.get('peers_unchanged') is not True:
        raise ValueError('peer_identity_changed')


def validate_cleanup(proof):
    if not isinstance(proof,dict): raise ValueError('cleanup_proof_missing')
    expected=dict(passed=True,owned_emitter_stopped=True,remaining_pids=[],remaining_groups=[],
                  remaining_listeners=[],collectors_unchanged=True,original_preserved=True)
    if any(type(proof.get(k)) is not type(v) or proof[k]!=v for k,v in expected.items()):
        raise ValueError('cleanup_unproven')


def main(argv=None, *, backend_factory=None, clock=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id',required=True)
    parser.add_argument('--run-approved',action='store_true',help='Explicitly activate only after creator runtime approval')
    parser.add_argument('--approval-reference',help='Nonsecret reference to the separately recorded runtime approval')
    args=parser.parse_args(argv)
    if args.run_approved and (not args.approval_reference or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}',args.approval_reference)):
        parser.error('activation requires a bounded nonsecret approval reference')
    from diagnostic_config import DiagnosticSpec
    spec=DiagnosticSpec(args.run_id)
    if not args.run_approved:
        print(json.dumps({'mode':'inert_plan','runtime_approval_recorded':False,'maximum_seconds':900,
                          'max_spans':25,'max_restarts':1,'memory_max_mib':2176,'cpu_quota_percent':225,
                          'tempo_stop_seconds':90,'cleanup_reserve_seconds':95,'state':str(spec.state),
                          'capture':'synthetic_metadata_only','utility_qualified':False,'release_evaluated':False}))
        return 0
    if backend_factory is None:
        from diagnostic_system import SystemBackend
        backend_factory=SystemBackend
    backend=backend_factory(spec)
    backend.approval_reference=args.approval_reference
    result=Runner(backend,clock or time).run()
    print(json.dumps(result,allow_nan=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
