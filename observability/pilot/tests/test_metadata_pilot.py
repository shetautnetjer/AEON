"""Real SDK metadata-export and caller-context contracts; no network/model/DB."""
import importlib.util
import sys
import unittest
from unittest.mock import patch
import threading
import contextvars
from pathlib import Path
from types import SimpleNamespace
from opentelemetry import context, trace
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import NonRecordingSpan, SpanContext, Status, StatusCode, TraceFlags, TraceState
PAYLOAD = Path(__file__).resolve().parents[1] / 'patches/payload/metadata_pilot.py'

class MetadataPilotTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(PAYLOAD.is_file(), 'metadata pilot not implemented')
        spec = importlib.util.spec_from_file_location('metadata_pilot', PAYLOAD)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.exporter = InMemorySpanExporter()
        self.provider = TracerProvider(resource=Resource({'service.name':'private name', 'private.tag':'CANARY private payload'}), shutdown_on_exit=False)
        self.provider.add_span_processor(self.module.MetadataOnlyProcessor(SimpleSpanProcessor(self.exporter)))
        self.addCleanup(self.provider.shutdown)
        self.tracer = self.provider.get_tracer('private scope CANARY', attributes={'private.scope':'CANARY private payload'})

    def test_export_preserves_ancestry_and_opaque_ids_without_content(self):
        canary = 'CANARY private payload </script>'
        with self.tracer.start_as_current_span('agent', attributes={'session.id':'session-a'}) as root:
            with self.tracer.start_as_current_span('approval.' + canary, attributes={
                'session.id':'session-a', 'gen_ai.tool.call.id':'tool-a',
                'gen_ai.operation.name':'approval', 'hermes.tool.command':canary,
                'input.value':canary, 'gen_ai.request.stop_sequences':[canary],
                'gen_ai.usage.input_tokens':12, 'gen_ai.request.model':canary,
                'gen_ai.provider.name':'openai', 'hermes.tool.outcome':'error',
            }) as child:
                child.add_event(canary, {'private.event':canary})
                child.set_status(Status(StatusCode.ERROR, canary))
        spans = self.exporter.get_finished_spans()
        self.assertEqual([s.name for s in spans], ['approval', 'agent'])
        exported = spans[0]
        self.assertEqual(exported.parent.span_id, root.get_span_context().span_id)
        self.assertEqual(exported.context.trace_id, root.get_span_context().trace_id)
        self.assertEqual(exported.attributes['session.id'], 'session-a')
        self.assertEqual(exported.attributes['gen_ai.usage.input_tokens'], 12)
        self.assertEqual(exported.status.status_code, StatusCode.ERROR)
        self.assertIsNone(exported.status.description)
        self.assertEqual(exported.events, ())
        self.assertEqual(exported.links, ())
        self.assertNotIn(canary, repr([s.to_json() for s in spans]))
        self.assertEqual(dict(exported.resource.attributes), {'service.name':'hermes-offline-pilot'})
        self.assertEqual(exported.instrumentation_scope.name, 'hermes.metadata-pilot')

    def test_otlp_encoder_omits_tracestate_while_preserving_span_identity(self):
        canary = 'CANARY_PAYLOAD'
        parent = SpanContext(trace_id=0x1234, span_id=0x5678, is_remote=True,
            trace_flags=TraceFlags(TraceFlags.SAMPLED), trace_state=TraceState([('pilot', canary)]))
        parent_context = trace.set_span_in_context(NonRecordingSpan(parent), context.Context())
        with self.tracer.start_as_current_span('api.synthetic-model', context=parent_context) as api:
            raw_context = api.get_span_context()
            self.assertEqual(raw_context.trace_state.get('pilot'), canary)
        exported, = self.exporter.get_finished_spans()
        self.assertNotIn(canary.encode(), encode_spans([exported]).SerializeToString())
        for actual, original in ((exported.context, raw_context), (exported.parent, parent)):
            self.assertEqual(actual.trace_state, TraceState())
            self.assertEqual(actual.trace_id, original.trace_id)
            self.assertEqual(actual.span_id, original.span_id)
            self.assertEqual(actual.trace_flags, original.trace_flags)
            self.assertEqual(actual.is_remote, original.is_remote)
        self.assertEqual(api.get_span_context().trace_state.get('pilot'), canary)
        self.assertEqual(parent.trace_state.get('pilot'), canary)

    def test_exact_attempt_bridge_detaches_without_repeating_provider_errors(self):
        self.assertTrue(hasattr(self.module, 'execution_bridge'), 'caller-context bridge not implemented')
        api = self.tracer.start_span('api.synthetic-model', attributes={
            'session.id':'session-a', 'hermes.api_request.id':'attempt-a'})
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=lambda key: api if key == 'api:task-a' else None))
        request = {'messages':['CANARY private payload']}
        before = trace.get_current_span().get_span_context()
        calls = []
        def sdk(request_seen):
            calls.append(request_seen)
            self.assertIs(request_seen, request)
            with self.tracer.start_as_current_span('sdk') as child:
                self.assertEqual(child.parent.span_id, api.get_span_context().span_id)
            raise TimeoutError('CANARY private payload')
        with self.assertRaises(TimeoutError):
            self.module.execution_bridge(plugin, request=request, next_call=sdk,
                session_id='session-a', task_id='task-a', api_request_id='attempt-a')
        self.assertEqual(calls, [request])
        self.assertEqual(trace.get_current_span().get_span_context(), before)
        api.end()

    def test_failed_context_attachment_does_not_block_or_repeat_execution(self):
        calls = []
        request = {'messages':['synthetic']}
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=lambda key: None))
        with patch.object(self.module.context, 'attach', side_effect=RuntimeError('synthetic failure')):
            result = self.module.execution_bridge(plugin, request=request,
                next_call=lambda r: calls.append(r) or 'result', session_id='s', task_id='t', api_request_id='a')
        self.assertEqual(result, 'result')
        self.assertEqual(calls, [request])

    def test_failed_context_preparation_does_not_repeat_or_swallow_provider_errors(self):
        api = self.tracer.start_span('api.synthetic-model', attributes={
            'session.id':'session-a', 'hermes.api_request.id':'attempt-a'})
        self.addCleanup(api.end)
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=lambda key:api))
        for owner, name in ((self.module.context, 'set_value'), (self.module.trace, 'set_span_in_context')):
            with self.subTest(preparation=name):
                request = {'messages':['synthetic']}
                calls = []
                failure = TimeoutError('synthetic provider failure')
                before = context.get_current()
                def downstream(request_seen):
                    calls.append(request_seen)
                    self.assertIs(request_seen, request)
                    raise failure
                with patch.object(owner, name, side_effect=RuntimeError('synthetic telemetry failure')):
                    try:
                        self.module.execution_bridge(plugin, request, downstream,
                            session_id='session-a', task_id='task-a', api_request_id='attempt-a')
                    except Exception as caught:
                        self.assertIs(caught, failure)
                    else:
                        self.fail('provider failure was swallowed')
                self.assertEqual(calls, [request])
                self.assertEqual(request, {'messages':['synthetic']})
                self.assertIs(context.get_current(), before)

    def test_missing_empty_and_nonstring_ids_skip_lookup_without_repeating_errors(self):
        api = self.tracer.start_span('api.synthetic-model', attributes={
            'session.id':'session-a', 'hermes.api_request.id':'attempt-a'})
        self.addCleanup(api.end)
        lookups = []
        def get_span(key):
            lookups.append(key)
            return api
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=get_span))
        valid = {'session_id':'session-a', 'task_id':'task-a', 'api_request_id':'attempt-a'}
        class TaskLike:
            def __str__(self):
                return 'task-a'
        variants = [dict(valid, task_id=value) for value in ('', None, 0, False, [], {}, TaskLike())]
        missing_task = dict(valid)
        del missing_task['task_id']
        variants.insert(0, missing_task)
        for field in ('session_id', 'api_request_id'):
            variants.extend(dict(valid, **{field:value}) for value in ('', None, 0, False, [], {}, TaskLike()))
        for identifiers in variants:
            with self.subTest(identifiers=identifiers):
                lookups.clear()
                request = {'messages':['CANARY private payload']}
                calls = []
                before = context.get_current()
                failure = TimeoutError('synthetic failure')
                def downstream(request_seen):
                    calls.append(request_seen)
                    self.assertIs(request_seen, request)
                    self.assertTrue(context.get_value(context._SUPPRESS_INSTRUMENTATION_KEY))
                    self.assertFalse(trace.get_current_span().get_span_context().is_valid)
                    self.assertIs(context.get_value('override_enable_content_tracing'), False)
                    raise failure
                with self.assertRaises(TimeoutError) as caught:
                    self.module.execution_bridge(plugin, request, downstream, **identifiers)
                self.assertIs(caught.exception, failure)
                self.assertEqual(lookups, [])
                self.assertEqual(calls, [request])
                self.assertEqual(request, {'messages':['CANARY private payload']})
                self.assertIs(context.get_current(), before)

    def test_selected_sdk_span_has_distinct_noncanonical_category(self):
        with self.provider.get_tracer('opentelemetry.instrumentation.openai').start_as_current_span('openai.chat'):
            pass
        self.assertEqual(self.exporter.get_finished_spans()[0].name,'sdk')

    def test_two_sessions_copied_worker_contexts_do_not_mix(self):
        barrier = threading.Barrier(2)
        results = []
        errors = []
        apis = {sid:self.tracer.start_span('api.synthetic-model',attributes={'session.id':sid,'hermes.api_request.id':'attempt-'+sid}) for sid in ['session-a','session-b']}
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=lambda key: apis.get(key.removeprefix('api:'))))
        def caller(sid):
            try:
                def execute(request):
                    copied = contextvars.copy_context()
                    def worker():
                        barrier.wait(timeout=3)
                        with self.tracer.start_as_current_span('sdk') as child:
                            results.append((sid,child.parent.span_id))
                    thread = threading.Thread(target=lambda:copied.run(worker))
                    thread.start();thread.join(timeout=5)
                    self.assertFalse(thread.is_alive())
                self.module.execution_bridge(plugin,request={},next_call=execute,session_id=sid,task_id=sid,api_request_id='attempt-'+sid)
                self.assertFalse(trace.get_current_span().get_span_context().is_valid)
            except BaseException as exc:errors.append(exc)
        threads=[threading.Thread(target=caller,args=(sid,)) for sid in apis]
        for t in threads:t.start()
        for t in threads:t.join(timeout=7)
        for p in apis.values():p.end()
        self.assertEqual(errors,[])
        self.assertEqual(dict(results),{sid:p.get_span_context().span_id for sid,p in apis.items()})

    def test_missing_wrong_attempt_and_ended_parent_do_not_invent_ancestry(self):
        p = self.tracer.start_span('api.synthetic-model',attributes={'session.id':'session-a','hermes.api_request.id':'attempt-a'})
        plugin = SimpleNamespace(spans=SimpleNamespace(get_span=lambda key:p if key=='api:task-a' else None))
        variants=[('session-b','task-a','attempt-a'),('session-a','task-a','wrong'),('session-a','absent','attempt-a')]
        def downstream(request):
            self.assertTrue(context.get_value(context._SUPPRESS_INSTRUMENTATION_KEY))
            self.assertFalse(trace.get_current_span().get_span_context().is_valid)
            self.assertIs(context.get_value('override_enable_content_tracing'),False)
            return request
        for sid,task,attempt in variants:
            request={}
            self.assertIs(self.module.execution_bridge(plugin,request,downstream,session_id=sid,task_id=task,api_request_id=attempt),request)
        p.end()
        self.module.execution_bridge(plugin,{},downstream,session_id='session-a',task_id='task-a',api_request_id='attempt-a')

if __name__ == '__main__': unittest.main()
