from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,math,os,re,subprocess,sys,time
A=Path('/home/aya-hmw/Documents/ChatGPT/AEON');S=A/'var/observability-pilot';E=S/'evidence'
NAMES=['aeon-pilot-'+x+'.service' for x in ('tempo','prometheus','alloy','grafana')]
PORTS={14317,14318,12346,13200,19095,24317,24318,19090,13000,13101,17946}
LIMITS={'alloy':(384,320,50),'tempo':(768,640,75),'prometheus':(384,320,50),'grafana':(384,320,25)}
EXPECTED_PORTS={14317:'alloy',14318:'alloy',12346:'alloy',13200:'tempo',19095:'tempo',24317:'tempo',24318:'tempo',19090:'prometheus',13000:'grafana'}
COLLECTOR_PORTS={4317,4318,4320,13133}
MAX_WINDOW_SECONDS=1800
RUNTIME_FILES=frozenset({'observability/pilot/config/'+name for name in ('README.md','config.alloy','grafana.ini','hermes_otel.synthetic.yaml','prometheus.yaml','provisioning/datasources/local.yaml','tempo.yaml')}|{'observability/pilot/units/'+name for name in NAMES})
def new_window(now_epoch,now_monotonic):
 assert math.isfinite(now_epoch) and math.isfinite(now_monotonic),'invalid pilot clock'
 return {'started_at':datetime.fromtimestamp(now_epoch,timezone.utc).isoformat(),'deadline_at':datetime.fromtimestamp(now_epoch+MAX_WINDOW_SECONDS,timezone.utc).isoformat(),'started_epoch':now_epoch,'deadline_epoch':now_epoch+MAX_WINDOW_SECONDS,'started_monotonic':now_monotonic,'deadline_monotonic':now_monotonic+MAX_WINDOW_SECONDS,'unit_runtime_seconds':{n:MAX_WINDOW_SECONDS for n in NAMES}}
def remaining_window(window,now_epoch,now_monotonic):
 values=[window[k] for k in ('started_epoch','deadline_epoch','started_monotonic','deadline_monotonic')]+[now_epoch,now_monotonic]
 assert all(math.isfinite(value) for value in values),'invalid pilot clock'
 assert window['deadline_epoch']-window['started_epoch']==MAX_WINDOW_SECONDS and window['deadline_monotonic']-window['started_monotonic']==MAX_WINDOW_SECONDS,'pilot deadline changed'
 remaining=math.floor(min(window['deadline_epoch']-now_epoch,window['deadline_monotonic']-now_monotonic,MAX_WINDOW_SECONDS))
 assert remaining>0,'pilot runtime window expired'
 return remaining
def load_window():
 window=json.loads((E/'runtime-window.json').read_text())
 remaining_window(window,time.time(),time.monotonic())
 return window
def save_window(window):
 (E/'runtime-window.json').write_text(json.dumps(window,indent=2)+'\n')
def runtime_hashes():
 receipt=E/'binary-prereqs.json';raw=receipt.read_bytes();pins=json.loads(raw)['config_pins']
 paths=[pin['path'] for pin in pins]
 assert len(paths)==len(set(paths)),'duplicate configuration pin'
 assert set(paths)==RUNTIME_FILES,'authored runtime configuration pin set changed'
 out={'binary-prereqs.json':hashlib.sha256(raw).hexdigest()}
 for pin in pins:
  relative=Path(pin['path']);assert not relative.is_absolute() and '..' not in relative.parts,'invalid configuration pin path'
  path=A/relative;assert path.resolve().is_relative_to(A.resolve()),'configuration pin escaped AEON'
  assert str(relative) not in out,'duplicate configuration pin'
  digest=hashlib.sha256(path.read_bytes()).hexdigest();assert digest==pin['sha256'],'authored runtime configuration changed'
  out[str(relative)]=digest
 return out
def verify_runtime_files(window):
 assert runtime_hashes()==window['runtime_hashes'],'pilot configuration differs from the first startup'
def seconds(value):
 text=str(value).replace(' ','')
 if text.isdigit():return int(text)/1000000
 parts=re.findall(r'(\d+(?:\.\d+)?)(us|ms|min|s|h|d)',text)
 assert parts and ''.join(amount+unit for amount,unit in parts)==text,'unbounded or invalid systemd duration'
 scale={'us':0.000001,'ms':0.001,'s':1,'min':60,'h':3600,'d':86400}
 return sum(float(amount)*scale[unit] for amount,unit in parts)
def validate_runtime_properties(state,expected_runtime):
 runtime=seconds(state.get('RuntimeMaxUSec'))
 assert 0<runtime<=MAX_WINDOW_SECONDS and runtime==expected_runtime,'effective runtime bound differs from the global-window budget'
 assert state.get('Restart')=='no','pilot restart policy changed'
 assert state.get('NoNewPrivileges','').lower() in ('yes','true','1'),'pilot NoNewPrivileges is disabled'
 assert int(state.get('UMask','0'),8)==0o077,'pilot UMask changed'
 assert seconds(state.get('TimeoutStopUSec'))==25,'pilot stop timeout changed'
 assert state.get('KillMode')=='control-group','pilot must stop its entire control group'
def validate_listeners(rows,component_pids):
 assert set(component_pids)==set(LIMITS),'pilot component ownership is incomplete'
 owners={}
 for component,pids in component_pids.items():
  assert pids,'pilot component PID set is empty'
  for pid in pids:
   assert str(pid).isdigit() and int(pid)>0,'invalid pilot PID'
   assert str(pid) not in owners,'pilot PID belongs to multiple components'
   owners[str(pid)]=component
 pilot=[]
 for row in rows:
  pids=set(map(str,row.get('owners',[])))
  if not pids.intersection(owners) and row['port'] not in PORTS:continue
  assert pids,'pilot listener owner is missing'
  assert pids<=set(owners),'pilot listener includes an unknown owner'
  assert row['port'] in EXPECTED_PORTS,'pilot owns an unexpected listener port'
  assert row.get('protocol')=='tcp','pilot owns a non-TCP listener'
  host,port=row['address'].rsplit(':',1)
  assert host=='127.0.0.1' and int(port)==row['port'],'pilot listener does not match the approved loopback binding'
  assert {owners[pid] for pid in pids}=={EXPECTED_PORTS[row['port']]},'pilot port belongs to the wrong component'
  pilot.append(row)
 assert len(pilot)==len(EXPECTED_PORTS) and {row['port'] for row in pilot}==set(EXPECTED_PORTS),'pilot listener set is incomplete or duplicated'
 return sorted(pilot,key=lambda row:row['port'])
def read_group_pids(group):
 pids=set()
 for path in [group/'cgroup.procs',*group.rglob('cgroup.procs')]:
  try:pids.update(path.read_text().split())
  except FileNotFoundError:pass
 assert all(pid.isdigit() and int(pid)>0 for pid in pids),'invalid cgroup PID'
 return pids
def cgroup_pids(group,main_pid):
 pids=read_group_pids(group)
 assert str(main_pid) in pids and int(main_pid)>0,'active pilot PID is absent from its cgroup'
 return pids
def pid_alive(pid):return Path('/proc/'+str(pid)).exists()
def validate_shutdown(ownership,states,groups,alive,rows,reserved_ports):
 owned={pid for entry in ownership['units'].values() for pid in entry['pids']}
 expected_groups={group for entry in ownership['units'].values() for group in entry['control_groups']}
 assert set(groups)==expected_groups and all(not pids for pids in groups.values()),'pilot cgroup is not empty or unverifiable'
 assert not owned.intersection(alive),'pilot child PID survived stop'
 assert not [row for row in rows if row['port'] in reserved_ports or owned.intersection(row.get('owners',[]))],'pilot listener survived stop'
 assert all(unit_stopped(state) for state in states.values()),'pilot unit remains active or unverifiable'
def snapshot_ownership(names,states):
 path=E/'process-ownership.json';saved=json.loads(path.read_text()) if path.exists() else {'units':{}}
 for name in names:
  entry=saved['units'].setdefault(name,{'pids':[],'control_groups':[]});pids=set(entry['pids']);groups=set(entry['control_groups']);state=states[name]
  main=state.get('MainPID','0')
  if main.isdigit() and int(main)>0:pids.add(main)
  group=state.get('ControlGroup')
  if group:
   assert group.startswith('/') and group!='/' and '..' not in group.split('/'),'invalid pilot control group'
   groups.add(group);pids.update(read_group_pids(Path('/sys/fs/cgroup'+group)))
  entry['pids']=sorted(pids);entry['control_groups']=sorted(groups)
 path.write_text(json.dumps(saved,indent=2)+'\n')
 return {'units':{name:saved['units'][name] for name in names}}
def run(*args,check=True):return subprocess.run(list(args),text=True,capture_output=True,timeout=35,check=check)
def show(name,check=True):
 p=run('systemctl','--user','show',name,'--property=Id,LoadState,ActiveState,SubState,Result,MainPID,ControlGroup,FragmentPath,MemoryMax,MemoryHigh,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,Restart,NoNewPrivileges,UMask,TimeoutStopUSec,KillMode',check=check);return dict(x.split('=',1) for x in p.stdout.splitlines() if '=' in x)
def sockets():
 r=run('ss','-H','-ltnup');lines=[]
 for line in r.stdout.splitlines():
  fields=line.split();assert len(fields)>=6,'unparseable listener row';local=fields[4]
  port=int(local.rsplit(':',1)[-1])
  lines.append({'protocol':fields[0],'port':port,'address':local,'owners':re.findall(r'pid=(\d+)',line)})
 return lines
def validate_retry_unit(state,name):
 assert unit_stopped(state),'retry requires all pilot units stopped'
 if state.get('LoadState')!='not-found':
  assert state.get('LoadState')=='loaded','retry unit is not loaded'
  fragment=state.get('FragmentPath','');assert isinstance(fragment,str) and Path(fragment).is_absolute(),'retry unit does not use the pinned pilot fragment'
  try:
   actual=Path(fragment).resolve(strict=True);approved=(A/'observability/pilot/units'/name).resolve(strict=True)
  except (OSError,RuntimeError):raise AssertionError('retry unit fragment is missing or unresolved') from None
  assert actual==approved and actual.is_file(),'retry unit does not use the pinned pilot fragment'
def preflight(window=None):
 assert not [x for x in sockets() if x['port'] in PORTS],'pilot port conflict'
 for name in NAMES:
  if window is None:
   p=run('systemctl','--user','show',name,'--property=LoadState',check=False)
   assert p.stdout.strip()=='LoadState=not-found',name
  else:validate_retry_unit(show(name,check=False),name)
  persistent=Path('/home/aya-hmw/.config/systemd/user')/name
  assert not persistent.exists() and not persistent.is_symlink(),str(persistent)
  runtime=Path('/run/user/1000/systemd/user')/name
  if window is None:assert not runtime.exists() and not runtime.is_symlink(),str(runtime)
  elif runtime.exists() or runtime.is_symlink():assert runtime.is_symlink() and runtime.resolve()==(A/'observability/pilot/units'/name).resolve(),'retry runtime link differs from pinned pilot unit'
 assert {'cpu','memory','pids'}<=set(Path('/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cgroup.controllers').read_text().split())
 d={'at':datetime.now(timezone.utc).isoformat(),'pilot_ports_free':sorted(PORTS),'existing_collector_listeners':[row for row in sockets() if row['port'] in COLLECTOR_PORTS],'checked_pilot_units':NAMES,'retry_with_original_deadline':window is not None,'controllers':['cpu','memory','pids']}
 (E/'runtime-preflight.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'preflight':'pass','ports_free':len(PORTS),'controllers':'cpu/memory/pids'}))
def stop_selected(names,receipt,reserved_ports):
 before={n:show(n,check=False) for n in names};ownership=snapshot_ownership(names,before)
 run('systemctl','--user','stop',*names,check=False)
 states={n:show(n,check=False) for n in names}
 groups={group:read_group_pids(Path('/sys/fs/cgroup'+group)) for entry in ownership['units'].values() for group in entry['control_groups']}
 alive={pid for entry in ownership['units'].values() for pid in entry['pids'] if pid_alive(pid)}
 validate_shutdown(ownership,states,groups,alive,sockets(),reserved_ports)
 d={'at':datetime.now(timezone.utc).isoformat(),'units':states,'ownership_before':ownership,'control_groups_after':{group:sorted(pids) for group,pids in groups.items()},'owned_pids_alive_after':sorted(alive),'pilot_listeners_remaining':[],'state_retained':True}
 (E/receipt).write_text(json.dumps(d,indent=2)+'\n')
 return d
def stop():
 stop_selected(NAMES,'shutdown.json',PORTS)
 print(json.dumps({'shutdown':'pass','pilot_units':4,'listeners':0}))
def unit_stopped(state):
 if state.get('LoadState')=='not-found':return state.get('MainPID','0')=='0' and state.get('ActiveState','inactive') in ('inactive','failed')
 return state.get('MainPID')=='0' and state.get('ActiveState') in ('inactive','failed')
def limits():
 window=load_window();out=[];allowed=set();component_pids={};mem=cpu=0
 for n in NAMES:
  st=show(n);assert st['ActiveState']=='active',st
  validate_runtime_properties(st,window['unit_runtime_seconds'][n])
  component=n.split('aeon-pilot-')[1].split('.')[0];mx,hi,quota=LIMITS[component];group=Path('/sys/fs/cgroup'+st['ControlGroup'])
  cg={k:(group/k).read_text().strip() for k in ('memory.max','memory.high','memory.swap.max','pids.max','cpu.max')}
  assert int(cg['memory.max'])==mx*1024**2 and int(cg['memory.high'])==hi*1024**2
  assert cg['memory.swap.max']=='0' and cg['pids.max']=='128'
  q,period=map(int,cg['cpu.max'].split());assert q/period==quota/100
  env=Path('/proc/'+st['MainPID']+'/environ').read_bytes().split(b'\0');keys={x.split(b'=',1)[0].decode() for x in env if x};assert keys<={'PATH','GOMAXPROCS','GOMEMLIMIT'},keys
  component_pids[component]=cgroup_pids(group,st['MainPID']);allowed.update(component_pids[component]);out.append({'unit':n,'properties':st,'effective_cgroup':cg,'environment_keys':sorted(keys)});mem+=mx;cpu+=quota
 pilot=validate_listeners(sockets(),component_pids)
 snapshot_ownership(NAMES,{entry['unit']:entry['properties'] for entry in out})
 # Save only pilot-owned current established destinations, never unrelated process sockets.
 connections=[]
 for line in run('ss','-H','-tnp').stdout.splitlines():
  if not any('pid='+p+',' in line for p in allowed):continue
  fields=line.split();peer=fields[4]
  assert peer.startswith('127.0.0.1:'),'pilot established peer does not match approved loopback binding'
  connections.append({'state':fields[0],'local':fields[3],'peer':peer})
 remaining=remaining_window(window,time.time(),time.monotonic())
 d={'at':datetime.now(timezone.utc).isoformat(),'units':out,'component_pids':{component:sorted(pids) for component,pids in component_pids.items()},'listeners':pilot,'established_destinations':connections,'global_started_at':window['started_at'],'global_deadline_at':window['deadline_at'],'remaining_window_seconds':remaining,'service_memory_max_mib':mem,'service_cpu_percent':cpu,'emitter_budget_reserved':{'memory_max_mib':256,'cpu_percent':25,'tasks_max':64,'timeout_seconds':60}}
 (E/'runtime-limits-and-listeners.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'limits':'pass','service_memory_mib':mem,'cpu_percent':cpu,'loopback_listeners':len(pilot)}))
def wait_ready(window):
 until=time.monotonic()+15
 while time.monotonic()<until:
  remaining_window(window,time.time(),time.monotonic())
  states=[show(name) for name in NAMES]
  assert not any(state.get('ActiveState')=='failed' for state in states),'pilot unit startup failed'
  rows=[row for row in sockets() if row['port'] in PORTS]
  if all(state.get('ActiveState')=='active' for state in states) and len(rows)==9 and {row['port'] for row in rows}==set(EXPECTED_PORTS):return
  time.sleep(0.5)
 raise RuntimeError('pilot startup readiness timeout')
def apply_runtime_cap(names,window):
 remaining=remaining_window(window,time.time(),time.monotonic())
 for name in names:
  run('systemctl','--user','set-property','--runtime',name,'RuntimeMaxSec='+str(remaining)+'s')
  window['unit_runtime_seconds'][name]=remaining
 save_window(window)
 return remaining
def start():
 existing=(E/'runtime-window.json').exists();window=load_window() if existing else None
 if window is not None:verify_runtime_files(window)
 preflight(window=window)
 assert (E/'prestart-gates.json').is_file(),'prestart gate receipt missing'
 gates=json.loads((E/'prestart-gates.json').read_text());assert gates['passed'] is True
 if window is None:
  hashes=runtime_hashes();window=new_window(time.time(),time.monotonic());window['runtime_hashes']=hashes;save_window(window)
 try:
  for n in NAMES:run('systemctl','--user','link','--runtime',str(A/'observability/pilot/units'/n))
  run('systemctl','--user','daemon-reload')
  if existing:apply_runtime_cap(NAMES,window)
  run('systemctl','--user','start',*NAMES)
  wait_ready(window)
  limits()
 except BaseException:
  stop();raise
def peer_snapshot():
 peers={}
 for name in NAMES:
  if name=='aeon-pilot-alloy.service':continue
  state=show(name);assert state.get('ActiveState')=='active' and int(state.get('MainPID','0'))>0,'Alloy action requires the other pilot services to remain active'
  peers[name]={key:state.get(key) for key in ('ActiveState','MainPID','ControlGroup')}
 return peers
def outage():
 window=load_window();verify_runtime_files(window);limits();peers=peer_snapshot()
 d=stop_selected(['aeon-pilot-alloy.service'],'alloy-outage.json',{14317,14318,12346})
 assert peer_snapshot()==peers,'another pilot service changed during the Alloy outage'
 remaining=remaining_window(window,time.time(),time.monotonic())
 d.update({'global_started_at':window['started_at'],'global_deadline_at':window['deadline_at'],'deadline_epoch':window['deadline_epoch'],'remaining_window_seconds':remaining,'other_pilot_services':peers})
 (E/'alloy-outage.json').write_text(json.dumps(d,indent=2)+'\n')
 print(json.dumps({'alloy_outage':'pass','remaining_window_seconds':remaining}))
def recover_alloy():
 window=load_window();verify_runtime_files(window);receipt=json.loads((E/'alloy-outage.json').read_text())
 assert receipt['deadline_epoch']==window['deadline_epoch'] and receipt['global_started_at']==window['started_at'],'Alloy outage belongs to another runtime window'
 name='aeon-pilot-alloy.service';state=show(name,check=False)
 assert state.get('LoadState')=='loaded','Alloy recovery requires the original linked unit'
 validate_retry_unit(state,name);peers=peer_snapshot()
 assert peers==receipt['other_pilot_services'],'another pilot service changed before Alloy recovery'
 try:
  budget=apply_runtime_cap([name],window)
  run('systemctl','--user','start',name)
  wait_ready(window);limits()
  assert peer_snapshot()==peers,'another pilot service changed during Alloy recovery'
  d={'at':datetime.now(timezone.utc).isoformat(),'global_started_at':window['started_at'],'global_deadline_at':window['deadline_at'],'deadline_epoch':window['deadline_epoch'],'alloy_runtime_max_seconds':budget,'remaining_window_seconds':remaining_window(window,time.time(),time.monotonic()),'other_pilot_services':peers,'all_four_limits_verified':True}
  (E/'alloy-recovery.json').write_text(json.dumps(d,indent=2)+'\n')
  print(json.dumps({'alloy_recovery':'pass','runtime_max_seconds':budget,'all_four_limits_verified':True}))
 except BaseException:
  stop_selected([name],'alloy-recovery-failure.json',{14317,14318,12346});raise
if __name__=='__main__':{'preflight':preflight,'start':start,'stop':stop,'limits':limits,'outage':outage,'recover-alloy':recover_alloy}[sys.argv[1]]()
