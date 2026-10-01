# AEON-EVENTS-001 — revision 2 independent architecture verdict

**Verdict: ACCEPTED FOR M1 IMPLEMENTATION ONLY.** No remaining planning blocker prevents the three-file, fixture-only AEON slice. R1–R5 are resolved adequately for that boundary. Live Paperclip adoption, native digest enforcement, adapter qualification and model/account execution are not accepted by this verdict.

Reviewed: [revision 2 plan](../work/active/AEON-EVENTS-001-plan-2026-10-01.md), exact bytes:

```text
SHA256 6b1ab38939cfd9b18edcfd0a4187f9b70360ef38847c439284cf5ed376aa7512
```

Date: 2026-10-01. Reviewer task: `01a0f621-2449-724c-9d02-7413f344b038`, separate from the plan producer. Requested setting remains Astra/xhigh; effective model/effort/tier provenance remains with the parent’s task-creation receipt. This is an independent architectural recheck, not implementation acceptance.

**Proceed:** Mufasa may assign M1 to Sol/high under the existing source-work scope, followed by a fresh Sol/medium code review of the exact implementation and relevant checks. Routine scoped implementation, tests and fixes need no repeated creator approval. Preserve the [first review](AEON-EVENTS-001-architecture-review-2026-10-01.md) and [frozen v1](../work/active/AEON-EVENTS-001-plan-v1-reviewed-2026-10-01.md).

**Disposition of the five findings**

| Finding | Independent disposition |
|---|---|
| **R1 — exact completion and authority** | **Resolved for M1 by specifying the validator and narrowing the guarantee.** Plan lines 138–142 bind task/attempt, producer run, frozen criterion/selection, manifest bytes, reviewer principal/run, verdict and evidence class before AEON accepted completion. Trusted fixture policy is separate from observations/prose; forged permission cannot enable effects. Native `done` without a valid tuple stays observed/unaccepted. Strict native digest prevention is explicitly unsupported. This accurately matches [native policy’s comment-based approval branch](/home/aya-hmw/aya/projects/paperclip/server/src/services/issue-execution-policy.ts:786) and the [snapshot helper’s limits](../worktrees/brainstem-snapshot-publication/automation/README.md:84). The later cooperating final-user workflow is a deployment option, not a server-enforced digest guarantee or an M1 implementation requirement. |
| **R2 — engine, replacement and budget** | **Resolved as a scoped design; live enforcement remains gated.** Lines 75–81 pin CLI, the installed adapter and stock binary; exclude ACP, saved-session inputs, replacement and recovery continuation; separate child invocations, probes and provider requests. Fresh-only admission avoids the inspected missing-resume branch, but is not claimed qualified. [Installed execute.js:1227](/home/aya-hmw/.paperclip/cli/installs/npm/2026.916.1/node_modules/@paperclipai/adapter-codex-local/dist/server/execute.js:1227) still performs an internal fresh retry for an unknown resumed session. The plan correctly leaves M3 unsupported unless native admission and automatic recovery can enforce the restriction. M1 launches neither path. |
| **R3 — owner, custody and synchronization** | **Resolved for implementation.** Lines 159–173 assign the existing AEON repository, name exactly three code/test files, use disposable outputs and specify a stable sidecar `flock`, expected-preimage comparison, atomic publication, fsync, readback and unknown-outcome reconciliation. Mufasa remains the external custodian; no replacement model, dispatcher, real STATUS writer or Brainstem modification is introduced. Lines 111 and 117 prevent premature native acceptance and require a single-authority cutover packet. |
| **R4 — evidence classes and observed settings** | **Resolved for phased acceptance.** Lines 191–198 distinguish M1 source/fake, M2 process/API, M1b selected-adapter fake/virtual-time and M3 actual model evidence. Configuration/onMeta proves intent, not delivery; missing mandatory metadata stays unknown. The installed [30-minute/null monitor](/home/aya-hmw/.paperclip/cli/installs/npm/2026.916.1/node_modules/@paperclipai/adapter-codex-local/dist/server/output-inactivity-monitor.js:2) is consistent with the proposed virtual-time test. No short process test is promoted to Codex/model qualification. The explicit reserved-canary sequence in line 198 governs the earlier shorthand in line 67; it does not authorize an unbudgeted model preflight. |
| **R5 — comparator and exit** | **Resolved as a testable pilot criterion.** Lines 218–222 freeze one trace and criteria before comparison, include existing platform notifications, retain branch denominators and unknown time, and require at least one fewer coordinator intervention without lost work, duplicate effects, weaker acceptance or increased wakes/recovery. Ties retain current coordination; only one bounded offline follow-up is contemplated. These are future controlled pilot observations, not measured benefit today. |

**Accepted M1 boundary and code-review expectations**

The authored implementation is limited to:

- `tools/coordination_projection.py`
- `tests/test_coordination_projection.py`
- `tests/fixtures/aeon_events_001_trace.json`

The sanitized result/code-review handoff may be written at the plan’s existing output destination. Test payloads, projection JSON and locks remain in owned temporary directories. Bounded local test processes are ordinary model-free verification; this does not permit a Paperclip/Codex/adapter launch.

The fixture must freeze the required selected inputs, role/remit bindings, trace and expected outcomes independently of untrusted evidence. The code reviewer must check actual retained bytes and the planned negative cases, not merely that fixture declarations agree with themselves. Preserve wrong/stale digest, missing selection, self/wrong-attempt review, permission-as-data, duplicate/order/conflict, blocked/cancelled and crash/readback tests. Check cooperating-writer exclusion and post-replace unknown outcomes. No test deletion follows from model prompting guidance.

M1’s checkpoint is a disposable projection checkpoint. It must not acquire dispatch, native task mutation, account authentication, session resume or authority-granting behavior. Same-UID hostile mutation and real account authentication remain outside this fixture guarantee.

**Remaining gates by milestone**

| Milestone | Remaining blocker or required evidence |
|---|---|
| **M1** | No further architecture revision required. Implementation, relevant tests and fresh Sol/medium source-bound review are still pending. This verdict does not certify nonexistent code. |
| **M1b** | Needs its separately bounded source/test assignment and actual fake-CLI/virtual-time results for the selected adapter, confinement, seeded-session rejection, retry accounting, cancellation and cleanup. No credentials, provider access or installed mutation; ordinary authorized source/test work does not itself require another creator confirmation. |
| **M2** | Recognized finite startup envelope; isolated state/listener/process tree, scripted identities, telemetry suppression, owned stop, API/claim behavior and real participant permissions. [Auth middleware:220](/home/aya-hmw/aya/projects/paperclip/server/src/middleware/auth.ts:220) confirms that `local_trusted` begins with implicit board authority, so that mode alone cannot prove worker separation. Any final-user action must count honestly in the benefit comparator. |
| **M3** | Accepted M1b/M2 evidence; authorized external-custodian transport/final participant; effective fresh-only admission and bounded recovery; recognized account/provider/bookkeeping scope and budget; actual mandatory model/effort/tier observations. Two default worker reservations permit one producer and one review invocation only. An adverse real verdict ends that allowance unless a repair run was expressly included; the scripted adverse-review/repair trace is not evidence of extra actual model runs. No strict native digest-enforcement claim. |
| **M4 / native lane** | Qualifying pilot evidence and benefit, separately scoped project work, and existing native authorization/plugin-delivery gates. Native AYA remains never launched after two denials. No Paperclip route may retry or bypass that blocked action. |

No live Mufasa agent is implied by the roster shorthand: the concrete M1/M3 custody definitions keep the existing external thread. Approval of this document must not be mirrored into native Paperclip plan acceptance, which can start execution, before its effect gates are satisfied.

**Evidence and preservation**

I read the revised bytes rather than relying on the forwarded summary, rechecked applicable AEON instructions, the named owner/test layout, relevant snapshot contract/source, Paperclip approval/auth/issue schema/engine/arguments, and the installed retry/monitor paths. No implementation or experiment was run.

Fresh hashes match all four installed adapter pins in L7. The stock Codex binary matches `1748767b230ebfc3d4ab7e4e254920d0c0ad9691fd8c11f190e7d44511a4a92e`; this is file provenance, not an executed version or model test. Paperclip remains clean at `d554c4789ed3930f8a53ac9fdf6503b3187097da`. The three proposed M1 files did not exist at review time.

The prior review remains SHA256 `99cf56a9c4390543864a9d2a9c46ffc70407076d4f18442089c83009004a9439`; frozen v1 retains `0bc3115d327cab006fb19b5803c5c227ac71783360e7ea0f24205baeba1bd77f`. Original Brainstem retains HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be`, 63 porcelain entries and status SHA256 `ea08bdb4367bb74c00a3b6d23612e1aa4e35393c7843831cf02a8957308ba72b`. This is a status-preservation check, not a bytewise audit of all dirty contents.

Only this new review artifact is authored by the recheck. Plan, previous review, runtime, services, configuration, credentials and original source remain untouched.
