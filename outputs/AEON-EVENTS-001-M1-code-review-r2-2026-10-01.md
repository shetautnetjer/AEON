# AEON-EVENTS-001 — independent M1 r2 code review

**Verdict: ACCEPTED FOR FIXTURE-ONLY M1.** The two P2 findings in the first code review are resolved for the exact repaired bytes below. No remaining material finding was identified within the accepted M1 scope. No Astra architecture escalation is needed. This verdict does not accept M1b/M2/M3, native closure, adapter/runtime activation or model/account execution.

Date: 2026-10-01T07:44:55.378601+00:00. Requested review setting remains GPT-6.1 Sol / medium / normal-default speed. Filesystem receipts do not independently expose effective model/effort/tier delivery; parent task-creation provenance remains its owner. This is an independent source recheck of the repair, using the original reviewer’s reproductions, not acceptance based on producer test totals.

Applicable AEON instructions and the accepted plan/architecture boundary from the initial review remain governing. The accepted plan, original frozen fixture and first review retain their exact hashes. Original implementation rejection remains historical evidence; this verdict applies only to r2.

## Exact reviewed bytes

| Input | SHA256 |
|---|---|
| Accepted plan | `6b1ab38939cfd9b18edcfd0a4187f9b70360ef38847c439284cf5ed376aa7512` |
| Accepted M1 architecture review | `baede8801c2730b8d9ddfdc3f3c549ec5429c9aeb9c535a7bffc568bb0a6a064` |
| Preserved first code review | `59d8cd89dc3c190cdeb28894538e5ee80fe416b99100756dec29c0838d25bac2` |
| Full r2 patch | `690050417012b276c468a04d21981cf3a1396c442c51c2775eed7a397882511d` |
| Repair-only patch | `fdf2d6272a337ad78d66ee41b0c9a96ca210efedf8c05634d06cff6ca6292345` |
| r2 manifest | `5dd2e92ae87cc02322942628f1ddeeecabf17175b60b64d33d3a712503d2aaac` |
| Producer r2 test receipt | `67590ccb666ccb2fbb74326393c992bcc04e367a971aee020375158b00245107` |
| Retained producer red log | `5314dfae71a61f0b38d2ca9093fa43c5b3706381dfeb39f4d71efd1e06657ad0` |
| tools/coordination_projection.py | `318def55c180c249db7efb26e7aeef9929dbc1a7f99eb645642f73cc0f7926c0` |
| tests/test_coordination_projection.py | `1e35a651208a80bbb91204ee19d6a9ce9801def5fe90bc5983042dcb3d8523a7` |
| tests/fixtures/aeon_events_001_trace.json | `9104db4f1d6d5736bff891841284913476c45f78da3a5293de3156979b6ded07` |

The full addition patch reconstructs all three current source/test/fixture files byte-for-byte. Independently generated a unified diff from the first reviewed source/test bytes to r2: it exactly matches the supplied repair-only patch. No unrelated source change is present in that repair. The manifest’s source HEAD `16039bd1b7d625a98a04e269c69fbf5bfa900c06` is inherited provenance; acceptance here binds the listed bytes.

## Findings disposition

| Prior finding | Independent disposition |
|---|---|
| R1 / P2 — present null/malformed checkpoint | **Resolved.** `apply_observation` lines 449–457 distinguishes physical absence from decoded values and validates every present payload within the conflict path. Original null and malformed reproductions now return `sync_conflict`, preserve exact bytes and emit no effects. |
| R2 / P2 — contradictory replay/checkpoint fields | **Resolved.** `_previous_projection` lines 339–407 checks captured-field checksum, stored acceptance/run bindings, reason/disposition/boolean consistency, monotonic history and exact last-record linkage. Current-event replay at lines 468–472 also compares all recomputed projection fields. Original contradictory completion and edited-version reproductions conflict without overwriting or acknowledging replay. |

The new `native_observation_sha256` is reconstructible from the stored normalized observation even when the original body is intentionally omitted. The existing full observation/evidence digests still bind replay inputs. Checked receipt extraction into `_acceptance_binding` and `_disposition`: task/attempt/producer/criterion/manifest/evidence-class and independent reviewer bindings retain the original checks; accepted completion still requires accepted verdict, observed done and no unfinished obligations. Blocked/cancelled observations cannot acquire acceptance. No effect or authority-granting path was introduced.

Legacy pre-repair drafts lacking the captured checksum return `sync_conflict` with bytes unchanged; there is no automatic migration. This compatibility choice is acceptable for disposable fixture state and explicitly requires reconciliation.

No new severity-ranked finding remains. The consistency checks are not authentication or a guarantee against coordinated hostile same-UID edits, which remain outside the accepted fixture boundary.

## Independent tests and edge checks

Ran from `/tmp/aeon-m1-r2-review-independent`, a disposable copy of exact repaired tools/tests, unchanged fixture and required navigation inputs, with `PYTHONDONTWRITEBYTECODE=1`. Implementation originals were not edited. Existing bounded fixture-process tests ran; no Paperclip, adapter, native AYA, account or service runtime was invoked.

| Check | Result |
|---|---|
| `python3 -m unittest discover -s tests -p test_coordination_projection.py -v` | **34 passed / 0 failed / 0 not run** |
| `python3 -m unittest discover -s tests -v` | **49 passed / 0 failed / 0 not run** |
| Original independent edge scenarios | All seven exercised; four previous defect scenarios now safely conflict, three original guard scenarios retain expected behavior |
| Additional r2 edge checks | Eight asserted scenarios passed: legacy missing checksum, rehashed version/history contradiction, linked full-digest edit, exact accepted/adverse/blocked/cancelled replay and historical accepted-review replay |

Original repro results:

- Existing `b'null'`: `sync_conflict / invalid_fields`; bytes preserved.
- Existing `b'{broken'`: `sync_conflict` carrying parse diagnostic; bytes preserved, no escaped exception.
- Ready checkpoint edited to `accepted_completion=true`: `sync_conflict / stored_completion_state_mismatch`; bytes preserved; the contradictory edit remains for reconciliation rather than being certified.
- Version-3 producer checkpoint’s captured statusVersion edited to 0, followed by untouched version-2 claimed event: `sync_conflict / captured_observation_digest_mismatch`; version-3 history and resolved produce obligation preserved.
- Same version edit with captured checksum recomputed: `sync_conflict / last_history_linkage_mismatch`; bytes preserved.
- Edited full observation digest linked consistently to last history: current replay refuses it as `activity_rebound`.

All returned effect lists are empty. Independent self-review, changed selected payload and blocked-successor probes still fail closed. The complete existing suite rechecks the original digest/selection/remit/permission-data/replay/order/cancellation tests plus stable-lock cooperating writers, preimage conflicts, pre-replace failure, post-replace unknown-publication repair and abrupt-process crash recovery. Normalized bodies and historical replay also remain valid.

Producer retained red log was read and hash-verified: 33 tests, 13 failing subtest assertions and one malformed-JSON error against the originally rejected code. This is inherited failure evidence, not an independent red run. Independent repaired green runs are listed above. The first invocation of the old reviewer probe script assumed null would be overwritten and failed when reading a checkpoint field from the now-preserved null; I adjusted only that disposable probe’s reporting expression, then reran all seven scenarios. No implementation change followed.

Scratch evidence, retained for parent readback:

- `/tmp/aeon-m1-r2-review-independent/focused-tests.log` — SHA256 `8b527237747e77ae18c8103eaa01922a2741cb871ce653242108cfa741cc1437`
- `/tmp/aeon-m1-r2-review-independent/full-tests.log` — SHA256 `c31a32ecb0897e88c39fc22d28f63afde1fd8d442785de8e67e366d555eb0d4f`
- `/tmp/aeon-m1-r2-review-independent/independent_edges.py` — SHA256 `20ed5c70254fdbfff71052d61e0e4d075e3fa14dfc1a82fa32c53103e2943989`
- `/tmp/aeon-m1-r2-review-independent/independent-edges.jsonl` — SHA256 `ea4902e88027b7f073cf55dcf34e1e97589a433846f64a4558aab3228a5d01ff`
- `/tmp/aeon-m1-r2-review-independent/independent_r2_edges.py` — SHA256 `354ff4caed5cadb0c304baffde8d71cf01bc6d9ed5a874344a4aa32be9f53360`
- `/tmp/aeon-m1-r2-review-independent/independent-r2-edges.jsonl` — SHA256 `f7f57686dbc122fd46a19597170fa9576e84f3b98693f8d33440b2f7786af75e`

## Acceptance limits and next owner

M1 is accepted as source/fake and bounded fixture-filesystem/process behavior only. This does not authenticate accounts, prove native strict digest gating, qualify provider settings/budgets, establish hostile-writer exclusion or power-loss durability, activate dispatch, or measure coordination benefit. Live adapter/runtime/account/cutover and original no-retry native-denial gates remain.

Only this r2 review artifact is published under AEON outputs. Previous review and exact plan/source/fixture hashes were rechecked; implementation, original Brainstem, installed configuration, services and historical receipts were untouched. Original Brainstem’s 63-dirty-entry custody remains inherited, not newly audited.

Mufasa may record the exact-byte M1 acceptance and route any separately scoped next milestone through its existing gates. No further M1 repair is requested by this review.
