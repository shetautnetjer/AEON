# Offline Tempo diagnostic binding

This continuation implements the binding proposed at `ecaa4035db61249d28ff3f6fbb874c8f676b9b8e` in [the diagnostic proposal](tempo-shutdown-diagnostic-proposal-2026-09-30.md). It does not authorize or execute a new runtime window. The [original pilot result](observability-pilot-result-2026-09-30.md), its failed 25-second graceful stop and retained state/evidence remain unchanged.

## Scope and source owners

[diagnostic.py](../observability/pilot/diagnostic.py) owns the one finite diagnostic sequence. [diagnostic_config.py](../observability/pilot/diagnostic_config.py) renders the existing seven configs and four unit templates into a fresh run namespace without writing them. [diagnostic_system.py](../observability/pilot/diagnostic_system.py) supplies the explicitly invoked OS adapter. The existing [readback verifier](../observability/pilot/readback.py) receives optional fresh paths and one shared deadline; its default invocation and original schema remain preserved.

The existing expired controller, emitter, instrumentor harness, fixture, configuration templates and unit files remain their original owners. No second plugin implementation, model consumer, collector route, service installation or memory-admission path is introduced. [Diagnostic source pins](../observability/pilot/diagnostic-source-pins.json) identify the new binding and its exact inputs. The sole original runtime-source replacement is the reviewed readback extension; the previous hash stays in the manifest and the original prestart receipt remains unchanged.

## Deadline and qualification

The 900-second window starts immediately before the first start request, after bounded preflight/preparation. Wall-clock forward changes shorten it; wall-clock rollback cannot extend its monotonic deadline. Restart cannot reset it. Every phase requires its whole allowance plus 95 seconds for final cleanup. Unit runtime limits use the remaining window minus 95 seconds and a 30-second startup cushion, initially at most 775 seconds; restarted Tempo receives a smaller cap. Tempo stops have a 90-second unit allowance; peers retain 25 seconds. Final requests stop the four owned units and any owned emitter concurrently. Forced cleanup cannot qualify as graceful success.

Cleanup pins each positively owned cgroup's device/inode and permits new descendants only while that identity and user ownership still match. A replaced group or foreign process is refused. The separately owned emitter launcher must also be stopped/reaped on failure, including failures before its scope exists; an empty scope map alone cannot prove emitter cleanup. Emitter startup rechecks its full 65-second allowance immediately before spawning, and its seven module origins must exactly match approved fixture path/hash pins.

One emission must contain exactly 25 spans, six traces and five canonical API calls. Initial and durability readback each revalidate all 12 direct/anonymous-viewer trace responses against the same receipt, including span IDs, parents, names, statuses and typed metadata; metrics require 5 calls, 2 errors and 5 duration observations. There is no second emission. Quiescence lasts 40 seconds before each stop. The only restart is conditional on the first independently attested graceful stop and sufficient time remaining. The second stop requires fresh evidence from the restarted process.

Missing proof fails closed. In particular, **a removed cgroup has no retained final `memory.events` counter established by the installed systemd documentation**. Cached pre-stop zeros are baseline observations, not proof of zero OOM events during stop. A missing final counter is reported unverified, and prevents restart/graceful qualification even if `Result=success`, exit status zero and a completion milestone are present. This is a known limitation of the strict proposed acceptance, not evidence that OOM occurred. No relaxed criterion or new OOM observer is adopted here.

The readback filesystem scanner checks the same deadline between traversal operations. Python cannot preempt an arbitrary already-blocked filesystem syscall; per-unit runtime expiry and the emitter's separate hard limit remain the service backstop. No result may report a late cleanup as a passed finite run.

## Future approved runtime effects

| Boundary | Exact effect |
|---|---|
| Acquisitions | None. Reuse Tempo 3.1.0, Grafana OSS 13.2.3, Alloy 1.20.1, Prometheus 3.15.0 and the already acquired pinned Python/OpenAI instrumentor fixture. |
| State | Exclusively create `AEON/var/tempo-shutdown-check/<run-id>/`; private config, units, HOME/runtime, storage and evidence. Reject an existing namespace. |
| Unit names | `aeon-tempo-check-{tempo,alloy,prometheus,grafana}-<run-id>.service`; one `aeon-tempo-check-emitter-<run-id>.scope`. Runtime registration only; no boot enablement. |
| Limits | Services 1,920 MiB / 200% CPU, emitter 256 MiB / 25% CPU: 2,176 MiB / 2.25 cores total; zero swap; 128 tasks per service, 64 for emitter. |
| Ports | TCP loopback only: 14317/14318/12346, 13200/24317/24318/19095, 19090, 13000. Existing collector ownership is separately preserved. |
| Capture | Synthetic opaque IDs, approved metadata, statuses, durations, bounded metric dimensions, selected effective config and INFO lifecycle module milestones. No prompts, completions, real sessions, credentials or model requests. Span-body logging flags are explicitly false. |
| Retention/budget | Existing 24h retention while running; retain scoped synthetic state after shutdown. Monitor the same 10 GiB aggregate across original state, shared artifacts and new state; no hard quota or automatic deletion. |
| External destinations | None configured. Existing usage/update/plugin/cloud reporting exclusions are retained. No Respan, NVIDIA or other model/provider binding. |
| Rollback | Stop only positively identified diagnostic groups/units/scopes; retain evidence. Do not operate on original pilot units, existing collectors or wildcard sets. No active install/config restoration is needed. |

## Operator entry point and remaining decision

The default entry point only prints a plan and creates no state:

```sh
python3 -B observability/pilot/diagnostic.py --run-id tempoCheck20260930
```

After separately recorded creator approval, activation uses `--run-approved --approval-reference <nonsecret-approval-id>` in addition to that fresh run ID. The reference records the operator's approval provenance; the flag itself is not approval. Fresh source/artifact/port/ownership preflight and inert binary validation still block startup on failure.

**Pending decision:** approval for the exact one 15-minute local synthetic diagnostic already proposed. Offline code/tests/config preparation requires no further decision. Strict OOM proof remains unchanged: an unverified first stop aborts restart and durability, retaining shutdown evidence. Any future relaxation of that acceptance or additional observer must be separately reviewed; it is not part of this binding.

Final offline verification and independent review are recorded in [the binding verification receipt](../observability/pilot/evidence/tempo-diagnostic-binding-verification-2026-09-30.json). All runtime outcomes remain `not_run`; `utility_qualified=false`, `release_evaluated=false`.
