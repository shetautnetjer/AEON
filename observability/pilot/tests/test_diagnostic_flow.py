"""Offline tests of finite diagnostic orchestration, using synthetic receipts."""
import importlib.util
import copy
import contextlib
import io
import json
from unittest.mock import Mock
import sys
import unittest
from pathlib import Path
from test_pilot_readback import av, metrics


def fixture():
    expected, bodies = [], {}
    for case in range(6):
        tid = f'{case + 1:032x}'
        names = ['agent', 'llm', 'api', 'sdk'] if case < 5 else ['agent', 'tool', 'lookup', 'decision', 'decision']
        spans = []
        for n, name in enumerate(names):
            sid, parent = f'{n+1:016x}', f'{n:016x}' if n else ''
            status = 'ERROR' if name == 'api' and case in (1, 4) else 'UNSET'
            attrs = {'session.id': 'synthetic-session', 'hermes.turn.number': 1}
            if name == 'api':
                attrs.update({'gen_ai.operation.name': 'chat', 'hermes.tool.outcome': 'error' if status == 'ERROR' else 'completed'})
            expected.append(dict(trace_id=tid, span_id=sid, parent_span_id=parent, name=name, status=status, attributes=attrs))
            output = dict(attrs)
            if name == 'api': output.update(operation=attrs['gen_ai.operation.name'], outcome=attrs['hermes.tool.outcome'])
            spans.append(dict(traceId=tid, spanId=sid, parentSpanId=parent, name=name, startTimeUnixNano='1', endTimeUnixNano='2', status={'code': 2 if status == 'ERROR' else 0}, attributes=[av(k,v) for k,v in output.items()]))
        bodies[tid] = {'batches':[{'resource':{'attributes':[av('service.name','hermes-offline-pilot'),av('deployment.environment.name','synthetic')]},'scopeSpans':[{'scope':{'name':'aeon.offline.synthetic','version':'1'},'spans':spans}]}]}
    receipt = dict(expected_spans=expected, span_count=25, canonical_api_count=5,
                   categories={'agent':6,'llm':5,'api':5,'sdk':5,'tool':1,'lookup':1,'decision':2},
                   synthetic_only=True, dry_run=False, outage_expected=False, export_verdict='SUCCESS',
                   provider_instance_count=1, sensitive_sentinel_absent=True,
                   utility_qualified=False, release_evaluated=False)
    return receipt, bodies


def readback_fixture(emitted, bodies):
    items = []
    summaries = []
    for tid, body in bodies.items():
        result = diag.readback.verify_trace(body, emitted['expected_spans'], tid)
        summaries.append(result)
        for prefix in ('http://127.0.0.1:13200/api/traces/',
                       'http://127.0.0.1:13000/api/datasources/proxy/uid/aeon-pilot-tempo/api/traces/'):
            items.append({'url':prefix+tid, 'response':copy.deepcopy(body), 'verified':copy.deepcopy(result)})
    return dict(passed=True, span_count=25, endpoints=items, traces=summaries,
                canonical_metrics={'verified':{'calls':5,'errors':2,'duration_count':5,'series':2},
                                   'queries':[{'response':metrics('aeon_pilot_calls_total')},
                                              {'response':metrics('aeon_pilot_duration_count')}]})

P = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(P))
try:
    import diagnostic as diag
except ModuleNotFoundError:
    diag = None


class Clock:
    def __init__(self):
        self.wall = 1000.
        self.mono = 20.
    def time(self): return self.wall
    def monotonic(self): return self.mono
    def advance(self, seconds):
        self.wall += seconds
        self.mono += seconds


class BudgetTests(unittest.TestCase):
    def test_one_absolute_window_reserves_cleanup_and_startup(self):
        self.assertIsNotNone(diag, 'finite diagnostic controller is missing')
        clock = Clock()
        budget = diag.Budget(clock)
        self.assertEqual(budget.remaining(), 900)
        self.assertEqual(budget.runtime_cap(), 775)
        self.assertEqual(budget.phase(70), 70)
        clock.advance(740)
        self.assertEqual(budget.runtime_cap(), 35)
        with self.assertRaises(TimeoutError): budget.phase(70)
        self.assertEqual(budget.cleanup_timeout(), 95)
        clock.advance(160)
        self.assertEqual(budget.cleanup_timeout(), 0)

    def test_clock_changes_cannot_extend_or_reset_window(self):
        clock = Clock()
        budget = diag.Budget(clock)
        clock.advance(100)
        clock.wall -= 500
        self.assertEqual(budget.remaining(), 800)
        clock.wall += 1400
        self.assertEqual(budget.remaining(), 0)
        with self.assertRaises(AttributeError): budget.wall_deadline += 900
        for value in (float('nan'), float('inf'), True):
            clock = Clock(); clock.mono = value
            with self.subTest(value=value), self.assertRaises(ValueError): diag.Budget(clock)
        clock = Clock(); budget = diag.Budget(clock); clock.mono -= 1
        with self.assertRaises(ValueError): budget.remaining()
        for allowance in (True, -1, 0, float('nan'), 806):
            with self.subTest(allowance=allowance), self.assertRaises((ValueError, TimeoutError)):
                diag.Budget(Clock()).phase(allowance)

    def test_monotonic_rollback_after_progress_cannot_restore_spent_budget(self):
        clock=Clock(); budget=diag.Budget(clock)
        clock.advance(100); self.assertEqual(budget.remaining(),800)
        clock.mono-=1
        with self.assertRaises(ValueError): budget.remaining()


class EvidenceTests(unittest.TestCase):
    def test_emission_contract_requires_exact_bounded_synthetic_batch(self):
        self.assertTrue(hasattr(diag, 'validate_emission'), 'exact batch verifier missing')
        emitted, _ = fixture()
        self.assertEqual(len(diag.validate_emission(emitted)), 6)
        for key, value in [('span_count',24), ('canonical_api_count',4),('provider_instance_count',2),
                           ('synthetic_only',False), ('dry_run',True),('outage_expected',True),
                           ('export_verdict','FAILURE'),('sensitive_sentinel_absent',False),('utility_qualified',True),
                           ('release_evaluated',True),('categories',{'agent':25})]:
            changed = copy.deepcopy(emitted); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): diag.validate_emission(changed)
        changed = copy.deepcopy(emitted)
        for span in changed['expected_spans']: span['trace_id'] = f'{1:032x}'
        with self.assertRaises(ValueError): diag.validate_emission(changed)

    def test_durability_revalidates_exact_raw_spans_and_metric_denominators(self):
        self.assertTrue(hasattr(diag,'validate_readback'), 'durability verifier missing')
        emitted, bodies = fixture(); receipt = readback_fixture(emitted, bodies)
        self.assertEqual(diag.validate_readback(emitted,receipt)['spans'],25)
        changed = copy.deepcopy(receipt); changed['endpoints'].pop()
        with self.assertRaises(ValueError): diag.validate_readback(emitted,changed)

        changed = copy.deepcopy(receipt); changed['endpoints'].append(changed['endpoints'][0])
        with self.assertRaises(ValueError): diag.validate_readback(emitted,changed)
        for field, value in [('parentSpanId','0000000000000009'),('status',{'code':1}),
                             ('attributes',[av('session.id','other')])]:
            changed=copy.deepcopy(receipt)
            changed['endpoints'][0]['response']['batches'][0]['scopeSpans'][0]['spans'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError): diag.validate_readback(emitted,changed)
        changed = copy.deepcopy(receipt)
        changed['canonical_metrics']['queries'][0]['response']['data']['result'][0]['value'][1]='4'
        with self.assertRaises(ValueError): diag.validate_readback(emitted,changed)

def stopped():
    return dict(result='success', exit_code=0, signal=0, forced_kill=False, oom_events=0,
                completion_milestone=True, cgroup_pids=[], pids_alive=[], listeners=[], peers_unchanged=True)


class Backend:
    """Fake external adapter only; deadlines and validators are production code."""
    def __init__(self, clock):
        self.clock = clock; self.calls = []; self.batches = []
        self.receipt, self.bodies = fixture()
        self.bad_stage = None; self.bad_stop = False; self.bad_cleanup = False
        self.extra_delay = {}; self.mutate_stage = None
    def call(self,name,timeout):
        self.calls.append((name,timeout))
        self.clock.advance(timeout + self.extra_delay.get(name,0))
        if self.bad_stage == name: raise RuntimeError('secret exception must not appear')
    def preflight(self,timeout): self.call('preflight',timeout)
    def prepare(self,timeout): self.call('prepare',timeout)
    def start(self,runtime_seconds,timeout): self.cap=runtime_seconds; self.call('start',timeout)
    def verify_active(self,timeout): self.call('verify',timeout)
    def effective_config(self,timeout): self.call('config',timeout)
    def emit(self,timeout): self.call('emit',timeout); return self.receipt
    def readback(self,emitted,timeout,stage):
        self.call(stage,timeout); self.batches.append(copy.deepcopy(emitted))
        if self.mutate_stage == stage: emitted['expected_spans'][0]['name']='tool'
        return readback_fixture(emitted,self.bodies)
    def quiesce(self,seconds,timeout): self.call('quiesce',timeout)
    def stop_tempo(self,timeout):
        self.call('stop',timeout); result=stopped()
        if self.bad_stop: result.update(result='timeout',forced_kill=True,signal=9)
        return result
    def restart_tempo(self,runtime_seconds,timeout): self.recap=runtime_seconds; self.call('restart',timeout)
    def cleanup(self,timeout):
        self.call('cleanup',timeout)
        return dict(passed=not self.bad_cleanup,graceful_tempo=stopped(),owned_emitter_stopped=True,
                    remaining_pids=[],remaining_groups=[],remaining_listeners=[],collectors_unchanged=True,
                    original_preserved=True)
    def record(self,result): self.result=copy.deepcopy(result)


class RunnerTests(unittest.TestCase):
    def test_single_batch_survives_one_conditional_restart_within_original_window(self):
        self.assertTrue(hasattr(diag,'Runner'), 'diagnostic orchestration missing')
        clock=Clock(); backend=Backend(clock)
        runner=diag.Runner(backend,clock)
        result=runner.run()
        self.assertTrue(result['passed'])
        names=[name for name,_ in backend.calls]
        self.assertEqual(names.count('emit'),1)
        self.assertEqual(names.count('restart'),1)
        self.assertEqual(names[-1],'cleanup')
        self.assertLess(backend.recap,backend.cap)
        self.assertEqual(backend.batches[0],backend.batches[1])
        self.assertFalse(result['utility_qualified'])
        self.assertFalse(result['release_evaluated'])
        self.assertLessEqual(result['elapsed_seconds'],900)
        self.assertEqual(result['checks']['durability'],'passed')
        self.assertEqual(result,backend.result)
        with self.assertRaises(ValueError): runner.run()

    def test_unproven_stop_always_cleans_up_and_never_restarts(self):
        clock=Clock(); backend=Backend(clock); backend.bad_stop=True
        result=diag.Runner(backend,clock).run()
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks']['first_graceful_stop'],'failed')
        self.assertEqual(result['checks']['restart'],'not_run')
        self.assertEqual([n for n,_ in backend.calls][-1],'cleanup')
        self.assertNotIn('restart',[n for n,_ in backend.calls])
        self.assertEqual(result['checks']['cleanup'],'passed')

    def test_cleanup_and_final_stop_proofs_cannot_be_claimed_from_command_success(self):
        for key,value in [('passed',False),('owned_emitter_stopped',False),('collectors_unchanged',False),
                          ('original_preserved',False),('remaining_pids',['99']),('remaining_groups',['owned']),
                          ('remaining_listeners',[13200]),('graceful_tempo',dict(stopped(),result='timeout'))]:
            clock=Clock(); backend=Backend(clock); cleanup=backend.cleanup
            def invalid(timeout):
                receipt=cleanup(timeout); receipt[key]=value; return receipt
            backend.cleanup=invalid
            with self.subTest(key=key):
                result=diag.Runner(backend,clock).run()
                self.assertFalse(result['passed'])
                self.assertEqual(result['checks']['cleanup'],'failed')

    def test_every_failed_phase_attempts_bounded_cleanup_without_secret_error_text(self):
        for stage in ('preflight','prepare','start','verify','config','emit','initial','quiesce','restart','durability'):
            clock=Clock(); backend=Backend(clock); backend.bad_stage=stage
            with self.subTest(stage=stage):
                result=diag.Runner(backend,clock).run()
                self.assertFalse(result['passed'])
                self.assertEqual(backend.calls[-1][0],'cleanup')
                self.assertLessEqual(backend.calls[-1][1],95)
                self.assertNotIn('secret',repr(result))
                self.assertEqual(result['checks']['durability'],'failed' if stage=='durability' else 'not_run')

    def test_consumed_reserve_does_not_grant_new_cleanup_window(self):
        clock=Clock(); backend=Backend(clock); backend.extra_delay['emit']=820
        result=diag.Runner(backend,clock).run()
        self.assertFalse(result['passed'])
        self.assertEqual(backend.calls[-1],('cleanup',0))
        self.assertNotIn('restart',[n for n,_ in backend.calls])
        self.assertGreater(result['elapsed_seconds'],900)

    def test_cleanup_overrun_cannot_be_reported_as_finite_success(self):
        clock=Clock(); backend=Backend(clock); backend.extra_delay['cleanup']=400
        result=diag.Runner(backend,clock).run()
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks']['lifetime'],'failed')
        self.assertGreater(result['elapsed_seconds'],900)

    def test_durability_cannot_mutate_original_emission_receipt(self):
        clock=Clock(); backend=Backend(clock); backend.mutate_stage='durability'
        result=diag.Runner(backend,clock).run()
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks']['durability'],'failed')

    def test_graceful_gate_requires_every_stop_condition(self):
        for key,value in [('result','timeout'),('exit_code',1),('signal',9),('forced_kill',True),
                          ('oom_events',1),('completion_milestone',False),('cgroup_pids',['99']),
                          ('pids_alive',['99']),('listeners',[13200]),('peers_unchanged',False)]:
            proof=stopped(); proof[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): diag.validate_graceful(proof,peers_required=True)
        with self.assertRaises(ValueError): diag.validate_graceful({})


class CommandTests(unittest.TestCase):
    def test_default_plan_has_no_runtime_effects_and_activation_requires_reference(self):
        self.assertTrue(hasattr(diag,'main'), 'inert diagnostic CLI missing')
        factory=Mock(side_effect=AssertionError('runtime adapter forbidden'))
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(diag.main(['--run-id','offlineTest'],backend_factory=factory),0)
        plan=json.loads(output.getvalue())
        self.assertEqual(plan['mode'],'inert_plan')
        self.assertEqual(plan['maximum_seconds'],900)
        self.assertEqual(plan['max_spans'],25)
        self.assertFalse(plan['runtime_approval_recorded'])
        factory.assert_not_called()
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            diag.main(['--run-id','offlineTest','--run-approved'],backend_factory=factory)
        factory.assert_not_called()

    def test_explicit_activation_is_injectable_and_never_needed_for_offline_tests(self):
        self.assertTrue(hasattr(diag,'main'), 'inert diagnostic CLI missing')
        clock=Clock(); backend=Backend(clock); factory=Mock(return_value=backend)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            code=diag.main(['--run-id','offlineTest','--run-approved','--approval-reference','syntheticTestOnly'],
                           backend_factory=factory,clock=clock)
        self.assertEqual(code,0)
        self.assertTrue(json.loads(output.getvalue())['passed'])
        self.assertEqual(factory.call_count,1)



if __name__ == '__main__': unittest.main()
