"""Opt-in metadata-only boundary for the existing Hermes provider.

This module creates no provider, exporter, socket or background thread.
"""
import re
import os
from opentelemetry import context, trace
from opentelemetry.context import Context, _SUPPRESS_INSTRUMENTATION_KEY
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.trace import SpanContext, Status, TraceState

_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z')
_IDS = frozenset({'session.id', 'gen_ai.conversation.id', 'gen_ai.tool.call.id', 'hermes.api_request.id'})
_COUNTS = frozenset({'hermes.turn.number', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'hermes.api.retry_count'})
_ENUMS = {
    'gen_ai.operation.name': frozenset({'chat','execute_tool','lookup','verify','approval'}),
    'gen_ai.provider.name': frozenset({'openai'}),
    'gen_ai.request.model': frozenset({'synthetic-model'}),
    'gen_ai.response.model': frozenset({'synthetic-model'}),
    'gen_ai.tool.name': frozenset({'terminal','read_file','memory_lookup'}),
    'hermes.tool.outcome': frozenset({'completed','error','blocked','timeout','cancelled','abstained','verified','rejected'}),
    'error.type': frozenset({'TimeoutError','ConnectionError','RuntimeError','ValueError','CancelledError'}),
    'hermes.lookup.result': frozenset({'eligible','ineligible','absent','abstained'}),
    'hermes.verification.result': frozenset({'verified','rejected','not_evaluated'}),
}
_NAMES = frozenset({'agent','cron','llm','api','tool','approval','lookup','decision','subagent','skill','error','sdk'})

def _metadata_context(span_context):
    if span_context is None:
        return None
    return SpanContext(trace_id=span_context.trace_id, span_id=span_context.span_id,
                       is_remote=span_context.is_remote, trace_flags=span_context.trace_flags,
                       trace_state=TraceState())

def metadata_span(span):
    """Copy a finished span into a bounded, content-free export representation."""
    attrs = {}
    for key, value in (span.attributes or {}).items():
        if key in _IDS and isinstance(value, str) and _ID.fullmatch(value):
            attrs[key] = value
        elif key in _COUNTS and type(value) is int and 0 <= value <= 2**63 - 1:
            attrs[key] = value
        elif key in _ENUMS and isinstance(value, str) and value in _ENUMS[key]:
            attrs[key] = value
    prefix = span.name.split('.', 1)[0]
    name = prefix if prefix in _NAMES else 'other'
    if span.instrumentation_scope and span.instrumentation_scope.name == 'opentelemetry.instrumentation.openai':
        name = 'sdk'
    return ReadableSpan(
        name=name, context=_metadata_context(span.context), parent=_metadata_context(span.parent),
        resource=Resource({'service.name':'hermes-offline-pilot'}), attributes=attrs,
        events=(), links=(), kind=span.kind,
        status=Status(span.status.status_code), start_time=span.start_time, end_time=span.end_time,
        instrumentation_scope=InstrumentationScope('hermes.metadata-pilot'),
    )

class MetadataOnlyProcessor(SpanProcessor):
    """Sanitize before the existing batch processor; failed copies are dropped."""
    def __init__(self, inner):
        self.inner = inner
        self.dropped_spans = 0
    def on_start(self, span, parent_context=None):
        # BatchSpanProcessor has no start work; never give downstream raw content.
        pass
    def on_end(self, span):
        try:
            self.inner.on_end(metadata_span(span))
        except Exception:
            self.dropped_spans += 1
    def shutdown(self):
        try:
            self.inner.shutdown()
        except Exception:
            pass
    def force_flush(self, timeout_millis=30000):
        try:
            return self.inner.force_flush(timeout_millis)
        except Exception:
            return False

def execution_bridge(plugin, request, next_call, session_id='', task_id='', api_request_id='', **unused):
    """Bind only an exact live API attempt, inline at the existing middleware seam.

    Missing ancestry suppresses auto instrumentation, never execution. No request
    mutation or retry occurs. Worker propagation remains Hermes's copied context.
    """
    try:
        current = context.set_value('override_enable_content_tracing', False, Context())
        try:
            ids_valid = all(isinstance(value, str) and value
                            for value in (task_id, session_id, api_request_id))
            parent = plugin.spans.get_span('api:' + task_id) if ids_valid else None
            attrs = parent.attributes if parent is not None else {}
            matched = bool(session_id and api_request_id and parent is not None
                           and parent.is_recording() and parent.get_span_context().is_valid
                           and attrs.get('session.id') == session_id
                           and attrs.get('hermes.api_request.id') == api_request_id)
        except Exception:
            matched = False
        if matched:
            current = trace.set_span_in_context(parent, current)
        else:
            current = context.set_value(_SUPPRESS_INSTRUMENTATION_KEY, True, current)
        token = context.attach(current)
    except Exception:
        return next_call(request)
    try:
        return next_call(request)
    finally:
        try:
            context.detach(token)
        except Exception:
            pass

def pilot_config_valid(config):
    """Reject content stores, extra signals and inherited transport credentials."""
    disabled = ('capture_previews','capture_full_prompts','capture_full_responses',
                'capture_sender_id','capture_logs','capture_conversation_history',
                'dashboard_live','emit_genai_metrics','host_metrics')
    if config.content_capture != 'off' or any(getattr(config, k) for k in disabled):
        return False
    if config.headers or config.global_tags or config.resource_attributes:
        return False
    if len(config.backends or []) != 1:
        return False
    b = config.backends[0]
    if b.type != 'otlp' or b.endpoint != 'http://127.0.0.1:14318/v1/traces' or b.metrics is not False or b.logs is not False or b.headers:
        return False
    unsafe_env = ('OTEL_EXPORTER_OTLP_HEADERS','OTEL_EXPORTER_OTLP_TRACES_HEADERS',
                  'OTEL_PYTHON_EXPORTER_OTLP_HTTP_TRACES_CREDENTIAL_PROVIDER',
                  'OTEL_EXPORTER_OTLP_CLIENT_KEY','OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE',
                  'OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY','OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE',
                  'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy')
    if any(os.environ.get(k) for k in unsafe_env):
        return False
    if os.environ.get('HERMES_OTEL_DEBUG','').strip().lower() in ('1','true','yes','on'):
        return False
    return True
