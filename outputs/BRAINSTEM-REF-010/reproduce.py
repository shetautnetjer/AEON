"""Reproduce reviewed offline tests in a fresh hash-bound scratch copy only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

PACKET = Path(__file__).resolve().parent


def safe_path(root, rel):
    parts = Path(rel).parts
    if not parts or Path(rel).is_absolute() or any(p in ('.', '..') for p in parts):
        raise ValueError('unsafe manifest path')
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('symlink in source path')
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError('nonregular source')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-owner', type=Path, required=True)
    parser.add_argument('--scratch-root', type=Path, required=True)
    args = parser.parse_args()
    owner = args.source_owner.resolve(strict=True)
    scratch = args.scratch_root
    if not scratch.is_absolute() or scratch.exists() or '..' in scratch.parts:
        raise ValueError('scratch must be absolute, fresh and outside source owner')
    resolved = scratch.resolve()
    if resolved == owner or owner in resolved.parents or resolved in owner.parents:
        raise ValueError('scratch must be outside source owner')
    baseline = json.loads((PACKET / 'baseline-manifest.json').read_text())
    bodies = {}
    for rel, digest in baseline.items():
        raw = safe_path(owner, rel).read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('source baseline changed: ' + rel)
        bodies[rel] = raw
    for item in json.loads((PACKET / 'owner-preservation.json').read_text()):
        if item['owner_sha256'] is None and (owner / item['path']).exists():
            raise ValueError('new patch path already exists in source owner: ' + item['path'])
    for rel, digest in json.loads((PACKET / 'packet-manifest.json').read_text()).items():
        if hashlib.sha256(safe_path(PACKET, rel).read_bytes()).hexdigest() != digest:
            raise ValueError('packet changed: ' + rel)
    scratch.mkdir(mode=0o700)
    source = scratch / 'source'
    source.mkdir(mode=0o700)
    for rel, raw in bodies.items():
        path = source / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    patch = PACKET / 'brainstem-reference-first.patch'
    subprocess.run(['git', 'apply', '--check', str(patch)], cwd=source, check=True)
    subprocess.run(['git', 'apply', str(patch)], cwd=source, check=True)
    for item in json.loads((PACKET / 'changed-paths.json').read_text()):
        if hashlib.sha256(safe_path(source, item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('patched source hash mismatch: ' + item['path'])
    # Do not inherit credentials, Python injection or Cargo output overrides.
    allowed = ('HOME', 'PATH', 'LANG', 'LC_ALL', 'TZ', 'CARGO_HOME', 'RUSTUP_HOME')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env['CARGO_TARGET_DIR'] = str(scratch / 'cargo-target')
    env['CARGO_BUILD_TARGET_DIR'] = str(scratch / 'cargo-target')
    env['OBSERVER_B_PYTHON'] = sys.executable
    env['OBSERVER_B_RUN_ROOT'] = str(scratch / 'rust-run')
    commands = [
        ['cargo', 'test', '--offline', '--locked', '--manifest-path', 'observer-probe/Cargo.toml'],
        ['cargo', 'clippy', '--offline', '--locked', '--manifest-path', 'observer-probe/Cargo.toml', '--all-targets', '--', '-D', 'warnings'],
        *[[sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', name]
          for name in ('test_reference_admission.py', 'test_capture_reference_wiring.py', 'test_durable_capture_roundtrip.py')],
    ]
    results = []
    for index, command in enumerate(commands, 1):
        receipt = scratch / ('check-%02d.log' % index)
        with receipt.open('w') as output:
            result = subprocess.run(command, cwd=source, env=env, stdout=output, stderr=subprocess.STDOUT)
        results.append({'command': command, 'returncode': result.returncode,
                        'receipt': receipt.name, 'sha256': hashlib.sha256(receipt.read_bytes()).hexdigest()})
        print(json.dumps(results[-1]), flush=True)
        if result.returncode:
            (scratch / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
            return result.returncode
    (scratch / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
