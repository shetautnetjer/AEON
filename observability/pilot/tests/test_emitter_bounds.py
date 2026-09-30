import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from requests.exceptions import ConnectionError, ReadTimeout
from opentelemetry.sdk.trace.export import SpanExportResult

SPEC = importlib.util.spec_from_file_location('emit_synthetic', Path(__file__).resolve().parents[1]/'emit_synthetic.py')
emitter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(emitter)


class EmitterBoundsTests(unittest.TestCase):
    def test_expected_outage_connection_error_is_bounded_and_shutdown_balanced(self):
        self.assertTrue(hasattr(emitter, 'export_synthetic'), 'expected-outage export adapter missing')
        error = ConnectionError('CANARY_RAW_TRANSPORT_EXCEPTION')
        exporter = SimpleNamespace(export=Mock(side_effect=error), shutdown=Mock())
        spans = [object()]
        result = emitter.export_synthetic(exporter, spans, expected_outage=True)
        self.assertEqual(result, {'export_verdict':'FAILURE', 'bounded_export_error_type':'ConnectionError'})
        self.assertNotIn('CANARY', str(result))
        exporter.export.assert_called_once_with(spans)
        exporter.shutdown.assert_called_once_with()

    def test_normal_and_unexpected_export_errors_propagate_identically_after_shutdown(self):
        self.assertTrue(hasattr(emitter, 'export_synthetic'), 'expected-outage export adapter missing')
        for outage, error in ((False, ConnectionError('normal fixture')),
                (True, ReadTimeout('timeout fixture')), (True, RuntimeError('audit denied')),
                (False, RuntimeError('unexpected fixture'))):
            with self.subTest(outage=outage, error_type=type(error).__name__):
                exporter = SimpleNamespace(export=Mock(side_effect=error), shutdown=Mock())
                with self.assertRaises(type(error)) as raised:
                    emitter.export_synthetic(exporter, [], expected_outage=outage)
                self.assertIs(raised.exception, error)
                exporter.export.assert_called_once_with([])
                exporter.shutdown.assert_called_once_with()

    def test_native_export_results_preserve_expected_verdict_and_shutdown(self):
        self.assertTrue(hasattr(emitter, 'export_synthetic'), 'expected-outage export adapter missing')
        for outage, verdict in ((False, SpanExportResult.SUCCESS), (True, SpanExportResult.FAILURE)):
            with self.subTest(outage=outage):
                exporter = SimpleNamespace(export=Mock(return_value=verdict), shutdown=Mock())
                self.assertEqual(emitter.export_synthetic(exporter, [], expected_outage=outage),
                    {'export_verdict':verdict.name})
                exporter.shutdown.assert_called_once_with()

    def test_unbounded_or_excess_resource_limits_are_rejected(self):
        valid = {'memory.max':str(256*1024**2),'memory.swap.max':'0','pids.max':'64','cpu.max':'25000 100000'}
        emitter.validate_emitter_limits(valid)
        for key, value in [('memory.max','max'),('memory.max',str(384*1024**2)),('memory.swap.max','max'),('pids.max','128'),('cpu.max','50000 100000')]:
            with self.subTest(key=key), self.assertRaises((AssertionError,ValueError)):
                emitter.validate_emitter_limits(valid|{key:value})

    def test_retry_and_error_case_denominators_are_explicit(self):
        valid = {'provider_calls':1,'context_balanced':True,'transport_calls':2,'retry_counts':[0,1]}
        emitter.validate_case('retry',valid)
        for change in [{'transport_calls':3},{'provider_calls':2},{'retry_counts':[0,0]},{'context_balanced':False}]:
            with self.assertRaises(AssertionError): emitter.validate_case('retry',valid|change)
        error = {'provider_calls':1,'context_balanced':True,'transport_calls':1,'error_type':'InternalServerError','same_error':True}
        emitter.validate_case('error',error)
        with self.assertRaises(AssertionError): emitter.validate_case('error',error|{'same_error':False})
        with self.assertRaises(AssertionError): emitter.validate_case('success',error)


if __name__ == '__main__': unittest.main()
