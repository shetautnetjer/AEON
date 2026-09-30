"""Offline disk-inventory deadline regressions with synthetic clock and files."""
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_diagnostic_readback as support


rb = support.rb


class DiagnosticDiskDeadlineTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket, 'socket', side_effect=AssertionError('live socket forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.tmp = tempfile.TemporaryDirectory(prefix='aeon-disk-deadline-')
        self.addCleanup(self.tmp.cleanup)
        self.old, self.artifacts, self.new = (Path(self.tmp.name) / name
                                             for name in ('old', 'artifacts', 'new'))
        for root in (self.old, self.artifacts, self.new):
            root.mkdir()
        self.clock = support.Clock(100)
        clock_patch = patch.object(rb.time, 'monotonic', self.clock.monotonic)
        clock_patch.start()
        self.addCleanup(clock_patch.stop)

    def diagnostic_run(self, deadline):
        config = self.new / 'grafana.ini'
        prereqs = self.new / 'binary-prereqs.json'
        config.write_bytes(support.CONFIG)
        prereqs.write_text(json.dumps(support.binary_receipt()))
        opener = support.SyntheticOpener(self.clock)
        with patch.object(rb.urllib.request, 'build_opener', return_value=opener):
            return rb.run({'expected_spans': support.fixture()[0]}, 'normal',
                          grafana_config_path=config, binary_prereqs_path=prereqs,
                          inventory_roots=(self.old, self.artifacts, self.new),
                          absolute_deadline=deadline, config_pin_path=support.DIAGNOSTIC_PIN)

    def test_readback_does_not_scan_second_root_after_shared_deadline(self):
        original_walk = os.walk
        scanned = []

        def slow_walk(selected, **kwargs):
            scanned.append((Path(selected), self.clock.now))
            yield from original_walk(selected, **kwargs)
            self.clock.now += 20

        with patch.object(rb.os, 'walk', slow_walk), self.assertRaisesRegex(ValueError, '^poll_deadline_reached$'):
            self.diagnostic_run(105)

        self.assertEqual(scanned, [(self.old, 100)])
        self.assertEqual(self.clock.now, 120)

    def test_scanner_rejects_invalid_deadline_before_filesystem_access(self):
        for deadline in (True, False, '105', [], {}, float('nan'), float('inf'), -float('inf')):
            with self.subTest(deadline=deadline), patch.object(Path, 'is_dir', side_effect=AssertionError('invalid deadline accessed filesystem')):
                with self.assertRaisesRegex(ValueError, '^invalid_absolute_deadline$'):
                    rb.disk_usage(self.old, self.artifacts, absolute_deadline=deadline)

    def test_scanner_rejects_expired_deadline_before_filesystem_access(self):
        for deadline in (99, 100):
            with self.subTest(deadline=deadline), patch.object(Path, 'is_dir', side_effect=AssertionError('expired deadline accessed filesystem')):
                with self.assertRaisesRegex(ValueError, '^poll_deadline_reached$'):
                    rb.disk_usage(self.old, self.artifacts, absolute_deadline=deadline)

    def test_scanner_does_not_advance_directory_iterator_after_accounting_expires(self):
        child = self.old / 'child'
        child.mkdir()
        original_lstat, original_walk = Path.lstat, os.walk
        visited = []

        def slow_lstat(path, *args, **kwargs):
            info = original_lstat(path, *args, **kwargs)
            if path == child:
                self.clock.now = 105
            return info

        def watched_walk(selected, **kwargs):
            for row in original_walk(selected, **kwargs):
                visited.append((Path(row[0]), self.clock.now))
                yield row

        with patch.object(Path, 'lstat', slow_lstat), patch.object(rb.os, 'walk', watched_walk):
            with self.assertRaisesRegex(ValueError, '^poll_deadline_reached$'):
                rb.disk_usage(self.old, self.artifacts, absolute_deadline=105)

        self.assertEqual(visited, [(self.old, 100)])

    def test_scanner_refuses_deadline_exhausted_by_final_directory_iteration(self):
        original_walk = os.walk

        def slow_walk(selected, **kwargs):
            yield from original_walk(selected, **kwargs)
            if Path(selected) == self.artifacts:
                self.clock.now += 20

        with patch.object(rb.os, 'walk', slow_walk), self.assertRaisesRegex(ValueError, '^poll_deadline_reached$'):
            rb.disk_usage(self.old, self.artifacts, absolute_deadline=105)

    def test_scanner_does_not_resolve_external_python_after_accounting_expires(self):
        python = Path(self.tmp.name) / 'external-python'
        python.write_bytes(b'synthetic executable')
        link = self.old / 'python' / 'bin' / 'python'
        link.parent.mkdir(parents=True)
        link.symlink_to(python)
        original_lstat, original_resolve = Path.lstat, Path.resolve

        def slow_lstat(path, *args, **kwargs):
            info = original_lstat(path, *args, **kwargs)
            if path == link:
                self.clock.now = 105
            return info

        def guarded_resolve(path, *args, **kwargs):
            if path == link:
                self.assertLess(self.clock.now, 105, 'external Python resolution started after deadline')
            return original_resolve(path, *args, **kwargs)

        with patch.object(rb, 'APPROVED_PYTHON', python), patch.object(Path, 'lstat', slow_lstat), patch.object(Path, 'resolve', guarded_resolve):
            with self.assertRaisesRegex(ValueError, '^poll_deadline_reached$'):
                rb.disk_usage(self.old, self.artifacts, absolute_deadline=105)


if __name__ == '__main__':
    unittest.main()
