import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('emit_synthetic', Path(__file__).resolve().parents[1]/'emit_synthetic.py')
emitter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(emitter)


class EmitterBoundsTests(unittest.TestCase):
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
