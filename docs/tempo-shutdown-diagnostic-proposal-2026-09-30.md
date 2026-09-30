# Tempo shutdown: offline diagnosis and next bounded test

Prepared from the completed [synthetic pilot result](observability-pilot-result-2026-09-30.md) at `a94230342b2aa1599736cd3c93fd1039cb5c486b`, retained local logs/configuration and exact 3.1.0 source. **No service was restarted, configuration changed, package acquired or model invoked for this diagnosis.** [Machine-readable evidence and qualifications](../observability/pilot/evidence/tempo-shutdown-offline-analysis-2026-09-30.json) retain source references. The original run and its failed graceful-shutdown evidence remain unchanged.

## Finding and decision

| Claim | Evidence class and conclusion |
|---|---|
| systemd interrupted Tempo after 25 seconds | **Observed.** Stopping began 19:08:29.050576 UTC; timeout occurred 19:08:54.129936; exit was signal 9. Empty control groups/no listeners were subsequently verified. |
| OOM caused the exit | **Unsupported.** Recorded cgroup memory events were zero; unit result was stop timeout. |
| An intentional `shutdown_delay` caused 25 seconds of waiting | **Unsupported.** Authored YAML/arguments do not set it; exact revision's default is zero. |
| Backend-worker finishing may exceed the unit grace | **Supported possibility.** Acquired binary help and revision `77fc4563d` source set `finish_on_shutdown_timeout=30s`. Worker code can retain a job context after parent cancellation; it does not impose an unconditional 30-second sleep. No retained log establishes which job/request was in flight. |
| The server can exceed the unit grace | **Supported possibility.** Tempo's pinned dskit dependency defaults HTTP graceful shutdown to 30s. Its subsequent gRPC `GracefulStop()` call has no deadline in that method. This is not proof that either server phase delayed this run. |
| Live-store flush caused the hang | **Hypothesis.** Source stops lifecycle services and cuts traces to WAL before stopping background work. The original `warn` logging does not retain the INFO lifecycle milestones needed to locate the delay. |
| “queue is stopped” establishes the old frontend queue bug | **Unsupported.** It is an observed shutdown RPC error; the acquired 3.1.0 changelog already lists that queue shutdown fix. |

**No deterministic fix is justified yet.** Do not shorten worker finishing/flush intervals or claim a larger stop timeout fixes the cause. Do not reclassify bounded forced termination as graceful success. Keep the original 25-second unit/config pins untouched. A 90-second grace is proposed below only as a diagnostic allowance, with a hard overall deadline.

Public source references are narrowly tied to the acquired binary revision: [backend-worker defaults](https://raw.githubusercontent.com/grafana/tempo/77fc4563d/modules/backendworker/config.go), [root shutdown-delay default](https://raw.githubusercontent.com/grafana/tempo/77fc4563d/cmd/tempo/app/config.go). The [3.1.0 worker implementation](https://raw.githubusercontent.com/grafana/tempo/v3.1.0/modules/backendworker/backendworker.go) describes cancellable job finishing; [live-store stopping](https://raw.githubusercontent.com/grafana/tempo/v3.1.0/modules/livestore/live_store.go) describes WAL/lifecycle teardown. [3.1.0 go.mod](https://raw.githubusercontent.com/grafana/tempo/v3.1.0/go.mod) pins dskit `de1ec7541c44`; its [server shutdown implementation](https://raw.githubusercontent.com/grafana/dskit/de1ec7541c44/server/server.go) explains the HTTP/gRPC distinction. These source reads are evidence for supported controls/code paths, not a new compiled implementation or proof of the original in-flight task.

## Exact proposed diagnostic scope — approval pending

Reuse the already hash-verified **Tempo 3.1.0, Grafana OSS 13.2.3, Alloy 1.20.1, Prometheus 3.15.0 and isolated synthetic Python fixture**. No downloads, installations, live-profile bindings or credentials. Use a **fresh, exclusively owned run namespace** and four new temporary user units named `aeon-tempo-check-{tempo,alloy,prometheus,grafana}-<run-id>.service`; never operate on the old pilot units, existing collectors or wildcard unit sets. Do not enable boot startup.

The one disposable emitter uses its own fresh `aeon-tempo-check-emitter-<run-id>.scope`: 256 MiB, 25% CPU, zero swap, 64 tasks, 60-second timeout plus 5-second kill grace. Record and verify its owned control group; include it in the same absolute deadline, failure cleanup and empty-group/dead-PID checks. Refuse emitter startup unless its full 65-second allowance plus the final-stop reserve remains.

Proposed inert drafts: `AEON/observability/pilot/diagnostics/tempo-shutdown-v1/`. Proposed exclusive state/evidence: `AEON/var/tempo-shutdown-check/<run-id>/`. Rebind only pilot state/config/receipt paths to this namespace. Original artifacts, fixture source and wheel environment can be reused read-only; fixture HOME/runtime/output paths must be fresh. The original `AEON/var/observability-pilot/` remains untouched. The diagnostic drafts, namespace binding and bounded supervisor are **not yet implemented or runtime-qualified**.

The original controller assumes a 25s grace and 35s subprocess timeout, and its saved window is expired. It must not be replayed as-is, patched by unreviewed monkey-patching, or allowed to overwrite old receipts. Before any approved start, prepare the small diagnostic binding with regression tests for namespace ownership, 90s Tempo stop handling, full cgroup cleanup, counters and deadline reservation; independently review it and validate all inert configs with the existing binaries. Preserve original-default behavior in the existing controller. Failed preflight blocks startup.

| Boundary | Exact requested setting |
|---|---|
| Overall lifetime | **15 minutes maximum from first service start, including both stops and the one restart**; original expired approval/window is not reused |
| Tempo lifecycle observation | `server.log_level: info`; received/discarded span-body logging remains disabled; no debug/pprof/raw-content capture |
| Stop allowance | Tempo **90s** diagnostic `TimeoutStopSec`; other services **25s**; `KillMode=control-group`, `Restart=no` |
| Ingestion | One fixed mocked batch, **25 synthetic spans / six traces / five canonical API calls**; no second emission after restart |
| Resources | Services **1,920 MiB / 200% CPU**, emitter **256 MiB / 25% CPU**, total **2,176 MiB / 2.25 cores**; same zero-swap/task ceilings |
| Ports | Same nine TCP loopback ports: 14317/14318/12346, 13200/24317/24318/19095, 19090, 13000; recheck all are free before start |
| Storage | Private state, unchanged 24h retention while running; **10 GiB monitored aggregate** across old pilot state, shared artifacts and new diagnostic state; no hard quota or automatic deletion |
| Destinations/access | Loopback services only; content-off/allowlists and anonymous synthetic-only Grafana Viewer retained; usage/update/plugin/cloud checks disabled |
| New data | Synthetic span metadata, exact identities/statuses/timings, bounded metrics, INFO lifecycle module messages, selected effective config fields and unit/cgroup stop evidence; no real sessions, model requests or credentials |

The supervisor must reserve **at least 95 seconds** for final stop/verification before the absolute deadline, calculate the remaining allowance before every phase/restart and refuse insufficient time. **Final service stop requests must run concurrently** so this reserve covers the maximum 90-second grace plus verification; serial stops are not permitted under this reserve. Per-unit runtime expiry must fall early enough to include its stop grace. Stop/force-kill only the four positively identified diagnostic service control groups and the owned emitter scope if a gate fails or the deadline is reached; verify empty groups/dead owned PIDs/no listeners. The maximum applies to the whole attempt, including retries; it cannot reset with Tempo's restart. No higher limits or automatic second diagnostic attempt.

## Procedure and acceptance

1. Recheck source/artifact/config hashes, original evidence preservation, private exclusive state, ports, available disk and effective CPU/memory/pid controls. Validate INFO logging without span-body logging. Use a separately reviewed diagnostic binding; no active Hermes profile or `.pth` activation.
2. Start the four diagnostic units. Record only selected runtime config fields from local `/status/config` (shutdown delay, worker finish timeout, server graceful timeout, live-store flush/lifecycle controls), INFO module lifecycle logs, unit properties and owned-process loopback connections. Record actual values rather than assuming all source defaults are effective. Leave original worker/server/flush timing unchanged.
3. Emit the one fixed batch through the existing mocked-transport/privacy boundary. Verify exactly 25 span IDs/parents/statuses/typed attributes in Tempo and anonymous Grafana, and canonical metrics 5 calls/2 errors/5 observations. Stop emitting and finish all readback; **quiesce for 40 seconds** with no further ingestion/readback requests before SIGTERM.
4. Stop **only diagnostic Tempo** with the 90s allowance; leave the other three diagnostic peers unchanged. Record request/exit timestamps, INFO module milestones, result/exit signal, memory events and empty owned cgroup/no Tempo ports. A timeout, SIGKILL, OOM, missing trace or privacy failure **fails the gate and aborts the attempt**; stop the other diagnostic units and retain evidence. Do not restart following this failed gate.
5. Only after graceful stop succeeds and sufficient total time remains, restart **diagnostic Tempo once** using the same fresh diagnostic store. Emit **zero additional spans**. Verify the original six trace IDs/all 25 exact spans through Tempo and Grafana after readiness. This tests durability across this controlled graceful restart only; it does not establish recovery of the original force-killed store.
6. Quiesce readback again and request all four diagnostic stops concurrently before the absolute deadline, retaining the 95-second reserve. Require Tempo's second graceful stop as well as empty service/emitter groups, no surviving owned PIDs/listeners, unchanged existing collector owners and source/profile pins. Retain state/evidence for review.

Record **passed / failed / not run** separately: lifecycle visibility, effective controls, first graceful stop, restart durability, second graceful stop, bounded total lifetime, complete span denominators, privacy, OOM, peer/collector preservation and cleanup. A graceful stop requires systemd `Result=success`, exit status zero, no force-kill and matching completion milestones; merely increasing wait time is not acceptance. A 90-second failure yields better diagnostic evidence, not permission for another adjustment/run. `utility_qualified=false`, `release_evaluated=false` throughout.

Rollback: stop only positively owned diagnostic units/scopes and leave synthetic state/evidence retained. No active install/export route or original config needs restoration. Deleting reviewed diagnostic state/unit registrations remains a separate decision.

**One creator decision:** May Codex run this one new 15-minute, 25-span, local-only diagnostic with four isolated units, a 90-second Tempo stop allowance, one restart only after graceful stop, the unchanged 2,176 MiB/2.25-core ceilings and retained synthetic evidence? This authorizes that new runtime window only after offline binding/tests/review pass; no packages, real traffic, model access, active AYA integration or memory admission.
