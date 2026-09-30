from pathlib import Path
import sys,json,subprocess,hashlib,time
A=Path('/home/aya-hmw/Documents/ChatGPT/AEON');S=A/'var/observability-pilot';E=S/'evidence';P=A/'observability/pilot'
def main():
 phase=sys.argv[1];assert phase in ('normal','outage','recovery')
 for src in json.loads((P/'source-custody.json').read_text())['source_pins']:assert hashlib.sha256(Path(src['path']).read_bytes()).hexdigest()==src['sha256']
 native=json.loads((E/'native-existing-dependencies.json').read_text())
 for dist in native['distributions']:
  for file in dist['files']:assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest()==file['sha256']
 from control import remaining_window
 window=json.loads((E/'runtime-window.json').read_text())
 assert remaining_window(window,time.time(),time.monotonic())>65,'insufficient approved window remaining'
 output=E/('emitted-'+phase+'.json');assert not output.exists()
 cmd=['systemd-run','--user','--scope','--unit=aeon-pilot-emitter-'+phase,'--property=MemoryAccounting=true','--property=MemoryMax=256M','--property=MemorySwapMax=0','--property=CPUQuota=25%','--property=TasksMax=64','/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME='+str(S/'fixture/home'),'HERMES_HOME='+str(S/'fixture/home'),'HERMES_RUNTIME_DIR='+str(S/'fixture/home/runtime'),'HERMES_OTEL_CONFIG='+str(S/'fixture/home/absent.yaml'),'TRACELOOP_TRACE_CONTENT=false','TRACELOOP_METRICS_ENABLED=false','PYTHONDONTWRITEBYTECODE=1','PYTHONPATH='+str(S/'fixture')+':/home/aya-hmw/.hermes/hermes-agent:'+str(P),'/usr/bin/timeout','--kill-after=5s','60s',str(S/'python/bin/python'),'-B',str(P/'emit_synthetic.py'),'--fallback-site',native['site'],'--output',str(output)]
 if phase=='outage':cmd.append('--outage')
 p=subprocess.run(cmd,timeout=70)
 assert p.returncode==0,p.returncode

if __name__=='__main__': main()
