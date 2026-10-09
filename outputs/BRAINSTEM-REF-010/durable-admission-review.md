# Durable admission independent review — 2026-10-09

Reviewed offline fixture admission identity, frame validation, append/recovery, CLI bounds, Rust admission tests, Python durable roundtrip test and reference epoch projection. Read repository AGENTS.md, home HERMES.md, and SourceEvent/append/occurrence identity sections of AYA_Observer_Contract_v0.2.md. No implementation edits or live/provider/service changes.

## Historical finding (resolved below): P2 — reject noncanonical native row spellings before binding identity

`observer-probe/src/admission.rs:61` accepts any positive u64 spelling, but returned occurrence tuple and journal deduplication retain the raw row string. An otherwise valid request using `1` and the same request using `01` in native_event_id, source_position, row_primary_key and source_key both pass validation and receive different durable UUIDv7 IDs in the same generation/stream/epoch. Both spellings identify the same integer ROW_PRIMARY_KEY. This bypasses the promised one canonical accepted occurrence for that native row. Captures emitted by the ordinary producer are canonical, so this affects malformed fixture input at the explicit admission seam rather than ordinary exact retries.

Proof: `durable-admission-row-alias-proof.json` contains both receipts; states are `new,new`, sequences 1,2, and frame count 2. First ID `01a11ee9-ee1a-7449-bf3c-9dffdf8a0b24`; alias ID `01a11ee9-ee1b-7380-8e85-c7c9045e70ad`. Reproduction used only temporary synthetic requests/journal through the existing compiled CLI.

Recommended correction: validate the native row is its parsed positive integer's canonical decimal spelling before deriving the tuple (prefer the producer's actual SQLite integer range); reject aliases rather than silently rewriting caller evidence. Add focused cases for `01` and `+1`, expecting no second accepted frame.

## Supporting checks and limits

`cargo test --offline --locked --manifest-path brainstem-slice/observer-probe/Cargo.toml --test admission`: 8 passed, 0 failed. Covered reopen/retry ID retention, epoch/generation separation, incompatible rebind, all four process-exit crash windows, incomplete-tail recovery, corrupt complete frame rejection, concurrency and writer provenance checks.

No further demonstrated durability defect found: complete frames are sealed/validated before mutation; replay syncs before acknowledgement; partial tails truncate only after complete validation; exclusive flock spans recovery and append; accepted frame/template consistency and unique UUIDv7/tuple/local sequence are checked on reopen. Process-exit tests do not establish power-loss/filesystem fault behavior. No independent Python/full effect suite run; parent is running broader suites. Reference epoch column and uniqueness include the declared epoch, and the old projection fails explicitly instead of being silently migrated. Review does not qualify production writer authority, capture-to-memory promotion or deployment.

## Exact reviewed SHA-256

- `brainstem-slice/observer-probe/src/admission.rs`: `8607aadb537594c3f4ba0c704f41a29fc8d8c4507925775503e3eae6c293b3e7`
- `brainstem-slice/observer-probe/src/main.rs`: `bf8616d7388ebdb1b79e1efb452b989c6305395913e700dc7ba22ed1919ab0a5`
- `brainstem-slice/observer-probe/src/lib.rs`: `a24750b60ae5b953a4df90cc9d1ccf2fac32eca0c69153a10ce8932663bd04c7`
- `brainstem-slice/observer-probe/Cargo.toml`: `1ea1930a25be53e2f86f2eac4bb39b6d01a06ec80efec49be752ccbd2691200a`
- `brainstem-slice/observer-probe/Cargo.lock`: `12b88119ada9d45e14168d1fdf1e17773a8393c746b7490a097d1d090d962c0a`
- `brainstem-slice/observer-probe/tests/admission.rs`: `2a4e45b005849e5034c720f7c0f02c43213528baffb558f1364b1c73cc64ad44`
- `brainstem-slice/tests/test_durable_capture_roundtrip.py`: `61cc7d969bc85f46cc6af1176aedc50663e536d096215f4a000a8e5446c890d7`
- `brainstem-slice/memory_v0.py`: `7485ddb78e77a252a91e96a798d23261ea0e40044ed7cde2646c1fdd697756fa`
- `baseline-memory_v0.py`: `57a9cff2804e3098fa046008fd4dba0b86ce50b95b66778adcf57053b1a80a2b`

## Final rereview — row alias finding resolved

Canonical decimal spelling is now required by `n.to_string() == row` in admission validation. Re-ran focused Rust admission suite: **9 passed, 0 failed**. Independently retried the original fully bound malformed requests (`01` and `+1` updated across all native/event/key coordinates), after accepting the canonical row `1`: both returned exit 2 / `capture_binding_invalid`, with the original journal bytes unchanged and one frame. Evidence: `durable-admission-row-alias-final-proof.json`. This stronger reproduction avoids relying solely on the new test's additionally inconsistent event/key fields. The earlier two-ID proof remains preserved as historical failure evidence.

Reviewed final cumulative admission implementation, CLI/library exposure, request/recovery tests, dependency pins/lock, reference epoch code and durable roundtrip test; reread new candidate binding and observer README. Binding and documentation consistently limit this to an offline fixture candidate, distinguish journal acceptance from references/interpretations, use local sequence and do not claim production authority or power-loss qualification. No unresolved substantive finding in the reviewed admission seam. Parent's broader suites are separate evidence; this rereview does not claim to rerun them. No implementation edits.

### Final reviewed SHA-256 (supersedes earlier hashes)

- `brainstem-slice/observer-probe/src/admission.rs`: `744a0e2c5705c077d5f4b69202d41f2b83e7395ad6f13837a372c68db5e4d2bd`
- `brainstem-slice/observer-probe/src/main.rs`: `bf8616d7388ebdb1b79e1efb452b989c6305395913e700dc7ba22ed1919ab0a5`
- `brainstem-slice/observer-probe/src/lib.rs`: `a24750b60ae5b953a4df90cc9d1ccf2fac32eca0c69153a10ce8932663bd04c7`
- `brainstem-slice/observer-probe/Cargo.toml`: `1ea1930a25be53e2f86f2eac4bb39b6d01a06ec80efec49be752ccbd2691200a`
- `brainstem-slice/observer-probe/Cargo.lock`: `12b88119ada9d45e14168d1fdf1e17773a8393c746b7490a097d1d090d962c0a`
- `brainstem-slice/observer-probe/tests/admission.rs`: `cb76ec3be3b9d3705290a40230fa235997eccc31ed6f003453f601efce2cc1fd`
- `brainstem-slice/tests/test_durable_capture_roundtrip.py`: `61cc7d969bc85f46cc6af1176aedc50663e536d096215f4a000a8e5446c890d7`
- `brainstem-slice/memory_v0.py`: `7485ddb78e77a252a91e96a798d23261ea0e40044ed7cde2646c1fdd697756fa`
- `brainstem-slice/observer-probe/README.md`: `ab16efa6a0c49bf0f02c73a14c17a401d3e4d6a9b7c8d071ad3db18d38d8c3ac`
- `brainstem-slice/bindings/observer-capture-admission.v0.2.candidate.json`: `1cdca6f68b6d992a8645f96c2adf3999613d4fef94cc25c09b2d8e3d32b5e162`
- `brainstem-slice/docs/plans/2026-10-09-offline-capture-admission.md`: `f788ea2d33c61490be9d6862d2778879c851ce2ec2258aed2296ed3bb7eb2a84`
