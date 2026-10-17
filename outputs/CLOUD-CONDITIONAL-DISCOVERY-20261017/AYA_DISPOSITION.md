# AYA disposition — protected Cloud update discovery

## Current — authorized two-note canary passed, 2026-10-17
Khamani explicitly selected **“Authorize the two-note test only”** in this turn. AYA executed that exact scope through the already-authenticated hosted MCP, using two uniquely named synthetic notes in Aya Working and no existing note as a mutation target.

- **Sequential stale case passed:** a current-checksum edit succeeded; an edit carrying the earlier revision returned `NOTE_REVISION_CONFLICT`; the entire subsequent note payload equalled revision B. The error's `currentChecksum` matched B and `fileCreated` was false.
- **Concurrent case passed:** two separate sessions submitted edits using the same A checksum, with 2.603775524 seconds of measured client-request overlap. Exactly one succeeded and one returned `NOTE_REVISION_CONFLICT`. Final content equalled the winning edit exactly, and the conflict named that final checksum.
- **Cleanup passed:** both created notes were identity-checked, deleted individually, and exact absence was read back. No directory deletion, production-note mutation, client upgrade or connector change occurred. The request journal reconciles 17 note calls: two creates, four edit attempts, two deletes and nine reads. All targets belong to those two fixtures; all calls name the intended project UUID.
- **Custody:** canary `2207b60f956c411499d3c5b8748ddc86`, 2026-10-17T22:27:33.248014Z–22:28:27.854118Z. Detailed synthetic snapshots/calls and summary are below the private proof owner's `canary-2207b60f956c411499d3c5b8748ddc86/`; independent receipt reduction is `canary-controller-verification.json` and `canary-conflict-verification.json`. Probe SHA-256 `551b5c6e4215347c2313f6bb9a9c2a582599da56ceef2f6eb8802851bc2030c4`; journal SHA-256 `ea6dcdc89322e8c95834d79bf0a998bad85604f33fb6d302ab02b0af1f67eef6`. All 17 original source/capture pins still match.

**Accepted scope:** the tested hosted route passed one sequential stale-revision case and one overlapping two-writer case, including positive control and cleanup. This is real account-route evidence, not a universal proof of every race, a permanent Hermes-tool installation, or evidence of worker adoption. The technical checksum-route blocker is resolved within this tested scope. Existing task `aeon/t_d1739707` remains open/blocked because actual stale-pointer reconciliation is unfinished. AYA's next separate disposition is a narrowly scoped production-writer release under applicable authority, not another broad discovery or a duplicate canary. **No production-writer release or existing-note edit was made under this test-only approval.**

## Read-only acceptance — before the canary
Accept knowledge-writer run26 on existing `aeon/t_d1739707` **as the delivered read-only discovery subunit**, with the chronology and live-route supplement below. The original protected-write qualification and pointer reconciliation remain unfinished. Do not complete, re-block, auto-retry or decompose the parent from this result.

**New controller finding:** a usable authenticated hosted MCP route already exists at `https://cloud.basicmemory.com/mcp`, through the existing native Basic Memory credential helper. A fresh hosted `tools/list` exposes `expected_checksum` for edit/write; an exact Aya Working read returns `revision_checksum`. No client upgrade, permanent MCP registration, new credential, note mutation or production-pointer edit was needed for this discovery. This supersedes “no available checksum-carrying route” as a current blocker, but does not yet prove stale/concurrent writes are rejected.

## Evidence and acceptance
- Read the complete delivered `REPORT.md`, `SOURCE_PINS.json` and `HANDOFF.md`, the exact release packet, current native card and run26. The recorded `blocked` outcome is the required return after delivery, not a crash or a failed documentation investigation.
- Recomputed every declared pin: **17 matched** — installed source/metadata, authorized private captures and retained public HTTP bodies, including declared response sizes. Public 404 evidence remains unavailable-source evidence, not proof the private PR does not exist.
- Independently reopened installed `edit_note.py:361–397,738–759` and `mcp/clients/knowledge.py:143–175`: Basic Memory0.23.2 does not expose/forward the caller checksum on that MCP path. The current Hermes-exposed schemas independently retain that omission. A replacement-count assertion and a post-write checksum are not equivalent to a caller-revision precondition.
- Fresh exact-project CLI Cloud reads of Working current context and the Development Start Here/Source Map succeeded. Their old runtime prose remains dated context, not a new runtime assertion. Private bodies stay outside Git.
- Parent directly inspected the authenticated hosted MCP using the installed MCP2.2.0 SDK and native credential helper, with no registration/install change. The server identifies itself as Basic Memory4.1.0, protocol2025-11-25; **40 unique tools**, one complete page. This identifies the endpoint's advertised version, not its private deployment SHA.
- `read_note` returned the exact `project_id=be29331d-c6a0-4d7b-bfcb-911c67925cb6` and `file_path=working/AYA Working — Current Operating Context.md`, a nonempty `revision_checksum`, and content equal to the freshly captured CLI Cloud read. Only this read-only semantic note tool was called. The successful probe session closed.
- Private proof owner: `/home/aya-hmw/.local/state/aya-task-supervisor/cloud-hold-review-u5qjp5lq/`, especially `pin-verification.json`, `hosted-schema-v2-read.json`, `hosted-working-read.json` and `acceptance-verification.json`. Hosted fields and exact readback are new parent observations, not retroactive claims about worker access.

### Delivered artifacts preserved unchanged
- `REPORT.md`: `250a6aa7a5ae95b00d085b01faee45f73093f8ea8639aad96c43f7368be3f6aa`
- `SOURCE_PINS.json`: `b7c44c871f2186711eb15a2244bd70cef936c2de51a5ef22fbc82580ffeba2b7`
- `HANDOFF.md`: `df9620d173789547832a775de55b84644cf9c98e76d73ceab4ba9e5c7bc685ca`

## Chronology clarification
Do not treat the September ordinary-note bug description as evidence that today's hosted service is still defective. Issue1536's follow-up reports a fix at private Cloud PR2071, explicitly not merged/deployed at that comment's observation time; the private PR itself is still unavailable to this public inspection.[2] The worker's retained public materials also include **merged Core PR1712**, which documents checksum-guarded `edit_note`, a PATCH checksum header and metadata-only reads, with merge commit `f9875cf5e4e12f5a85fd9f9120703ed9990c68ae`.[6] These are distinct Cloud/Core histories and neither independently proves this account's mutation behavior. The later live hosted schema/read is stronger evidence of currently accessible field transport, but remains short of conflict enforcement.

The direct hosted endpoint is documented by the vendor; the vendor also documents bearer-token access for programmatic clients.[7][8] AYA reused the existing credential via the native helper in process only; no token was printed, placed in argv, copied to a new file or introduced into this report.

## Original discovery plan — completed by the authorized canary above
At the discovery handoff, the proposed next unit was **one bounded synthetic qualification on two temporary notes**, not another broad source audit or an upgrade. Proposed owner: AYA on this same existing parent, with no competing worker; project Aya Working (`be29331d-c6a0-4d7b-bfcb-911c67925cb6`), temporary directory `qualification/cloud-conditional-t_d1739707`, unique per-attempt note names and `overwrite=false` on creation.

1. Sequential case: create synthetic A, read its returned revision, make a valid checksum-guarded edit to B, attempt an edit using stale A, require an explicit conflict and exact unchanged B readback.
2. Separate concurrent case: create/read A, send two distinct conditional edits based on A, require one success and one conflict and final content exactly matching the winner.
3. Verify identities and delete only these two created notes, with exact absence readback. If an operation has unknown outcome, reconcile its exact target before any retry. Preserve failed behavior and all receipts; do not interpret an error as proof no mutation occurred.

**At that handoff, mutations and cleanup were proposed, not yet authorized or performed.** The later explicit approval and actual result are recorded in Current above; the original plan is retained for comparison, not a fresh request to run it again. No existing owner note was a test target. Passing the canary permits AYA to consider the separately held production-writer release and compact dated supersessions; it does not silently authorize that release, a client upgrade or global connector replacement.

## Read-only probe corrections / original limits
The first parent probe failed before network access because it used the MCP1 transport name. The next authenticated attempt reached tool discovery but hit a local camelCase-versus-snake_case projection error. Inspecting the installed MCP2 signatures/model fields and reducing `model_dump(by_alias=True)` resolved these local integration mistakes; they were not Cloud authentication failures. The preserved error receipt and subsequent success are distinct. Those read-only probes did not qualify mutations. The later canary has the separate bounded acceptance above; whole-phase completion, production reconciliation and a general race-free guarantee remain unclaimed.

## Sources

[2] https://github.com/basicmachines-co/basic-memory/issues/1536
[6] https://github.com/basicmachines-co/basic-memory/pull/1712
[7] https://docs.basicmemory.com/cloud/cloud-guide
[8] https://docs.basicmemory.com/cloud/api-keys
