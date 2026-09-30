"""Inert accounting layout: no bus, service or cgroup operations."""
import configparser
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnostic_config import DiagnosticSpec


class AccountingSliceTests(unittest.TestCase):
    def test_fresh_no_process_slice_bounds_all_four_services_and_emitter(self):
        with tempfile.TemporaryDirectory(prefix='aeon-accounting-render-') as directory:
            spec = DiagnosticSpec('ProofA', aeon_root=Path(directory))
            self.assertEqual(getattr(spec, 'accounting_slice_name', None),
                             'app-aeonTempoCheckProofA.slice')
            rendered = spec.render(774)
            self.assertEqual(len(rendered), 12)
            parser = configparser.ConfigParser(interpolation=None)
            parser.read_string(rendered['units/' + spec.accounting_slice_name])
            self.assertEqual(parser['Unit']['StopWhenUnneeded'], 'no')
            self.assertEqual(parser['Slice']['MemoryAccounting'], 'true')
            self.assertNotIn('CPUAccounting', parser['Slice'])
            self.assertEqual(parser['Slice']['MemoryMax'], '2176M')
            self.assertEqual(parser['Slice']['MemorySwapMax'], '0')
            self.assertEqual(parser['Slice']['CPUQuota'], '225%')
            self.assertEqual(parser['Slice']['TasksMax'], '576')
            self.assertNotIn('Service', parser)
            self.assertNotIn('Install', parser)
            for name in spec.unit_names.values():
                unit = configparser.ConfigParser(interpolation=None)
                unit.read_string(rendered['units/' + name])
                self.assertEqual(unit['Service']['Slice'], spec.accounting_slice_name)
            self.assertFalse(spec.state.exists())


if __name__ == '__main__':
    unittest.main()
