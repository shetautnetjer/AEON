# Independent reference slice review

Reviewed `brainstem-slice/memory_v0.py` against `baseline-memory_v0.py`, the nine added reference tests, and the dated reference slice plan. Implementation was not edited. All execution used temporary synthetic fixtures; no network, model, service or live owner changes.

Verdict: changes requested.

## Findings

1. **P1 — Gate full reference history content reads.** `memory_v0.py:1002` and `1015–1018`: `reference_history` has no `allow_content` argument and returns complete caller-supplied SourceEvent, ArtifactRecord and EvidenceEvent bodies. EvidenceEvent includes payload claims, so this is a content read, unlike a metadata-only locator read. Admission, resolution, and existing `candidate_history` all require explicit content authorization, but this public history entry point bypasses that boundary. Reproduction with the provided fixture: admit a reference and evidence with authorization, then call `reference_history` without authorization; `interpretations[0]['evidence_event']['payload']` returns `{'claim': 'amber'}`. Add a default-denied gate for full history (and propagate authorized calls from resolution), or provide a separate sanitized metadata view. Add a regression that unauthorized history fails before returning bodies.

2. **P2 — Handle an existing database before the first reference admission.** `memory_v0.py:1007`: reference tables are created lazily by writes, but history immediately queries them. A valid database initialized by `ingest_capture` has no `reference_sources` table yet. Calling history for an absent ID raises `sqlite3.OperationalError: no such table: reference_sources`, rather than the documented missing-reference path (`ValueError('reference_missing')`). Resolution inherits this failure. Existing candidate history explicitly handles absent extension tables. Check table presence on the read-only connection and return the intended missing result without a write; test metadata-only databases and preserve detection of partial or malformed extension schemas.

## Verification

Command: `python3 -m unittest discover -s tests -p test_reference_admission.py -v`, in the isolated slice. Result: **9 tests passed**, 0.036 seconds. The full suite was not run because the parent is running it.

Additional temporary-fixture reproduction confirmed both findings:

```text
Before reference admission: OperationalError no such table: reference_sources
Without content authorization: {'claim': 'amber'}
```

The reviewed happy paths preserve supplied UUIDv7s, retry bodies, scope, separate rows for equal-content occurrences and generations, immutable stored records, generation-aware current-source checks, additive correction links, and existing candidate save identities. No promotion or UUID issuance was added. Writer authority, production adapter provenance and governed artifact custody remain explicitly deferred by the plan; this review does not claim those gaps are closed.
