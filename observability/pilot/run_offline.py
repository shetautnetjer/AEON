"""Verify pins, patch disposable source, run synthetic tests with network denied."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parent


def prepare_fixture(target):
    baseline = json.loads((ROOT/'source-baseline.json').read_text())
    package = target/'hermes_otel'
    package.mkdir()
    for source in baseline['sources']:
        original = Path(source['path'])
        if hashlib.sha256(original.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('source pin changed: '+str(original))
        relative = Path(source['relative_path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('unsafe source reference')
        dest = package/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(original,dest)
    patch = ROOT/'patches/0001-isolated-metadata-and-execution-context.patch'
    subprocess.run(['git','apply','--no-index','--check',str(patch)],cwd=package,check=True)
    subprocess.run(['git','apply','--no-index',str(patch)],cwd=package,check=True)
    shutil.copyfile(ROOT/'patches/payload/metadata_pilot.py',package/'metadata_pilot.py')
    return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    custody = json.loads((ROOT/'source-custody.json').read_text())
    matched = [e for e in custody['managed_environments'] if e['core_match']]
    if len(matched) != 1:
        raise ValueError('exact maintained-core environment match required')
    parser.add_argument('--python',type=Path,default=Path(matched[0]['venv'])/'bin/python')
    # Match the maintained dispatch snapshot; other older workspaces are not presumed compatible.
    parser.add_argument('--core',type=Path,default=Path(custody['core_owner']['path']))
    args = parser.parse_args()
    if args.core.resolve() != Path(custody['core_owner']['path']).resolve():
        raise ValueError('core override lacks source custody pins')
    for source in custody['source_pins']:
        if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('custody pin changed: '+source['path'])
    with tempfile.TemporaryDirectory(prefix='aeon-telemetry-offline-') as name:
        temporary = Path(name)
        prepare_fixture(temporary)
        home = temporary/'home';home.mkdir()
        env = {'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC',
               'HERMES_HOME':str(home),'HERMES_RUNTIME_DIR':str(home/'runtime'),
               'HERMES_OTEL_CONFIG':str(home/'absent.yaml'),'PYTHONDONTWRITEBYTECODE':'1',
               'TRACELOOP_TRACE_CONTENT':'false','PYTHONPATH':str(temporary)+os.pathsep+str(args.core)}
        program = '''import sys,unittest,importlib.metadata
assert importlib.metadata.version("opentelemetry-sdk")=="1.39.1"
def deny(event,args):
    if event in ("socket.__new__","socket.connect","socket.bind","socket.sendto","socket.sendmsg","socket.getaddrinfo"):
        raise RuntimeError("network disabled for offline telemetry tests")
sys.addaudithook(deny)
suite=unittest.defaultTestLoader.discover(sys.argv[1])
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
'''
        result = subprocess.run([str(args.python),'-B','-c',program,str(ROOT/'tests')],env=env,cwd=ROOT.parents[1])
        return result.returncode

if __name__=='__main__':sys.exit(main())
