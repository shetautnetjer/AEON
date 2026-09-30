"""Real pinned OpenAI instrumentation against synthetic HTTP-only fixtures."""
from collections import Counter
import importlib.metadata
import importlib.util
from pathlib import Path
import unittest

HARNESS = Path(__file__).resolve().parents[1] / 'instrumentor_harness.py'


class OpenAIInstrumentorTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(HARNESS.is_file(), 'actual OpenAI instrumentor harness not implemented')
        try:
            version = importlib.metadata.version('opentelemetry-instrumentation-openai')
        except importlib.metadata.PackageNotFoundError:
            self.skipTest('requires the isolated pinned OpenAI instrumentor environment')
        self.assertEqual(version, '0.61.0')
        spec = importlib.util.spec_from_file_location('instrumentor_harness', HARNESS)
        self.harness_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.harness_module)

    def run_case(self, harness, *args, **kwargs):
        try:
            return harness.run_case(*args, **kwargs)
        except ValueError as exc:
            self.fail(str(exc))

    def test_success_has_one_sdk_child_and_content_off_before_metadata_filter(self):
        with self.harness_module.InstrumentorHarness() as harness:
            result = self.run_case(harness, 'success')
            self.assertEqual(result['transport_calls'], 1)
            self.assertEqual(result['provider_calls'], 1)
            self.assertEqual(result['output'], self.harness_module.CANARY)
            self.assertTrue(result['context_balanced'])
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1, 'sdk':1})
            api, = [span for span in spans if span.name == 'api']
            sdk, = [span for span in spans if span.name == 'sdk']
            self.assertEqual(sdk.parent.span_id, api.context.span_id)
            self.assertEqual(sdk.context.trace_id, api.context.trace_id)
            llm, = [span for span in spans if span.name == 'llm']
            agent, = [span for span in spans if span.name == 'agent']
            self.assertEqual(api.parent.span_id, llm.context.span_id)
            self.assertEqual(llm.parent.span_id, agent.context.span_id)
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))
            raw_sdk, = harness.raw_sdk_spans
            self.assertNotIn(self.harness_module.CANARY, raw_sdk.to_json())
            self.assertEqual(harness.raw.content_overrides, [False])

    def test_provider_error_is_not_retried_or_swallowed_and_exports_error_status(self):
        from opentelemetry.trace import StatusCode
        with self.harness_module.InstrumentorHarness() as harness:
            result = self.run_case(harness, 'error')
            self.assertEqual(result['error_type'], 'InternalServerError')
            self.assertTrue(result['same_error'])
            self.assertEqual(result['transport_calls'], 1)
            self.assertEqual(result['provider_calls'], 1)
            self.assertTrue(result['context_balanced'])
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1, 'sdk':1})
            api, = [span for span in spans if span.name == 'api']
            sdk, = [span for span in spans if span.name == 'sdk']
            self.assertEqual(api.status.status_code, StatusCode.ERROR)
            self.assertEqual(sdk.status.status_code, StatusCode.ERROR)
            self.assertEqual(sdk.parent.span_id, api.context.span_id)
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))

    def test_stream_exhaustion_flushes_one_sdk_span_without_content(self):
        from opentelemetry.trace import StatusCode
        with self.harness_module.InstrumentorHarness() as harness:
            result = self.run_case(harness, 'stream')
            self.assertEqual(result['output'], self.harness_module.CANARY)
            self.assertEqual(result['transport_calls'], 1)
            self.assertEqual(result['provider_calls'], 1)
            self.assertTrue(result['context_balanced'])
            self.assertTrue(result['stream_closed'])
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1, 'sdk':1})
            sdk, = [span for span in spans if span.name == 'sdk']
            api, = [span for span in spans if span.name == 'api']
            self.assertEqual(sdk.parent.span_id, api.context.span_id)
            self.assertEqual(sdk.status.status_code, StatusCode.OK)
            self.assertEqual(sdk.events, ())
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))
            raw_sdk, = harness.raw_sdk_spans
            self.assertNotIn(self.harness_module.CANARY, raw_sdk.to_json())

    def test_sdk_retry_keeps_one_canonical_attempt_and_one_sdk_child(self):
        with self.harness_module.InstrumentorHarness() as harness:
            result = self.run_case(harness, 'retry')
            self.assertEqual(result['output'], self.harness_module.CANARY)
            self.assertEqual(result['transport_calls'], 2)
            self.assertEqual(result['provider_calls'], 1)
            self.assertEqual(result['retry_counts'], [0, 1])
            self.assertTrue(result['context_balanced'])
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1, 'sdk':1})
            api, = [span for span in spans if span.name == 'api']
            sdk, = [span for span in spans if span.name == 'sdk']
            self.assertEqual(sdk.parent.span_id, api.context.span_id)
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))

    def test_cancelled_partial_stream_closes_once_and_detaches_caller_context(self):
        from opentelemetry.trace import StatusCode
        with self.harness_module.InstrumentorHarness() as harness:
            result = self.run_case(harness, 'cancel')
            self.assertEqual(result['error_type'], 'CancelledError')
            self.assertTrue(result['same_error'])
            self.assertEqual(result['transport_calls'], 1)
            self.assertEqual(result['provider_calls'], 1)
            self.assertTrue(result['context_balanced'])
            self.assertTrue(result['stream_closed'])
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1, 'sdk':1})
            api, = [span for span in spans if span.name == 'api']
            sdk, = [span for span in spans if span.name == 'sdk']
            self.assertEqual(api.status.status_code, StatusCode.ERROR)
            self.assertEqual(api.attributes['error.type'], 'CancelledError')
            self.assertEqual(sdk.parent.span_id, api.context.span_id)
            self.assertEqual(len(harness.raw_sdk_spans), 1)
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))

    def test_missing_wrong_and_stale_ancestry_suppress_sdk_without_blocking_provider(self):
        for case in ('missing', 'wrong', 'stale'):
            with self.subTest(ancestry=case), self.harness_module.InstrumentorHarness() as harness:
                result = self.run_case(harness, case)
                self.assertEqual(result['output'], self.harness_module.CANARY)
                self.assertEqual(result['transport_calls'], 1)
                self.assertEqual(result['provider_calls'], 1)
                self.assertTrue(result['suppressed'])
                self.assertTrue(result['context_balanced'])
                spans = harness.flush()
                self.assertEqual(Counter(span.name for span in spans), {'agent':1, 'llm':1, 'api':1})
                self.assertEqual(harness.raw_sdk_spans, [])
                self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))

    def test_two_sessions_copied_worker_contexts_keep_exact_api_parents(self):
        with self.harness_module.InstrumentorHarness() as harness:
            self.assertTrue(hasattr(harness, 'run_parallel'), 'copied-worker fixture not implemented')
            results = harness.run_parallel()
            self.assertEqual(set(results), {'session-a', 'session-b'})
            spans = harness.flush()
            self.assertEqual(Counter(span.name for span in spans), {'agent':2, 'llm':2, 'api':2, 'sdk':2})
            apis = {span.attributes['session.id']:span for span in spans if span.name == 'api'}
            self.assertNotEqual(apis['session-a'].context.trace_id, apis['session-b'].context.trace_id)
            for session_id, result in results.items():
                self.assertEqual(result['output'], self.harness_module.CANARY)
                self.assertEqual(result['transport_calls'], 1)
                self.assertEqual(result['provider_calls'], 1)
                self.assertTrue(result['context_balanced'])
                self.assertTrue(result['worker_context_balanced'])
                api = apis[session_id]
                self.assertEqual(result['worker_parent_span_id'], api.context.span_id)
                sdk, = [span for span in spans if span.name == 'sdk' and span.context.trace_id == api.context.trace_id]
                self.assertEqual(sdk.parent.span_id, api.context.span_id)
                self.assertEqual(api.attributes['hermes.api_request.id'], 'attempt-'+session_id)
            self.assertEqual(len(harness.raw_sdk_spans), 2)
            self.assertEqual(harness.raw.content_overrides, [False, False])
            self.assertNotIn(self.harness_module.CANARY, repr([span.to_json() for span in spans]))


if __name__ == '__main__':
    unittest.main()
