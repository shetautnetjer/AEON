"""Synthetic native-provider/OpenAI-instrumentor fixture; all HTTP is mocked."""
from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path
from asyncio import CancelledError
import json
import threading
from unittest.mock import patch

import httpx
from openai import OpenAI
from opentelemetry import context, trace
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.metrics import NoOpMeterProvider
from opentelemetry.sdk.trace import SpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import hermes_otel
from hermes_otel import hooks
from hermes_otel.plugin_config import load_config
from hermes_otel.tracer import HermesOTelPlugin
from hermes_cli.middleware import run_llm_execution_middleware
from hermes_cli.plugins import PluginContext, PluginManager
from hermes_cli.plugins_manifest import PluginManifest

CANARY = 'SYNTHETIC_CONTENT_SENTINEL'
MODEL = 'synthetic-model'
SDK_SCOPE = 'opentelemetry.instrumentation.openai.v1'


class _RawRecorder(SpanProcessor):
    def __init__(self):
        self.finished = []
        self.content_overrides = []
        self.lock = threading.Lock()

    def on_start(self, span, parent_context=None):
        if span.instrumentation_scope.name == SDK_SCOPE:
            with self.lock:
                self.content_overrides.append(context.get_value('override_enable_content_tracing'))

    def on_end(self, span):
        with self.lock:
            self.finished.append(span)

    def force_flush(self, timeout_millis=30000):
        return True


class InstrumentorHarness:
    def __init__(self):
        self.exporter = InMemorySpanExporter()
        self.raw = _RawRecorder()
        self.stack = ExitStack()

    def __enter__(self):
        try:
            self.stack.enter_context(patch.dict('os.environ', {
                'TRACELOOP_TRACE_CONTENT':'false', 'TRACELOOP_METRICS_ENABLED':'false'}))
            config = load_config(Path(__file__).parent/'config/hermes_otel.synthetic.yaml')
            self.plugin = HermesOTelPlugin(config)
            with patch('hermes_otel.tracer.OTLPSpanExporter', return_value=self.exporter):
                if not self.plugin.init():
                    raise RuntimeError('synthetic metadata provider initialization failed')
            self.stack.callback(self.plugin.shutdown)
            self.plugin._tracer_provider.add_span_processor(self.raw)
            self.stack.enter_context(patch('hermes_otel.tracer._tracer', self.plugin))
            self.manager = PluginManager()
            self.manager._discovered = True
            manifest_path = Path(hermes_otel.__file__).parent/'plugin.yaml'
            manifest = PluginManifest(name='hermes_otel', version='1.17.0', path=str(manifest_path.parent))
            with patch.object(self.plugin, 'init', return_value=True):
                hermes_otel.register(PluginContext(manifest, self.manager))
            self.stack.enter_context(patch('hermes_cli.plugins._delivery_manager', return_value=self.manager))
            self.instrumentor = OpenAIInstrumentor()
            if self.instrumentor.is_instrumented_by_opentelemetry:
                raise RuntimeError('synthetic harness requires an uninstrumented process')
            self.instrumentor.instrument(tracer_provider=self.plugin._tracer_provider,
                meter_provider=NoOpMeterProvider())
            self.stack.callback(self.instrumentor.uninstrument)
            return self
        except BaseException:
            self.stack.close()
            raise

    def __exit__(self, *exc):
        return self.stack.__exit__(*exc)

    @property
    def raw_sdk_spans(self):
        return [span for span in self.raw.finished
                if span.instrumentation_scope.name == SDK_SCOPE]

    def flush(self):
        if not self.plugin._tracer_provider.force_flush(1000):
            raise AssertionError('synthetic provider failed to flush')
        spans = self.exporter.get_finished_spans()
        if len(spans) > 1000:
            raise AssertionError('synthetic span budget exceeded')
        return spans

    def run_parallel(self):
        barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as callers:
            pending = {sid:callers.submit(self.run_case, 'copied', session_id=sid,
                task_id='task-'+sid, api_request_id='attempt-'+sid, barrier=barrier)
                for sid in ('session-a', 'session-b')}
            return {sid:future.result(timeout=6) for sid, future in pending.items()}

    def run_case(self, case, session_id='session-a', task_id='task-a', api_request_id='attempt-a', barrier=None):
        if case not in ('success', 'error', 'stream', 'retry', 'cancel', 'missing', 'wrong', 'stale', 'copied'):
            raise ValueError('unknown synthetic case')
        before = context.get_current()
        result = {'transport_calls':0, 'provider_calls':0}
        hooks.on_session_start(session_id, MODEL, 'cli')
        hooks.on_pre_llm_call(session_id, CANARY, [], True, MODEL, 'cli')
        request = {'model':MODEL, 'messages':[{'role':'user', 'content':CANARY}]}
        if case in ('stream', 'cancel'):
            request['stream'] = True
            request['stream_options'] = {'include_usage':True}
        hooks.on_pre_api_request(task_id=task_id, session_id=session_id, platform='cli', model=MODEL,
            provider='openai', base_url='http://synthetic.invalid/v1', api_mode='chat_completions',
            api_call_count=1, message_count=1, tool_count=0, approx_input_tokens=3,
            request_char_count=len(CANARY), max_tokens=8, api_request_id=api_request_id,
            request_messages=request['messages'])
        middleware_ids = {'session_id':session_id, 'task_id':task_id, 'api_request_id':api_request_id}
        if case == 'missing':
            middleware_ids.pop('task_id')
        elif case == 'wrong':
            middleware_ids['api_request_id'] = 'wrong-attempt'
        elif case == 'stale':
            self.plugin.spans.get_span('api:'+task_id).end()

        def transport(request_seen):
            result['transport_calls'] += 1
            if barrier is not None:
                barrier.wait(timeout=3)
            if case == 'retry':
                result.setdefault('retry_counts', []).append(int(request_seen.headers['x-stainless-retry-count']))
            if case == 'error' or (case == 'retry' and result['transport_calls'] == 1):
                return httpx.Response(500, request=request_seen,
                    headers={'retry-after-ms':'1'},
                    json={'error':{'message':CANARY, 'type':'synthetic_error', 'code':'synthetic'}})
            if case in ('stream', 'cancel'):
                chunks = []
                for content, finish in ((CANARY[:9], None), (CANARY[9:], None), ('', 'stop')):
                    chunks.append({'id':'synthetic-response', 'object':'chat.completion.chunk',
                        'created':1, 'model':MODEL, 'choices':[{'index':0,
                        'delta':{'role':'assistant', 'content':content}, 'finish_reason':finish}]})
                chunks.append({'id':'synthetic-response', 'object':'chat.completion.chunk',
                    'created':1, 'model':MODEL, 'choices':[],
                    'usage':{'prompt_tokens':3, 'completion_tokens':2, 'total_tokens':5}})
                body = ''.join('data: '+json.dumps(chunk)+'\n\n' for chunk in chunks)+'data: [DONE]\n\n'
                response = httpx.Response(200, request=request_seen,
                    headers={'content-type':'text/event-stream'}, content=body.encode())
                result['stream_response'] = response
                return response
            return httpx.Response(200, request=request_seen, json={
                'id':'synthetic-response', 'object':'chat.completion', 'created':1, 'model':MODEL,
                'choices':[{'index':0, 'message':{'role':'assistant', 'content':CANARY}, 'finish_reason':'stop'}],
                'usage':{'prompt_tokens':3, 'completion_tokens':2, 'total_tokens':5}})

        try:
            with OpenAI(api_key='synthetic-api-key', base_url='http://synthetic.invalid/v1',
                    max_retries=1 if case == 'retry' else 0,
                    http_client=httpx.Client(transport=httpx.MockTransport(transport), trust_env=False)) as client:
                def execute(request_seen):
                    result['provider_calls'] += 1
                    result['suppressed'] = bool(context.get_value(context._SUPPRESS_INSTRUMENTATION_KEY))
                    if request_seen is not request:
                        raise AssertionError('middleware changed request identity')
                    if case == 'copied':
                        copied = copy_context()
                        with ThreadPoolExecutor(max_workers=1) as workers:
                            return workers.submit(copied.run, call_sdk, request_seen).result(timeout=5)
                    return call_sdk(request_seen)

                def call_sdk(request_seen):
                    worker_before = context.get_current()
                    if case == 'copied':
                        result['worker_parent_span_id'] = trace.get_current_span().get_span_context().span_id
                    try:
                        if case in ('stream', 'cancel'):
                            with client.chat.completions.create(**request_seen) as stream:
                                if case == 'cancel':
                                    result['output'] = next(stream).choices[0].delta.content
                                    raise CancelledError('synthetic caller cancellation')
                                return ''.join(chunk.choices[0].delta.content or ''
                                    for chunk in stream if chunk.choices)
                        return client.chat.completions.create(**request_seen)
                    except BaseException as error:
                        result['provider_error'] = error
                        raise
                    finally:
                        result['worker_context_balanced'] = context.get_current() is worker_before
                response = run_llm_execution_middleware(request, execute, **middleware_ids)
                result['output'] = response if case == 'stream' else response.choices[0].message.content
                if case == 'stale':
                    self.plugin.spans.discard('api:'+task_id)
                hooks.on_post_api_request(task_id=task_id, session_id=session_id, platform='cli', model=MODEL,
                    provider='openai', base_url='http://synthetic.invalid/v1', api_mode='chat_completions',
                    api_call_count=1, api_duration=0.001, finish_reason='stop', message_count=1,
                    response_model=MODEL, usage={'input_tokens':3, 'output_tokens':2},
                    assistant_content_chars=len(CANARY), assistant_tool_call_count=0,
                    response_content=CANARY)
        except BaseException as error:
            result['error_type'] = type(error).__name__
            result['same_error'] = error is result.get('provider_error')
            hooks.on_api_request_error(task_id=task_id, session_id=session_id, platform='cli',
                model=MODEL, provider='openai', api_duration=0.001, status_code=getattr(error, 'status_code', None),
                retry_count=0, max_retries=0, retryable=False, reason=CANARY, error=error)
        finally:
            if 'stream_response' in result:
                result['stream_closed'] = result.pop('stream_response').is_closed
            hooks.on_post_llm_call(session_id, CANARY, result.get('output', ''), [], MODEL, 'cli')
            cancelled = result.get('error_type') == 'CancelledError'
            hooks.on_session_end(session_id, 'error_type' not in result, cancelled, MODEL, 'cli',
                failed='error_type' in result and not cancelled)
            result['context_balanced'] = context.get_current() is before
        return result
