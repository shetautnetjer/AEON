# AEON-EVENTS-001 — independent M1 code review

**Verdict: REVISE.** Two P2 implementation defects remain in existing-checkpoint validation/recovery. The frozen plan and architecture boundary do not need revision; no Astra architecture escalation is indicated. Fix these within the three-file M1 scope, add relevant regression checks, and submit exact new bytes for independent recheck before M1 acceptance.

Reviewed independently on 2026-10-01T07:26:02.417345+00:00. Requested reviewer setting: GPT-6.1 Sol / medium / normal-default speed, as assigned by the parent. Effective model/effort/tier delivery is not exposed by these filesystem receipts; task-creation provenance remains with the parent. Producer test counts were treated as inherited evidence, not independent proof.

Read applicable AEON AGENTS, PROJECT, STATUS and DECISIONS, the accepted plan and revision-2 architecture verdict. Only the supplied three-file addition patch is reviewed; no implementation changes were made.

## Exact reviewed inputs

| Input | SHA256 |
|---|---|
| Accepted plan `work/active/AEON-EVENTS-001-plan-2026-10-01.md` | `6b1ab38939cfd9b18edcfd0a4187f9b70360ef38847c439284cf5ed376aa7512` |
| Architecture review `outputs/AEON-EVENTS-001-architecture-review-r2-2026-10-01.md` | `baede8801c2730b8d9ddfdc3f3c549ec5429c9aeb9c535a7bffc568bb0a6a064` |
| Exact `M1-review.patch` | `4bc7f950228e2ea72491ba38f219c89274e6975d4805b3bee05a9afcb8e2ba84` |
| `tools/coordination_projection.py` | `dcbe35e94ed696cc5d0f5b2146b23e492967078d66362cbd326e4878f4caf5ad` |
| `tests/test_coordination_projection.py` | `2f86a35adfff7a715084c42230aa0109c796f647bb1e55714c011dde50d94fb3` |
| `tests/fixtures/aeon_events_001_trace.json` | `9104db4f1d6d5736bff891841284913476c45f78da3a5293de3156979b6ded07` |
| Producer `M1-review-manifest.json` | `85ddfb8d3c111903cd583ffddfda9c1c373f6e30c41706635c0fe80fd69219b0` |
| Producer `M1-test-results.json` | `565672c5991cd28985977e1742d952d44b71d68cb98d1e7b814a4f8f459a04dd` |

All five supplied plan/patch/source hashes match. Independently reconstructed every added file from the exact patch and compared its complete bytes with the AEON file; all three match. Producer manifest records source HEAD `16039bd1b7d625a98a04e269c69fbf5bfa900c06`; this review is bound to file bytes, not acceptance of the full checkout.

## Severity-ranked findings

### R1 — P2: validate any existing payload before treating it as an absent checkpoint

Location: [coordination_projection.py:391](../tools/coordination_projection.py#L391), especially the `previous is not None` guard at line 393.

A present projection containing JSON `null` decodes to Python `None`, the same sentinel used for a missing file. With the current file hash supplied as expected preimage, `_previous_projection` is skipped and the next event overwrites the existing bytes and discards the earlier history. This contradicts the accepted requirement that an unknown/divergent existing projection be retained for reconciliation. Correct preimage comparison alone does not make a payload a valid checkpoint; the implementation already validates other unknown shapes under the same precondition.

Independent repro: publish fixture `ready`; overwrite the disposable projection with `b'null'`; call `claimed` using SHA256 of the current `null` bytes. Actual result: `published`, checkpoint `event-claimed`, prior bytes not preserved. Expected: `sync_conflict`, bytes retained. A malformed current payload `b'{broken'` instead raises an uncaught `JSONDecodeError` at line 391, rather than returning the advertised conflict result (bytes remain preserved).

Repair condition: distinguish physical absence using `previous_raw is None`; decode and validate every present payload within the conflict-handling path. Include null and malformed JSON recovery checks. This is ordinary checkpoint reconciliation, not an expanded hostile-writer guarantee.

### R2 — P2: cross-check checkpoint state and provenance before replay acknowledgement

Location: [coordination_projection.py:324](../tools/coordination_projection.py#L324), `_previous_projection`, and replay return at line 410.

The current validator checks field names, policy, observation shape and history member types, but does not verify consistency between top-level acceptance/state/version/digests and the last history record. Thus an accidentally edited canonical JSON checkpoint can be acknowledged as a successful replay despite contradictory completion data; an edited observation version can also defeat stale-event protection.

Independent repro A: publish fixture `ready`, change only `accepted_completion` to `true`, preserve all other fields and canonical encoding, then exact-replay `ready` using the read-back file hash. Actual: `replayed` with the edited hash; stored projection says `accepted_completion=true`, native status `todo`, acceptance tuple `null`. Expected: conflict retaining the edit, without acknowledging a valid replay.

Independent repro B: publish `producer_checkpoint` at version 3, change only `native_observation.status_version` to 0, then deliver untouched `claimed` at version 2 using the read-back hash. Actual: `published`, history versions `[3, 2]`, resolved `produce` becomes unfinished. The unchanged retained observation digest/history already exposes the contradiction. Expected: conflict before replacing those bytes.

Repair condition: validate internal checkpoint/provenance invariants, including last-history linkage to the captured observation/version/attempt, stored digests where reconstructible, and acceptance/disposition/boolean consistency. For a replay of the current event, compare its recomputed projection fields to the retained current checkpoint before returning a success acknowledgement. Preserve contradictory edits for reconciliation. No account authentication, signing or same-UID hostile mutation protection is requested.

## Independent verification

Ran from a disposable copy at `/tmp/aeon-m1-review-independent`, with `PYTHONDONTWRITEBYTECODE=1` and temporary test outputs. Copied tools/tests and the existing navigation inputs required by the unchanged full suite. Test-owned multiprocessing children stayed within the bounded existing tests; no runtime/adapter/model/service was launched.

| Check | Independent outcome |
|---|---|
| Focused `python3 -m unittest discover -s tests -p test_coordination_projection.py -v` | 26 passed / 0 failed / 0 not run |
| Full `python3 -m unittest discover -s tests -v`, after copying navigation inputs | 41 passed / 0 failed / 0 not run |
| Initial full run before navigation input copy | 39 passed / 2 errors / 0 not run; both missing scratch `bibles/index.json`, not implementation failures; preserved log |
| Seven independent edge probes | Three expected guards confirmed; four defect reproductions observed (R1 null/malformed; R2 acceptance/version inconsistency) |

The three independent guard probes rejected producer self-review (`review_binding_mismatch`), refused completion after a blocked checkpoint without changing its bytes (`terminal_or_blocked_checkpoint`), and rejected changed actual selected payload bytes (`snapshot_content_mismatch`). All API-returned effect lists were empty.

Existing tests independently cover wrong task/attempt/criterion/manifest/evidence class, missing selected inputs even with a pinned candidate, selected payload/hash/inventory/encoding drift, reviewer principal/run/remit separation, failed or unfinished checks/runs, adverse reviews, injected authority prose, cancellation/denial successor refusal, duplicate/rebound/equal-version/stale events, preimage edits, stable lock and two cooperating writers, pre-replace failure, post-replace fsync unknown outcomes and exact retry, and bounded abrupt-process crash before/after replacement. These pass for the reviewed bytes; they do not cover the findings above.

Minimal repro harness, runnable from the disposable copy (existing test setup owns/cleans snapshot payloads):

```python
import sys
sys.path.insert(0, 'tests')
from test_coordination_projection import CoordinationProjectionTests
from tools import coordination_projection as cp

for case in ('null', 'malformed', 'acceptance', 'version'):
    t = CoordinationProjectionTests()
    t.setUp()
    try:
        t.apply('producer_checkpoint' if case == 'version' else 'ready')
        if case in ('null', 'malformed'):
            t.out.write_bytes(b'null' if case == 'null' else b'{broken')
        else:
            p = t.projection()
            if case == 'acceptance':
                p['accepted_completion'] = True
            else:
                p['native_observation']['status_version'] = 0
            t.out.write_bytes(cp.encode(p))
        try:
            print(case, t.apply('ready' if case == 'acceptance' else 'claimed'))
            print(t.out.read_text())
        except ValueError as exc:
            print(case, type(exc).__name__, str(exc))
    finally:
        t.doCleanups()
```

Scratch supporting evidence (disposable, retained for parent readback):

- `/tmp/aeon-m1-review-independent/focused-tests.log` — SHA256 `2c85a5ae7ea75181eaf114b782dce14ffc6cf7592170ea0d00b4cdb4719f9cb6`
- `/tmp/aeon-m1-review-independent/full-tests-with-navigation.log` — SHA256 `09f06e959c012f6ae8e8c75c41f4c5a2a1048b72f3461d232de9d73ec391a058`
- `/tmp/aeon-m1-review-independent/existing-tests.log` — SHA256 `6e2546b8df3475ca849a370dd9290c66aa14556400d08ca07099c0f6aff8fffa`
- `/tmp/aeon-m1-review-independent/independent_edges.py` — SHA256 `261cd6107473d16c22fa207c775ef894aae68359a1716b5bf0e857d35ddf5117`
- `/tmp/aeon-m1-review-independent/independent-edges.jsonl` — SHA256 `a683b54c2ee337270fe6c034ff670e57b9a8c5223984f039caa4ed0706586e12`

## Limits and next action

These are source/fake and bounded fixture-filesystem/process results only. No Paperclip, selected adapter, native AYA, account/provider/model, actual identity authentication, production state, benefit comparator or live cutover is qualified. Same-UID hostile mutation and hardware power-loss durability remain outside this fixture guarantee. The blocked native lane remains no-retry.

The reviewed logic properly binds current acceptance receipts to trusted task/attempt/criterion/producer and independent reviewer run/principal, checks actual selected payload bytes and inventory, and requires done plus no unfinished obligations for accepted completion. Cooperating publishers use a stable sidecar lock, preimage checks, file fsync, atomic replacement, parent fsync and readback; tested post-replace failures return unknown and can exact-replay to repair durability. The requested changes address the existing checkpoint path, without changing those architecture choices.

Implementation was not edited. Original Brainstem was not accessed or touched; its reported 63-dirty-entry custody is inherited, not independently reverified by this review. Installed configurations, services and historical receipts were not modified. Only this review artifact is published under AEON outputs; scratch copies/logs/probes are disposable.

Next owner: Mufasa routes R1/R2 to the M1 producer, retains this rejected-byte receipt, then assigns a fresh exact-byte recheck. M1 remains unaccepted until these checks pass and an independent verdict accepts the repaired hashes. M1b/M2/M3 remain at their existing separate gates.
