"""Finite synthetic spans through the approved loopback receiver; never real HTTP models."""
import argparse
from collections import Counter
from datetime import datetime,timezone
import hashlib,json,os,socket,sys
from pathlib import Path


def validate_emitter_limits(limits):
    assert int(limits['memory.max']) == 256*1024**2
    assert limits['memory.swap.max'] == '0' and limits['pids.max'] == '64'
    quota, period = map(int, limits['cpu.max'].split())
    assert quota/period == 0.25


def effective_emitter_limits():
    row, = [line for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')]
    group = Path('/sys/fs/cgroup'+row.split('::',1)[1])
    limits = {name:(group/name).read_text().strip() for name in ('memory.max','memory.swap.max','pids.max','cpu.max')}
    validate_emitter_limits(limits)
    return {'group':str(group),'limits':limits}


def validate_case(case, result):
    assert result['provider_calls'] == 1 and result['context_balanced'] is True
    assert result['transport_calls'] == (2 if case == 'retry' else 1)
    if case == 'retry': assert result['retry_counts'] == [0,1]
    if case in ('error','cancel'):
        assert result['error_type'] == {'error':'InternalServerError','cancel':'CancelledError'}[case]
        assert result['same_error'] is True
    else: assert 'error_type' not in result
    if case in ('stream','cancel'): assert result['stream_closed'] is True


def export_synthetic(exporter, spans, *, expected_outage=False):
    from requests.exceptions import ConnectionError
    from opentelemetry.sdk.trace.export import SpanExportResult
    try:
        try:
            verdict = exporter.export(spans)
        except ConnectionError:
            if not expected_outage:
                raise
            return {'export_verdict':'FAILURE', 'bounded_export_error_type':'ConnectionError'}
        assert verdict == (SpanExportResult.FAILURE if expected_outage else SpanExportResult.SUCCESS)
        return {'export_verdict':verdict.name}
    finally:
        exporter.shutdown()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fallback-site',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--outage',action='store_true')
    parser.add_argument('--dry-run',action='store_true',help='construct finite sanitized spans without exporter traffic')
    args=parser.parse_args()
    assert not args.output.exists() and not args.output.is_symlink(), 'receipt already has an owner'
    resources=effective_emitter_limits()
    sys.path.append(str(args.fallback_site))
    def audit(event,values):
        if event=='socket.connect' and values[1]!=('127.0.0.1',14318):
            raise RuntimeError('only the approved loopback exporter is permitted')
        if event=='socket.getaddrinfo' and values[0]!='127.0.0.1':
            raise RuntimeError('non-loopback resolution is denied')
        if event in ('socket.bind','socket.sendto','socket.sendmsg'):
            raise RuntimeError('listener or datagram operations are denied')
    sys.addaudithook(audit)
    import requests
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from instrumentor_harness import InstrumentorHarness,CANARY
    with InstrumentorHarness() as h:
        results=[]
        cases=('success',) if args.outage else ('success','error','stream','retry','cancel')
        for i,case in enumerate(cases):
            result=h.run_case(case,session_id='synthetic-'+case,task_id='task-'+case,api_request_id='attempt-'+case)
            validate_case(case,result)
            results.append({k:v for k,v in result.items() if k in {'transport_calls','provider_calls','error_type','same_error','stream_closed','context_balanced','retry_counts'}}|{'case':case})
        if not args.outage:
            tracer=h.plugin._tracer_provider.get_tracer('hermes.synthetic-fixture')
            with tracer.start_as_current_span('agent.synthetic-memory',attributes={'session.id':'synthetic-memory'}) as parent:
                for name,attributes in (
                    ('tool.memory_lookup',{'gen_ai.tool.name':'memory_lookup','gen_ai.tool.call.id':'synthetic-tool-1','hermes.tool.outcome':'completed','gen_ai.operation.name':'execute_tool'}),
                    ('lookup.fixture',{'hermes.lookup.result':'eligible','gen_ai.operation.name':'lookup'}),
                    ('decision.fixture',{'hermes.tool.outcome':'abstained','hermes.lookup.result':'abstained'}),
                    ('decision.verify',{'hermes.verification.result':'verified','hermes.tool.outcome':'verified','gen_ai.operation.name':'verify'})):
                    with tracer.start_as_current_span(name,attributes=attributes):pass
        spans=h.flush();assert 0<len(spans)<=1000
        expected_categories = {'agent':1,'llm':1,'api':1,'sdk':1} if args.outage else {'agent':6,'llm':5,'api':5,'sdk':5,'tool':1,'lookup':1,'decision':2}
        assert Counter(s.name for s in spans) == expected_categories
        apis = [s for s in spans if s.name=='api']
        assert sum(s.status.status_code.name=='ERROR' for s in apis) == (0 if args.outage else 2)
        serialized=[json.loads(s.to_json()) for s in spans]
        assert CANARY not in json.dumps(serialized)
        for s in spans:
            assert not s.events and not s.links and not s.context.trace_state
            assert s.status.description is None
        expected=[{'trace_id':format(s.context.trace_id,'032x'),'span_id':format(s.context.span_id,'016x'),'parent_span_id':format(s.parent.span_id,'016x') if s.parent else None,'name':s.name,'status':s.status.status_code.name,'attributes':dict(s.attributes or {})} for s in spans]
        started=datetime.now(timezone.utc).isoformat()
        export_result={'export_verdict':'NOT_RUN'}
        if not args.dry_run:
            session=requests.Session();session.trust_env=False
            exporter=OTLPSpanExporter(endpoint='http://127.0.0.1:14318/v1/traces',session=session,timeout=1.0)
            export_result=export_synthetic(exporter,spans,expected_outage=args.outage)
        origins={}
        for name in ('openai','opentelemetry.trace','opentelemetry.sdk.trace','opentelemetry.instrumentation.openai','opentelemetry.exporter.otlp.proto.http.trace_exporter','requests','yaml'):
            module=sys.modules.get(name)
            if module and getattr(module,'__file__',None):
                file=Path(module.__file__).resolve()
                origins[name]={'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
        group=Path(resources['group'])
        resources['memory_peak_bytes']=int((group/'memory.peak').read_text())
        resources['memory_events']=dict(line.split() for line in (group/'memory.events').read_text().splitlines())
        assert resources['memory_events']['oom']=='0' and resources['memory_events']['oom_kill']=='0'
        out={'started_at':started,'ended_at':datetime.now(timezone.utc).isoformat(),'synthetic_only':True,'outage_expected':args.outage,'dry_run':args.dry_run,**export_result,'span_count':len(spans),'canonical_api_count':sum(s.name=='api' for s in spans),'categories':dict(Counter(s.name for s in spans)),'case_results':results,'expected_spans':expected,'transport_policy':'httpx.MockTransport only for OpenAI; approved127.0.0.1:14318 only for OTLP','provider_instance_count':1,'effective_emitter_resources':resources,'imported_origins':origins,'sensitive_sentinel_absent':True,'utility_qualified':False,'release_evaluated':False}
        fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as file: file.write(json.dumps(out,indent=2)+'\n')
        print(json.dumps({k:out[k] for k in ('outage_expected','export_verdict','span_count','canonical_api_count','categories')}))
    return 0

if __name__=='__main__':raise SystemExit(main())
