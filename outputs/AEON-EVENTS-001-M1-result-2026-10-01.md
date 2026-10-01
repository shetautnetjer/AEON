# AEON-EVENTS-001 — accepted fixture-only M1 result and procedure handoff

Date: 2026-10-01. **M1 accepted for fixture-only source and bounded local tests. Live Paperclip coordination is not adopted or activated.** This result closes the existing M1 implementation/review milestone, not the overall coordination task.

Custodian: Mufasa's existing external thread `01a0f1d4-7399-736b-915a-138dc8a2103f`. Implementation requested Sol6.1/high, normal/default tier; independent code review requested Sol6.1/medium, normal/default tier. Architecture review requested Astra/xhigh. Effective delivery settings are not exposed by filesystem receipts; parent task-setting provenance remains its owner. No substitute Mufasa model, new queue, account identity or dispatcher was created.

## Acceptance and exact source

The [frozen revision-2 plan](../work/active/AEON-EVENTS-001-plan-2026-10-01.md), SHA256 `6b1ab38939cfd9b18edcfd0a4187f9b70360ef38847c439284cf5ed376aa7512`, was [accepted for M1 implementation only](AEON-EVENTS-001-architecture-review-r2-2026-10-01.md). Its original review-time disposition remains frozen; this later acceptance supplies current status without changing reviewed bytes.

[Independent r2 code acceptance](AEON-EVENTS-001-M1-code-review-r2-2026-10-01.md), SHA256 `9cb01d1a194e751367f07c4914e9ddafe9f30efafa7cd9f4c09370cc47a3dd2e`, accepts these exact bytes. Closure readback verified all three hashes; no code changes followed acceptance.

| Source/test owner | SHA256 |
|---|---|
| [Validator](../tools/coordination_projection.py) | `318def55c180c249db7efb26e7aeef9929dbc1a7f99eb645642f73cc0f7926c0` |
| [Regression and coordination tests](../tests/test_coordination_projection.py) | `1e35a651208a80bbb91204ee19d6a9ce9801def5fe90bc5983042dcb3d8523a7` |
| [Frozen trace fixture](../tests/fixtures/aeon_events_001_trace.json) | `9104db4f1d6d5736bff891841284913476c45f78da3a5293de3156979b6ded07` |

The tool validates selected retained bytes, frozen criteria, task/attempt/producer and independent reviewer bindings before accepted completion in a disposable AEON projection. Native status alone does not establish acceptance. Stable cooperating-writer locking, expected-preimage checks, atomic publication and durable readback support replay/conflict handling. Cancellation and denial-blocked checkpoints cannot acquire successor effects.

## Verification and preserved failures

| Evidence | Result and qualification |
|---|---|
| Producer repaired source, actual AEON checkout | 34 focused / 49 full tests passed, zero failures/not-run; observed 2026-10-01T07:38:28Z. Closure reverified matching bytes, without rerunning unchanged code. |
| Independent repaired source in disposable copy | 34 focused / 49 full tests passed, zero failures/not-run; seven original plus eight additional edge scenarios exercised. Source/fake and bounded fixture filesystem/process evidence only. |
| Pre-repair regression | 33 test methods; 13 failing subtest assertions and one malformed-JSON error against rejected source. Retained, not treated as green results. |
| Previous independent review | [First code REVISE](AEON-EVENTS-001-M1-code-review-2026-10-01.md), SHA256 `59d8cd89dc3c190cdeb28894538e5ee80fe416b99100756dec29c0838d25bac2`; both P2 findings resolved by the independent r2 verdict. |

Reproducible source-only checks, from AEON:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_coordination_projection.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

Retained producer handoff: [hash/scope manifest](/home/aya-hmw/Documents/Codex/2026-09-30/task-6/M1-r2-review-manifest.json), [test receipts](/home/aya-hmw/Documents/Codex/2026-09-30/task-6/M1-r2-test-results.json), [failed regression log](/home/aya-hmw/Documents/Codex/2026-09-30/task-6/M1-r2-regression-red.log). These are separate supporting workspace receipts, not a second artifact queue. Full addition patch SHA256 `690050417012b276c468a04d21981cf3a1396c442c51c2775eed7a397882511d`; repair-only patch SHA256 `fdf2d6272a337ad78d66ee41b0c9a96ca210efedf8c05634d06cff6ca6292345`.

The [first architecture REVISE](AEON-EVENTS-001-architecture-review-2026-10-01.md), [frozen v1](../work/active/AEON-EVENTS-001-plan-v1-reviewed-2026-10-01.md), original code review and regression receipts remain historical evidence. No reviewer verdict is rewritten by this custodial summary.

## Fixture procedure and checkpoint lessons

Use only trusted frozen fixture policy and disposable selected snapshots materialized in an owned `/tmp` directory. Keep untrusted observations/evidence separate. The library has no CLI dispatcher or outgoing native/model API. `apply_observation` takes the explicit draft `projection.json`, expected current-byte hash (or physical absence), supplied evidence and selected snapshot. No real STATUS or task-state mutation is exposed by the tool.

Treat `sync_conflict` as reconciliation with original bytes retained. For `unknown_publication`, read back the exact candidate and exact-retry with the observed preimage before acknowledging a checkpoint. Only a successful published/replayed receipt acknowledges the candidate; a file's visible contents alone do not certify post-replace durability.

Both repaired lessons apply to this checkpoint seam: physical file absence is distinct from decoded JSON null; reconstructible captured-field hashes, acceptance/state and history must agree before replay acknowledgement or stale-state decisions. Current-event replay compares all recomputed fields. Pre-repair drafts lacking `native_observation_sha256` remain conflicts requiring reconciliation, with no automatic migration. This does not authenticate real accounts, exclude hostile same-UID changes, qualify hardware power-loss durability or prove a server-side native digest gate.

## Current custody and next existing gate

AEON owns this source/artifact/navigation slice. Brainstem remains memory/admission authority; no task success is an admitted memory. Closure checks retain original Brainstem HEAD `26e5de877ac3a703e2b4e0c7faab9d43598c68be`, 63 dirty entries and status SHA256 `ea08bdb4367bb74c00a3b6d23612e1aa4e35393c7843831cf02a8957308ba72b`; this is status preservation, not a bytewise dirty-tree audit. Installed AYA pins, historical denials and unrelated `.trigger-tree/` custody remain unchanged.

**Smallest next step toward actual Paperclip coordination: assign the already planned M1b source-only qualification**, using the pinned `codex_local` CLI adapter, fake executable/protocol and virtual time. Check exact engine/confinement arguments, seeded-session rejection and internal retry accounting, quiet/null monitor behavior, cancellation and cleanup. Use empty fixture authentication context, no account files/provider calls, no installed changes. M1b still needs its separately bounded assignment and source-bound review; M1 acceptance does not perform it.

Then Mufasa prepares the existing **M2 ten-minute foreground process/API pilot** packet: one external coordinator and two scripted fixture workers, one synthetic task, exact isolated runtime paths/listener/process tree, native participant permissions, effective telemetry suppression, zero provider calls and owned cleanup. The actual startup command/configuration must be source-qualified in that packet; none is guessed or run here. Recognized runtime permission is required before startup. M3 separately retains external-custodian transport/final participant, exact observed model/settings, fresh-only admission, bounded recovery and account/provider/bookkeeping/budget gates. A tied benefit comparator retains current manual/platform coordination.

The [native AYA task](../work/queued/AYA-NATIVE-CORR-009.md) remains never launched after two denials, with no further retry or alternate route. Paperclip cannot clear that boundary. No service, account/model invocation, credentials, installed AYA/Hermes config, runtime cutover or public release occurs in this closure. The local commit is a source/evidence checkpoint only; no push is requested.
