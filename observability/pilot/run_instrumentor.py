"""Run the pinned real instrumentor in a disposable fixture with mocked HTTP."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from run_offline import prepare_fixture, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--native-pins', type=Path, required=True)
    parser.add_argument('--pattern', default='test_openai_instrumentor.py')
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    custody = json.loads((ROOT/'source-custody.json').read_text())
    for source in custody['source_pins']:
        if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('custody pin changed: '+source['path'])
    native = json.loads(args.native_pins.read_text())
    fallback = Path(native['site']).resolve()
    selected_environment = fallback.parents[2]
    for distribution in native['distributions']:
        for source in distribution['files']:
            path = Path(source['path']).resolve()
            if not path.is_relative_to(selected_environment):
                raise ValueError('supplemental pin is outside the selected environment')
            if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
                raise ValueError('supplemental dependency pin changed: '+str(path))
    with tempfile.TemporaryDirectory(prefix='aeon-instrumentor-offline-') as name:
        temporary = Path(name)
        prepare_fixture(temporary)
        home = temporary/'home'
        home.mkdir()
        env = {'PATH':'/usr/bin:/bin', 'LANG':'C.UTF-8', 'TZ':'UTC',
            'HERMES_HOME':str(home), 'HERMES_RUNTIME_DIR':str(home/'runtime'),
            'HERMES_OTEL_CONFIG':str(home/'absent.yaml'), 'PYTHONDONTWRITEBYTECODE':'1',
            'TRACELOOP_TRACE_CONTENT':'false', 'TRACELOOP_METRICS_ENABLED':'false',
            'PYTHONPATH':str(temporary)+os.pathsep+custody['core_owner']['path']}
        program = '''import hashlib,importlib.metadata,json,socket,sys,unittest
from pathlib import Path
sys.path.append(sys.argv[2])
native=json.loads(Path(sys.argv[3]).read_text())
for item in native['distributions']:
    assert importlib.metadata.version(item['name'])==item['version'], item['name']
for line in Path(sys.argv[4]).read_text().splitlines():
    if '==' in line and not line.lstrip().startswith('#'):
        name,version=line.split()[0].split('==')
        assert importlib.metadata.version(name)==version, name
def deny(event,args):
    if event=='socket.__new__' and not (args[1]==socket.AF_UNIX and args[2]==socket.SOCK_STREAM):
        raise RuntimeError('network socket creation disabled for instrumentor tests')
    if event in ('socket.connect','socket.bind','socket.sendto','socket.sendmsg','socket.getaddrinfo'):
        raise RuntimeError('network disabled for instrumentor tests')
sys.addaudithook(deny)
suite=unittest.defaultTestLoader.discover(sys.argv[1],pattern=sys.argv[5])
result=unittest.TextTestRunner(verbosity=2).run(suite)
if sys.argv[6]:
    pins={str(Path(source['path']).resolve()):source['sha256'] for item in native['distributions'] for source in item['files']}
    fallback=Path(sys.argv[2]).resolve()
    sealed=Path(sys.executable).parent.parent/'lib/python3.14/site-packages'
    origins={}
    undeclared=[]
    for name,module in list(sys.modules.items()):
        file=getattr(module,'__file__',None)
        if not file: continue
        path=Path(file).resolve()
        if path.is_relative_to(fallback):
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if pins.get(str(path))!=digest: undeclared.append(str(path))
            origins[name]={'path':str(path),'sha256':digest,'owner':'pinned-existing-native'}
        elif path.is_relative_to(sealed):
            origins[name]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'owner':'sealed-26-wheel-fixture'}
    Path(sys.argv[6]).write_text(json.dumps({'passed':result.wasSuccessful() and not undeclared,'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'undeclared_imports':undeclared,'imported_origins':origins},indent=2)+'\\n')
    assert not undeclared, 'undeclared existing dependencies; see isolated evidence'
sys.exit(not result.wasSuccessful())
'''
        result = subprocess.run([str(args.python), '-B', '-c', program, str(ROOT/'tests'),
            str(fallback), str(args.native_pins.resolve()), str(ROOT/'instrumentor-full-wheel-lock.txt'),
            args.pattern, str(args.evidence.resolve()) if args.evidence else ''], env=env, cwd=ROOT.parents[1])
        return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
