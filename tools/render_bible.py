"""Validate AEON's local navigation index and render derived views; no runtime work."""

import argparse
import datetime
import html
import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def mapping(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) <= set(required) | set(optional):
        raise ValueError('navigation object has missing or unexpected fields')


def text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('navigation text must be nonempty')


def path_reference(value, check_paths, file_only=False):
    text(value)
    p = Path(value)
    if value.startswith('//') or not p.is_absolute():
        raise ValueError('navigation paths must be absolute local paths')
    if check_paths and not (p.is_file() if file_only else p.exists()):
        raise ValueError('navigation path does not exist: ' + value)


def file_reference(value, check_paths, role=False):
    mapping(value, ['path', 'role'] if role else ['path'], ['line'])
    path_reference(value['path'], check_paths, file_only=True)
    if role:
        text(value['role'])
    if 'line' in value and (type(value['line']) is not int or value['line'] < 1):
        raise ValueError('source line must be a positive integer')


def validate_index(data, check_paths=True):
    mapping(data, ['format_version', 'verified_on', 'scope', 'components', 'relationships'])
    if type(data['format_version']) is not int or data['format_version'] != 1:
        raise ValueError('unsupported navigation format version')
    text(data['verified_on'])
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', data['verified_on']):
        raise ValueError('verification date must be YYYY-MM-DD')
    datetime.date.fromisoformat(data['verified_on'])
    text(data['scope'])
    if not isinstance(data['components'], list) or not data['components']:
        raise ValueError('components must be a nonempty list')
    if not isinstance(data['relationships'], list):
        raise ValueError('relationships must be a list')
    ids = set()
    for c in data['components']:
        mapping(c, ['id', 'label', 'area', 'status', 'owner', 'files', 'notes'])
        text(c['id'])
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', c['id']) or c['id'] in ids:
            raise ValueError('invalid or duplicate local component ID')
        ids.add(c['id'])
        text(c['label'])
        if c['area'] not in ('memory', 'observability'):
            raise ValueError('unknown navigation area')
        mapping(c['status'], ['availability', 'deployment', 'qualification'])
        for v in c['status'].values(): text(v)
        mapping(c['owner'], ['path', 'role'])
        path_reference(c['owner']['path'], check_paths)
        text(c['owner']['role'])
        if not isinstance(c['files'], list) or not c['files']:
            raise ValueError('component file references must be nonempty')
        for f in c['files']: file_reference(f, check_paths, role=True)
        if not isinstance(c['notes'], str): raise ValueError('notes must be text')
    edges = set()
    for edge in data['relationships']:
        mapping(edge, ['from', 'to', 'kind', 'state', 'source'])
        for k in ['from', 'to', 'kind', 'state']: text(edge[k])
        if edge['from'] not in ids or edge['to'] not in ids:
            raise ValueError('relationship points to an unlisted component')
        key = (edge['from'], edge['to'], edge['kind'])
        if key in edges: raise ValueError('duplicate navigation relationship')
        edges.add(key)
        file_reference(edge['source'], check_paths)
    return data


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out: raise ValueError('duplicate JSON object key')
        out[key] = value
    return out


def load_index(path):
    return validate_index(json.loads(Path(path).read_text(), object_pairs_hook=unique_object))


def esc(value):
    return html.escape(str(value), quote=True)


def link(ref):
    suffix = ':' + str(ref['line']) if 'line' in ref else ''
    return '<a href="' + esc(quote(ref['path'], safe='/')) + '">' + esc(ref['path'] + suffix) + '</a>'


def ordered_edges(data):
    return sorted(data['relationships'], key=lambda x: (x['from'], x['to'], x['kind'], x['state']))


def render(data):
    validate_index(data, check_paths=False)
    components = sorted(data['components'], key=lambda c: c['id'])
    by_id = {c['id']: c for c in components}
    edges = ordered_edges(data)
    height = max(110, 70 + 76 * len(edges))
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ' + str(height) + '" role="img" aria-label="Derived navigation relationships">',
           '<!-- Generated from index.json; edit the index, not this view. -->',
           '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#516278"/></marker></defs>',
           '<rect width="1200" height="' + str(height) + '" fill="#f7f9fc"/>',
           '<text x="24" y="30" font-family="sans-serif" font-size="18">Source-backed relationships; state remains in index.json</text>']
    for i, edge in enumerate(edges):
        y = 60 + 76 * i
        svg.append('<g><title>' + esc(edge['kind'] + ' — ' + edge['state']) + '</title>')
        for x, identifier in [(24, edge['from']), (825, edge['to'])]:
            label = by_id[identifier]['label']
            svg.append('<rect x="' + str(x) + '" y="' + str(y) + '" width="350" height="45" rx="5" fill="#e8eef8" stroke="#9fb0c9"/>')
            svg.append('<text x="' + str(x + 12) + '" y="' + str(y + 27) + '" font-family="sans-serif" font-size="13">' + esc(label[:45]) + '</text>')
        svg.append('<line x1="382" y1="' + str(y + 30) + '" x2="810" y2="' + str(y + 30) + '" stroke="#516278" marker-end="url(#arrow)"/>')
        svg.append('<text x="395" y="' + str(y + 15) + '" font-family="sans-serif" font-size="12">' + esc(edge['kind'][:60]) + '</text></g>')
    svg.append('</svg>')
    svg_text = '\n'.join(svg) + '\n'
    page = ['<!doctype html>', '<!-- Generated from index.json; no authoritative definitions live here. -->',
            '<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            '<title>AEON Bible navigation</title>',
            '<style>body{font:16px system-ui;margin:2rem;color:#172334;max-width:1300px}table{border-collapse:collapse;width:100%}td,th{padding:.7rem;border:1px solid #ccd5e2;text-align:left;vertical-align:top}a{overflow-wrap:anywhere}svg{width:100%;height:auto}small{color:#46566d}</style>',
            '<h1>AEON Bible navigation</h1><p>Verified on ' + esc(data['verified_on']) + '. JSON is primary; this view is derived.</p><p>' + esc(data['scope']) + '</p>',
            '<p><a href="index.json">Machine index</a> · <a href="README.md">Operating rules</a></p>',
            '<table><thead><tr><th>Component</th><th>Availability / deployment / qualification</th><th>Owner and existing files</th></tr></thead><tbody>']
    for c in components:
        status = '<br>'.join('<strong>' + esc(k) + ':</strong> ' + esc(c['status'][k]) for k in ('availability', 'deployment', 'qualification'))
        files = '<br>'.join(esc(f['role']) + ': ' + link(f) for f in sorted(c['files'], key=lambda f: (f['path'], f['role'], f.get('line', 0))))
        page.append('<tr id="' + esc(c['id']) + '"><td><strong>' + esc(c['label']) + '</strong><br><small>' + esc(c['id'] + ' · ' + c['area']) + '</small><p>' + esc(c['notes']) + '</p></td><td>' + status + '</td><td>' + link(c['owner']) + '<p>' + esc(c['owner']['role']) + '</p>' + files + '</td></tr>')
    page.extend(['</tbody></table><h2>Relationships</h2>', svg_text, '<table><tr><th>From → to / relationship</th><th>State / source</th></tr>'])
    for edge in edges:
        page.append('<tr><td>' + esc(edge['from'] + ' → ' + edge['to'] + ': ' + edge['kind']) + '</td><td>' + esc(edge['state']) + '<br>' + link(edge['source']) + '</td></tr>')
    page.append('</table></html>')
    return '\n'.join(page) + '\n', svg_text


def generate(index_path, output_dir, check=False):
    data = load_index(index_path)
    page, svg = render(data)
    out = Path(output_dir)
    outputs = {'index.html': page, 'relationships.svg': svg}
    if check:
        for name, content in outputs.items():
            p = out / name
            if not p.is_file() or p.read_text() != content:
                raise ValueError('derived output missing or stale: ' + name)
    else:
        out.mkdir(parents=True, exist_ok=True)
        for name, content in outputs.items(): (out / name).write_text(content)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, default=ROOT / 'bibles/index.json')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'bibles')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        data = generate(args.index, args.output_dir, args.check)
    except (ValueError, OSError) as exc:
        parser.exit(2, 'Navigation validation failed: ' + str(exc) + '\n')
    print('Validated ' + str(len(data['components'])) + ' components / ' + str(len(data['relationships'])) + ' relationships; derived views ' + ('match.' if args.check else 'written.'))


if __name__ == '__main__':
    main()
