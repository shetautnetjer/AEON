from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys,os,importlib.util
A=Path('/home/aya-hmw/Documents/ChatGPT/AEON');P=A/'observability/pilot';E=A/'var/observability-pilot/evidence';os.umask(0o077)
def main():
 steps=[]
 def command(label,*args):
  print(json.dumps({'step':label,'at':datetime.now(timezone.utc).isoformat()}),flush=True)
  proc=subprocess.run(['/usr/bin/python3','-B',*map(str,args)],timeout=100)
  steps.append({'step':label,'exit_code':proc.returncode,'at':datetime.now(timezone.utc).isoformat()})
  assert proc.returncode==0,label
 def memory_snapshot(phase,proof):
  peaks=[]
  for unit in proof['units']:
   group=Path('/sys/fs/cgroup'+unit['properties']['ControlGroup'])
   peaks.append({'unit':unit['unit'],'memory_peak_bytes':int((group/'memory.peak').read_text()),'memory_current_bytes':int((group/'memory.current').read_text()),'memory_events':dict(line.split() for line in (group/'memory.events').read_text().splitlines())})
  assert all(p['memory_events']['oom']=='0' and p['memory_events']['oom_kill']=='0' for p in peaks)
  (E/('measured-service-memory-'+phase+'.json')).write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'phase':phase,'peaks':peaks,'qualification':'component peaks may occur at different instants; hard configured ceilings remain unchanged'},indent=2)+'\n')
 try:
  command('start',P/'control.py','start')
  command('normal-emitter',P/'run_emitter.py','normal')
  command('normal-readback',P/'readback.py','--emitted',E/'emitted-normal.json','--output',E/'readback-normal.json','--phase','normal')
  command('normal-effective-limits',P/'control.py','limits')
  # Preserve first limits proof before the controller's recovery snapshot replaces it.
  (E/'limits-normal.json').write_bytes((E/'runtime-limits-and-listeners.json').read_bytes())
  memory_snapshot('normal',json.loads((E/'limits-normal.json').read_text()))
  command('alloy-outage',P/'control.py','outage')
  command('outage-emitter',P/'run_emitter.py','outage')
  command('alloy-recovery',P/'control.py','recover-alloy')
  command('recovery-emitter',P/'run_emitter.py','recovery')
  command('recovery-readback',P/'readback.py','--emitted',E/'emitted-recovery.json','--output',E/'readback-recovery.json','--phase','recovery')
  command('recovery-effective-limits',P/'control.py','limits')
  (E/'limits-recovery.json').write_bytes((E/'runtime-limits-and-listeners.json').read_bytes())
  memory_snapshot('recovery',json.loads((E/'limits-recovery.json').read_text()))
 except BaseException as exc:
  steps.append({'step':'failure','type':type(exc).__name__,'detail':str(exc)})
  raise
 finally:
  proc=subprocess.run(['/usr/bin/python3','-B',str(P/'control.py'),'stop'],timeout=100)
  steps.append({'step':'shutdown','exit_code':proc.returncode,'at':datetime.now(timezone.utc).isoformat()})
  (E/'execution-steps.json').write_text(json.dumps(steps,indent=2)+'\n')
  assert proc.returncode==0,'shutdown verification failed'

if __name__=='__main__': main()
