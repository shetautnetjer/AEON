# Synthetic telemetry lifecycle result

The single approved actual lifecycle completed successfully: **14 checks passed, zero failed, zero not run**. It emitted one 25-span synthetic batch, verified initial readback, completed a qualified graceful Tempo stop, took the one conditional restart, verified durable readback of the same batch, and completed a fresh final graceful stop and cleanup. This qualifies exposed synthetic telemetry infrastructure; memory behavior, learning usefulness and release remain unqualified.

Approval `Sentinel_98128e977dd8819184a6adbdea5ca5d7` at **22:20:44 UTC** covered [packet `def5f3fd7d98795dd6c3373f036bb761a8b146e8`](tempo-lifecycle-offline-repair-2026-09-30.md). The initial preflight failed before opening a runtime window because systemd implicitly loads an inactive fragmentless slice. That separate attempt remains zero passed/two failed/twelve not run. The [independently reviewed pre-start correction](tempo-implicit-slice-preflight-correction-2026-09-30.md), actual execution commit **`5f9bcf4d74f873b27870824ac84e879759a7258d`**, passed 241 locked-fixture tests and eight independent tests plus 26 adversarial checks. It changed no runtime limits, telemetry/content capture or graceful-stop criteria.

The actual window opened **2026-09-30 22:31:31.076041 UTC**, with deadline **22:46:31.076041 UTC**, including cleanup. All planned stages completed in **188.618750 seconds**, approximately **22:34:39.694791 UTC**. The 15 minutes were a maximum; no minimum soak was requested.

| Check | Result and retained evidence |
|---|---|
| Fresh preflight / inert prerequisites | Passed; 43 current source pins, pinned installed library and acquired artifacts/dependencies; six inert validators |
| Isolation and limits | Four services, one empty accounting slice, one bounded emitter; nine TCP loopback listeners; combined 2,176 MiB / 2.25 CPU, zero swap, 576 tasks; kernel parent limits verified |
| Single synthetic emission | 25 spans / six traces / five canonical API calls; one provider, mocked transport; sensitive sentinel absent; no second emission |
| Initial and durable readback | Both passed exact 25-span/six-trace identity, parent, name, status and metadata checks through 12 endpoints; metrics both retain five calls, two errors, five duration observations |
| First graceful shutdown | Passed in 30.083070 s; same retained invocation, exit zero, no signal/forced kill, completion milestone, no processes/listeners and unchanged peers |
| Conditional restart | Exactly one; fresh Tempo invocation, same peer identities, no additional spans; same batch survives restart |
| Final shutdown / cleanup | Passed in 30.083482 s; raw retained final exit class/status `1/0` matches restarted invocation; zero hierarchical `oom` and `oom_kill`; no forced units; accounting slice stopped, references released |
| Independent physical shutdown | All four services, scope and slice inactive, empty/missing cgroups, 18 service PIDs and two emitter PIDs gone, no pilot listeners; verified before deadline |
| Preservation | All 74 original snapshot hashes and 39 pinned prior failed-run receipts match; five protected files verified; original Tempo `Result=timeout` remains; selected collector listener snapshot unchanged |

The collector snapshot exposes no owner PIDs. Its equality verifies selected listeners, not independent collector process identity. A host observation found 374,157,312 bytes in the parent cgroup during the run; that is one current-usage sample, not a peak or future production RAM estimate.

The [safe result receipt](../observability/pilot/evidence/tempo-lifecycle-synthetic-result-2026-09-30.json) pins all 17 retained JSON runtime receipts, selected post-stop evidence and the separate controller log. Raw synthetic traces and service state remain in ignored `var/tempo-shutdown-check/tempoLife20260930B/`. Both earlier failed qualifications and the failed preflight remain preserved. Independent read-only review recomputed the trace/metric denominators, checked retained terminal fields, physical cleanup and preservation, and found no discrepancies or remaining infrastructure-lifecycle blocker.

No downloads, real sessions, actual model/provider requests, external telemetry destination, memory admission, AYA/Hermes provider cutover or remote push occurred. Unit registrations and synthetic stores remain for review; nothing was enabled at boot. No further live attempt follows from this completed approval.

The next bounded Brainstem implementation is preparation-only evidence validation in the existing candidate evaluator: bind selected task identities, permitted arm access/budgets, predeclared exclusions and exposure/screening records without calling consumers or the artifact verifier. It must keep all invalid-inclusive comparison accounting, preserve v0 and frozen material, and leave unseen/utility/release claims unverified. Experiment roles, accepted material/freeze/treatment and live execution remain later decisions.
