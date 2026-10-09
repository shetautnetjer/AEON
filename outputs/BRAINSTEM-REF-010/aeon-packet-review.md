# Independent AEON packet review — 2026-10-09

Read-only review of selected shared-agent/task/packet documentation, reproduction script and manifests in `aeon-reference-first-20261009`. No packet execution, live changes, networking, bootstrap or implementation edits.

## Historical findings (resolved below)

1. **P2 — inherited Cargo output path defeats scratch confinement.** `reproduce.py` copies `os.environ` and sets only Observer test variables. An existing `CARGO_TARGET_DIR` pointing into the original owner or another runtime path is inherited by Cargo test/Clippy and the cargo subprocess inside Python roundtrip checks. That permits build writes outside the fresh scratch, contrary to the advertised confinement. Set the Cargo target directory to an absolute directory under scratch before running checks. Clearing Python import overrides can also improve deterministic isolation, but no private import was reproduced here.
2. **P2 — exported historical proof currently lacks manifest coverage.** All 22 manifest entries match their SHA-256; the packet currently additionally contains `durable-admission-row-alias-proof.json` without a manifest entry. Include it before final publication if retained. `packet-manifest.json` self-exclusion is expected; bind its hash through the private Git commit/review receipt.

## Supporting assessment

Shared entry/task docs preserve Brainstem implementation ownership, disjoint writers, coordinator serialization, dated conflict evidence and independent review. They explicitly exclude automatic merge, production authority, runtime/provider changes and raw historical upload. They do not install dispatch/memory services. Actual commit/publication/tree and unchanged-original-owner claims remain coordinator verification rather than something these docs establish alone.

Reproduction verifies 78 explicitly selected baseline file hashes and all listed packet hashes before copying. It requires a fresh absolute scratch outside the owner and rejects source file symlinks/nonregular paths. It copies bytes rather than whole owner history, uses git apply check plus final changed-file hashes, invokes Cargo offline/locked and focused Python suites, and records each command/exit/log hash. Parent owns actual reproduction evidence. This is a trusted local packet workflow, not a security boundary against concurrent same-user path replacement or modified interpreter/script before startup.

Export inventory contains the implementation patch, source hash lists, review notes and synthetic test logs. Listed packet entries have no private-key marker, apparent credential assignment, or runtime database/binary filename; patch targets are 17 scoped source/test/doc/binding files, with one SQL fixture definition rather than database contents. Baseline `observer-probe/fixtures/real-turn-readonly.txt` is only a path/hash reference in the export, not a copied native transcript. No old Git history is included by these packet files. Pattern/inventory checks alone are not a guarantee against every hidden secret; reviewed scope and upstream private tree verification remain relevant.

## Reviewed hashes

- `docs/shared-agent-start.md`: `cf159f1eeec1300a1d864d1185ba26fb3788ebcc4ff400670d15f93786a2abc9`
- `work/active/BRAINSTEM-REF-010.md`: `a55591edbbf5d3a8ab9e52249a17448799aa05398b9354c63abf9456f3c83350`
- `outputs/BRAINSTEM-REF-010/README.md`: `9db333033a87cd073988506ee71d34e9c505179576a885c8e294d79d77387a0c`
- `outputs/BRAINSTEM-REF-010/reproduce.py`: `5586e89675b6bcb85b93d46b0ff6f5c97abeee981f94447f408634314a09cba8`
- `outputs/BRAINSTEM-REF-010/baseline-manifest.json`: `47b52fb1126ecc0089d14f0dd9a319751e71d6e1d2d914a1cef60014cab5ea7b`
- `outputs/BRAINSTEM-REF-010/packet-manifest.json`: `6dcf918465076a478dee82700cb21891f958f366a47f30c7d36cae714aa2af62`

## Final rereview — both findings resolved

Reviewed the final reproduction environment: child test commands receive only the documented HOME/PATH/locale/timezone/Cargo/Rustup locations, with both `CARGO_TARGET_DIR` and `CARGO_BUILD_TARGET_DIR` explicitly set under fresh scratch. The Python roundtrip's Cargo subprocess inherits that confined target path. Arbitrary credential variables, PYTHONPATH/PYTHONHOME and inherited Cargo output overrides are absent. This resolves the demonstrated inherited-output override gap within the stated trusted local toolchain workflow.

Refreshed packet manifest binds the historical row-alias failure proof. Independently checked all **24 listed entries**: every SHA-256 matches, and the only unmanifested packet file is the expected manifest itself. This resolves the coverage finding. Adding this review and final reproduction receipts will require a fresh coverage/hash check and a final commit/tree anchor as the coordinator already plans.

No unresolved substantive finding in the selected final docs/script/manifests. Final confined reproduction is coordinator-owned and running; this review does not claim its result before completion. No implementation edits or execution performed by this reviewer.

### Final relevant SHA-256

- `docs/shared-agent-start.md`: `cf159f1eeec1300a1d864d1185ba26fb3788ebcc4ff400670d15f93786a2abc9`
- `work/active/BRAINSTEM-REF-010.md`: `a55591edbbf5d3a8ab9e52249a17448799aa05398b9354c63abf9456f3c83350`
- `outputs/BRAINSTEM-REF-010/README.md`: `9db333033a87cd073988506ee71d34e9c505179576a885c8e294d79d77387a0c`
- `outputs/BRAINSTEM-REF-010/reproduce.py`: `da94ed4b344800f4020975ca81d1f89b032a18a251b2fb3e56b66c4c93261d8e`
- `outputs/BRAINSTEM-REF-010/baseline-manifest.json`: `47b52fb1126ecc0089d14f0dd9a319751e71d6e1d2d914a1cef60014cab5ea7b`
- `outputs/BRAINSTEM-REF-010/packet-manifest.json`: `16f242ed5aaa7ff446af921f2ee33018155f631c96646ae45006d25f3f6bd78b`
