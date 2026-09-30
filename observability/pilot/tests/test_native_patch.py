"""Patched native hook/provider tests in an isolated Python-only source fixture."""
import unittest
from types import SimpleNamespace
from pathlib import Path
import yaml
from unittest.mock import patch
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from hermes_otel.plugin_config import BackendConfig, HermesOtelConfig, load_config
from hermes_otel.tracer import HermesOTelPlugin
from opentelemetry import trace

class NativePatchTests(unittest.TestCase):
    def config(self, **changes):
        values = dict(metadata_only_export=True,content_capture='off',capture_previews=False,capture_full_prompts=False,
            capture_full_responses=False,capture_sender_id=False,capture_logs=False,
            capture_conversation_history=False,dashboard_live=False,emit_genai_metrics=False,
            host_metrics=False,backends=[BackendConfig(type='otlp',endpoint='http://127.0.0.1:14318/v1/traces',metrics=False,logs=False)],
            span_batch_max_queue_size=64,span_batch_max_export_batch_size=32,span_batch_schedule_delay_ms=100,
            span_batch_export_timeout_ms=1000,force_flush_wait_ms=100)
        values.update(changes)
        return HermesOtelConfig(**values)

    def test_metadata_mode_is_opt_in_and_rejects_content_before_exporter_creation(self):
        self.assertTrue(hasattr(HermesOtelConfig(), 'metadata_only_export'), 'native opt-in patch not applied')
        self.assertFalse(HermesOtelConfig().metadata_only_export)
        plugin = HermesOTelPlugin(self.config(capture_previews=True))
        with patch('hermes_otel.tracer.OTLPSpanExporter') as exporter:
            self.assertFalse(plugin.init())
        exporter.assert_not_called()

    def test_authored_synthetic_config_reaches_native_privacy_guard(self):
        config_path = Path(__file__).resolve().parents[1]/'config/hermes_otel.synthetic.yaml'
        config = load_config(config_path)
        self.assertTrue(config.metadata_only_export)
        self.assertEqual(config.content_capture,'off')
        self.assertEqual(config.sample_rate,1.0)
        plugin = HermesOTelPlugin(config)
        self.addCleanup(plugin.shutdown)
        with patch('hermes_otel.tracer.OTLPSpanExporter',return_value=InMemorySpanExporter()):
            self.assertTrue(plugin.init())
        self.assertFalse(plugin._live_active)
        self.assertFalse(plugin._metric_readers)

    def test_metadata_otlp_exporter_uses_isolated_session_and_bounded_timeout(self):
        exporters = []
        def create_exporter(**kwargs):
            exporter = OTLPSpanExporter(**kwargs)
            exporters.append(exporter)
            return exporter
        plugin = HermesOTelPlugin(self.config())
        self.addCleanup(plugin.shutdown)
        with patch('hermes_otel.tracer.OTLPSpanExporter', side_effect=create_exporter):
            self.assertTrue(plugin.init())
        self.assertEqual(len(exporters), 1)
        self.assertFalse(exporters[0]._session.trust_env)
        self.assertEqual(exporters[0]._timeout, 1.0)

    def test_metadata_init_uses_fixed_resource_without_ambient_detectors(self):
        exporter = InMemorySpanExporter()
        plugin = HermesOTelPlugin(self.config())
        self.addCleanup(plugin.shutdown)
        with patch.object(plugin, '_build_resource', side_effect=AssertionError('ambient resource detector path')) as build, \
                patch('hermes_otel.tracer.OTLPSpanExporter', return_value=exporter):
            self.assertTrue(plugin.init())
        build.assert_not_called()
        self.assertEqual(dict(plugin._tracer_provider.resource.attributes),
            {'service.name':'hermes-offline-pilot'})

    def test_metadata_mode_rejects_inherited_credentials_before_exporter_creation(self):
        credential_env = ('OTEL_PYTHON_EXPORTER_OTLP_HTTP_TRACES_CREDENTIAL_PROVIDER',
            'OTEL_EXPORTER_OTLP_CLIENT_KEY', 'OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE',
            'OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY', 'OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE')
        for key in credential_env:
            with self.subTest(environment_key=key):
                plugin = HermesOTelPlugin(self.config())
                self.addCleanup(plugin.shutdown)
                with patch.dict('os.environ', {key:'synthetic-unused-credential'}), \
                        patch('hermes_otel.tracer.OTLPSpanExporter') as exporter:
                    self.assertFalse(plugin.init())
                exporter.assert_not_called()
                self.assertFalse(plugin.is_enabled)
                self.assertIsNone(plugin._tracer_provider)

    def test_invalid_metadata_reinit_disables_and_discards_existing_pipeline(self):
        exporter = InMemorySpanExporter()
        plugin = HermesOTelPlugin(self.config())
        self.addCleanup(plugin.shutdown)
        with patch('hermes_otel.tracer.OTLPSpanExporter', return_value=exporter) as constructor:
            self.assertTrue(plugin.init())
            self.assertTrue(plugin.is_enabled)
            self.assertIsNotNone(plugin._tracer_provider)
            plugin.config = self.config(capture_previews=True)
            with patch('hermes_otel.tracer.install_sdk_log_forwarding') as log_forwarding:
                self.assertFalse(plugin.init())
            log_forwarding.assert_not_called()
        self.assertEqual(constructor.call_count, 1)
        self.assertFalse(plugin.is_enabled)
        self.assertIsNone(plugin._tracer_provider)
        self.assertIsNone(plugin.tracer)
        self.assertEqual(plugin._span_processors, [])

    def test_native_hooks_existing_provider_and_real_middleware_export_only_metadata(self):
        import hermes_otel
        from hermes_otel import hooks
        from hermes_cli.middleware import run_llm_execution_middleware
        from hermes_cli.plugins import PluginContext, PluginManager
        from hermes_cli.plugins_manifest import PluginManifest
        exporter = InMemorySpanExporter()
        plugin = HermesOTelPlugin(self.config())
        self.addCleanup(plugin.shutdown)
        with patch('hermes_otel.tracer.OTLPSpanExporter', return_value=exporter):
            self.assertTrue(plugin.init())
        manifest_path = Path(hermes_otel.__file__).parent/'plugin.yaml'
        manifest_data = yaml.safe_load(manifest_path.read_text())
        manager = PluginManager()
        manager._discovered = True
        ctx = PluginContext(PluginManifest(name='hermes_otel',version='1.17.0',path=str(manifest_path.parent)),manager)
        with patch('hermes_otel.tracer._tracer',plugin), patch.object(plugin,'init',return_value=True):
            hermes_otel.register(ctx)
        self.assertEqual(len(manager._middleware['llm_execution']),1)
        self.assertEqual(set(manager._middleware),set(manifest_data.get('provides_middleware',[])))
        canary = 'CANARY private payload <sentinel>'
        with patch('hermes_otel.tracer._tracer',plugin):
            hooks.on_session_start('session-a','synthetic-model','cli')
            hooks.on_pre_llm_call('session-a',canary,[],True,'synthetic-model','cli')
            pre = dict(task_id='task-a',session_id='session-a',platform='cli',model='synthetic-model',
                provider='openai',base_url='',api_mode='chat_completions',api_call_count=1,
                message_count=1,tool_count=0,approx_input_tokens=1,request_char_count=1,max_tokens=1,
                api_request_id='attempt-a',request_messages=[{'role':'user','content':canary}],stop_sequences=[canary])
            hooks.on_pre_api_request(**pre)
            parent = plugin.spans.get_span('api:task-a')
            self.assertEqual(parent.attributes['hermes.api_request.id'],'attempt-a')
            request = {'messages':[canary]}
            received = []
            def sdk(r):
                received.append(r)
                with plugin._tracer_provider.get_tracer('opentelemetry.instrumentation.openai').start_as_current_span('sdk') as child:
                    self.assertEqual(child.parent.span_id,parent.get_span_context().span_id)
                    child.set_attribute('gen_ai.input.messages',canary)
                return 'synthetic result'
            with patch('hermes_cli.plugins._delivery_manager',return_value=manager):
                result = run_llm_execution_middleware(request,sdk,session_id='session-a',task_id='task-a',api_request_id='attempt-a')
            self.assertEqual(result,'synthetic result')
            self.assertEqual(received,[request])
            hooks.on_pre_tool_call('terminal',{'command':canary},'tool-a',session_id='session-a',tool_call_id='tool-a')
            hooks.on_post_tool_call('terminal',{'command':canary},canary,'tool-a',session_id='session-a',tool_call_id='tool-a',status='error')
            hooks.on_pre_approval_request(command=canary,description=canary,pattern_key=canary,session_id='session-a',tool_call_id='tool-a')
            hooks.on_post_approval_response(command=canary,pattern_key=canary,session_id='session-a',tool_call_id='tool-a',choice='deny')
            plugin.spans.pop_parent(session_id='session-a')
            plugin.end_span('api:task-a',status='error',error_message=canary)
            hooks.on_post_llm_call('session-a',canary,canary,[],'synthetic-model','cli')
            hooks.on_session_end('session-a',False,False,'synthetic-model','cli',failed=True,error_message=canary)
        self.assertTrue(plugin._tracer_provider.force_flush(1000))
        spans = exporter.get_finished_spans()
        self.assertEqual(sum(s.name=='api' for s in spans),1)
        self.assertEqual(sum(s.name=='sdk' for s in spans),1)
        self.assertNotIn(canary,repr([s.to_json() for s in spans]))
        self.assertFalse(plugin._live_active)
        self.assertFalse(plugin._metric_readers)
        self.assertFalse(plugin._log_processors)
        self.assertFalse(plugin.spans.has_span('session:session-a'))

if __name__ == '__main__':unittest.main()
