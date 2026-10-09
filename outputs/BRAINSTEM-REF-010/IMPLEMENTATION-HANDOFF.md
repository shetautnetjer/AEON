# Brainstem reference-first cumulative handoff — 2026-10-09

Implemented in the isolated `brainstem-slice/` copy of the existing Brainstem owners. Original dirty Brainstem, MemoryD, and AEON/Paperclip owners remain untouched. No push, deployment, live corpus access, migration, service restart, credentials, or model API calls.

## Deliverable

`brainstem-reference-first.patch` contains the following 17 paths relative to Brainstem. `changed-paths.json` records exact hashes; `owner-preservation.json` confirms baseline preservation. Read-only `git apply --check` passed against the original owner. Recheck ownership before applying; do not replace its dirty worktree with the snapshot.

- `memory_v0.py`
- `README.md`
- `architecture.html`
- `tests/test_reference_admission.py`
- `tests/test_capture_reference_wiring.py`
- `fixtures/aya-utc-schema.v0.1.sql`
- `docs/plans/2026-10-09-reference-first-slice.md`
- `observer-probe/src/admission.rs`
- `observer-probe/src/lib.rs`
- `observer-probe/src/main.rs`
- `observer-probe/Cargo.toml`
- `observer-probe/Cargo.lock`
- `observer-probe/tests/admission.rs`
- `observer-probe/README.md`
- `docs/plans/2026-10-09-offline-capture-admission.md`
- `tests/test_durable_capture_roundtrip.py`
- `bindings/observer-capture-admission.v0.2.candidate.json`

## Behavior

The existing Observer probe has an explicit offline fixture acceptance CLI. A private locked sealed journal binds native generation, stream, epoch and row to one canonical UUIDv7 SourceEvent. Metadata-only templates carry separate fixture writer provenance. Retry, reopen, concurrent retry and four process-crash windows preserve accepted identity; incompatible rebinding, integer row aliases and corrupt complete frames fail closed. Equal-content occurrences and distinct generations/epochs retain distinct identities. No global sequence or aya_event_id exists; observer_sequence is journal-local.

Accepted SourceEvents feed the existing reference APIs. ArtifactRecord custody and immutable EvidenceEvent interpretations remain distinct. Reopen resolves retained original bytes and reports explicit missing/changed native source outcomes. Late correlation is additive without another occurrence; corrected interpretations preserve both versions without duplicate promotion. AYA_UTC uses its actual archived schema and existing archive_key/native IDs and time range.

The candidate reference table now binds source_key together with sequence_epoch. Older candidate tables lacking epoch reject with reference_schema_unbound; no migration is performed.

## Verification

- Final offline Rust suite: 55 passed (`admission-rust-final.log`), scoped temporary run root and explicit python3.
- Clippy offline/locked all targets, warnings denied: passed (`admission-clippy-final.log`).
- Reference regression suite: 23 passed (`admission-reference-final.log`).
- End-to-end actual Rust acceptance/Python reference roundtrip: 2 passed (`admission-roundtrip-final.log`).
- Final full Python discovery: 154 passed plus one pre-existing plugin import error, 155 enumerated (`admission-python-final.log`); baseline had the same missing hermes_constants error.
- Independent cumulative reference review and fresh durable acceptance review completed. Row alias finding reproduced and fixed; final focused admission review: 9 passed, no unresolved substantive finding (`durable-admission-review.md`).
- Earlier baseline/failure receipts retained. Initial Rust full checks exposed incomplete snapshot bindings and missing `python`; final snapshot includes existing bindings and uses python3. The original owner was not changed.

## Remaining integration gaps

This is an offline fixture writer, not production Observer registration or authority. Production writer grants/provenance, Postgres acceptance/custody transaction design, source adapters beyond the tested Hermes subset, live retention policy and deployment remain unimplemented. AYA_UTC reference resolution is wired, but this new acceptance adapter does not ingest every AYA_UTC source. Journal limits: Linux private regular file, 8 MiB fixture bound, tested process crashes rather than filesystem power-loss proof. SHA seals detect changes, not authenticity against a same-UID adversary. Artifact bytes are external custody; this journal is metadata only.

System Python cannot collect the existing plugin tests because hermes_constants is absent; this was also present at baseline. A prior isolated Hermes bootstrap attempt was blocked while seeking dependencies, so no further installation/bootstrap was attempted. Preserve Gemma/Decide offload, Paperclip notification ownership and other dirty work.

Next owner handoff: inspect this exact patch and final receipt hashes, then integrate the candidate only when the live owner is clear. No runtime or corpus integration is authorized by this delivery.
