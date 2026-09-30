import copy
import json
import tempfile
import unittest
from pathlib import Path

try:
    from tools import render_bible as rb
except ImportError:
    rb = None


class BibleNavigationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(rb, 'Bible generator not implemented')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source.json'
        self.source.write_text('{}\n')
        self.data = {
            'format_version': 1, 'verified_on': '2026-09-30', 'scope': 'Navigation only',
            'components': [self.component('a'), self.component('b')],
            'relationships': [{'from': 'a', 'to': 'b', 'kind': 'references',
                               'state': 'proposed', 'source': {'path': str(self.source), 'line': 1}},
                              {'from': 'b', 'to': 'a', 'kind': 'retained dependency',
                               'state': 'source only', 'source': {'path': str(self.source)}}],
        }

    def component(self, identifier):
        return {'id': identifier, 'label': identifier.upper(), 'area': 'memory',
                'status': {'availability': 'source', 'deployment': 'not deployed', 'qualification': 'unqualified'},
                'owner': {'path': str(self.root), 'role': 'source owner'},
                'files': [{'path': str(self.source), 'role': 'schema'}], 'notes': 'No runtime change'}

    def test_real_index_shape_and_paths(self):
        data = rb.load_index(Path(__file__).resolve().parents[1] / 'bibles/index.json')
        self.assertGreaterEqual(len(data['components']), 18)
        self.assertTrue(any(f['role'] == 'schema' for c in data['components'] for f in c['files']))

    def test_duplicate_component_rejected(self):
        self.data['components'].append(copy.deepcopy(self.data['components'][0]))
        with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_dangling_graph_reference_rejected(self):
        self.data['relationships'][0]['to'] = 'unlisted'
        with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_duplicate_relationship_rejected(self):
        self.data['relationships'].append(copy.deepcopy(self.data['relationships'][0]))
        with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_missing_file_rejected(self):
        self.data['components'][0]['files'][0]['path'] = str(self.root / 'missing')
        with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_missing_owner_rejected(self):
        self.data['components'][0]['owner']['path'] = str(self.root / 'missing-owner')
        with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_relative_or_url_path_rejected(self):
        for value in ['source.json', 'https://example.invalid/source']:
            with self.subTest(value=value):
                self.data['components'][0]['files'][0]['path'] = value
                with self.assertRaises(ValueError): rb.validate_index(self.data)

    def test_existing_double_slash_paths_cannot_be_rendered_as_network_links(self):
        # POSIX accepts //tmp as an existing absolute path; browsers treat it as a host.
        for location in ['owner', 'file', 'relationship']:
            with self.subTest(location=location):
                data = copy.deepcopy(self.data)
                if location == 'owner':
                    ref = data['components'][0]['owner']
                elif location == 'file':
                    ref = data['components'][0]['files'][0]
                else:
                    ref = data['relationships'][0]['source']
                ref['path'] = '/' + ref['path']
                self.assertTrue(Path(ref['path']).exists())
                with self.assertRaises(ValueError): rb.validate_index(data)
                with self.assertRaises(ValueError): rb.render(data)

    def test_memory_qualification_matches_retained_navigation_evidence(self):
        root = Path(__file__).resolve().parents[1] / 'bibles'
        data = rb.load_index(root / 'index.json')
        memory = next(c for c in data['components'] if c['id'] == 'local-basic-memory')
        scope = 'source-linked local retrieval and capability-metadata qualification'
        self.assertIn(scope, memory['status']['qualification'])
        readme = (root / 'memory/README.md').read_text()
        self.assertIn(scope, readme)
        self.assertNotIn('save/fresh-recall qualification', readme)

    def test_invalid_shape_date_and_boolean_line_rejected(self):
        variants = []
        x = copy.deepcopy(self.data); x['format_version'] = True; variants.append(x)
        x = copy.deepcopy(self.data); x['verified_on'] = '2026-02-30'; variants.append(x)
        x = copy.deepcopy(self.data); x['relationships'][0]['source']['line'] = True; variants.append(x)
        x = copy.deepcopy(self.data); del x['components'][0]['status']['qualification']; variants.append(x)
        for x in variants:
            with self.assertRaises(ValueError): rb.validate_index(x)

    def test_duplicate_json_object_key_rejected(self):
        p = self.root / 'bad.json'; p.write_text('{"format_version":1,"format_version":2}')
        with self.assertRaises(ValueError): rb.load_index(p)

    def test_generation_deterministic_under_order_changes(self):
        first = rb.render(self.data)
        changed = copy.deepcopy(self.data)
        changed['components'].reverse(); changed['relationships'].reverse()
        self.assertEqual(first, rb.render(changed))
        self.assertEqual(first, rb.render(self.data))

    def test_html_svg_escape_labels_notes_and_relationships(self):
        self.data['components'][0]['label'] = '<script>alert("x")</script>'
        self.data['components'][0]['notes'] = '<img onerror="x">'
        self.data['relationships'][0]['kind'] = '<script>x</script>'
        html, svg = rb.render(self.data)
        for out in [html, svg]:
            self.assertNotIn('<script>', out)
            self.assertIn('&lt;script&gt;', out)
        self.assertNotIn('<img onerror=', html)

    def test_check_mode_detects_drift_without_writing(self):
        p = self.root / 'index.json'; p.write_text(json.dumps(self.data))
        out = self.root / 'out'; rb.generate(p, out)
        rb.generate(p, out, check=True)
        (out / 'index.html').write_text('manual drift')
        with self.assertRaises(ValueError): rb.generate(p, out, check=True)
        self.assertEqual((out / 'index.html').read_text(), 'manual drift')

    def test_invalid_index_creates_no_outputs(self):
        self.data['relationships'][0]['to'] = 'missing'
        p = self.root / 'index.json'; p.write_text(json.dumps(self.data))
        out = self.root / 'out'
        with self.assertRaises(ValueError): rb.generate(p, out)
        self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
