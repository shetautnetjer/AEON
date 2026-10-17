# AYA disposition — protected Cloud update discovery

## Current / decision — 2026-10-17
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

## Next / explicit decision boundary
The next useful unit is **one bounded synthetic qualification on two temporary notes**, not another broad source audit or an upgrade. Proposed owner: AYA on this same existing parent, with no competing worker; project Aya Working (`be29331d-c6a0-4d7b-bfcb-911c67925cb6`), temporary directory `qualification/cloud-conditional-t_d1739707`, unique per-attempt note names and `overwrite=false` on creation.

1. Sequential case: create synthetic A, read its returned revision, make a valid checksum-guarded edit to B, attempt an edit using stale A, require an explicit conflict and exact unchanged B readback.
2. Separate concurrent case: create/read A, send two distinct conditional edits based on A, require one success and one conflict and final content exactly matching the winner.
3. Verify identities and delete only these two created notes, with exact absence readback. If an operation has unknown outcome, reconcile its exact target before any retry. Preserve failed behavior and all receipts; do not interpret an error as proof no mutation occurred.

**These mutations and cleanup are proposed, not yet authorized or performed.** No existing owner note is a test target. Do not ask to weaken the checksum requirement. A successful canary would permit AYA to consider the separately held production-writer release and compact dated supersessions; it would not silently authorize that release, a client upgrade or global connector replacement.

## Probe corrections / limits
The first parent probe failed before network access because it used the MCP1 transport name. The next authenticated attempt reached tool discovery but hit a local camelCase-versus-snake_case projection error. Inspecting the installed MCP2 signatures/model fields and reducing `model_dump(by_alias=True)` resolved these local integration mistakes; they were not Cloud authentication failures. The preserved error receipt and subsequent success are distinct. No mutation/concurrency test, whole-phase completion, production reconciliation or general race-free guarantee is claimed.

## Sources

[2] https://github.com/basicmachines-co/basic-memory/issues/1536
[6] https://github.com/basicmachines-co/basic-memory/pull/1712
[7] https://docs.basicmemory.com/cloud/cloud-guide
[8] https://docs.basicmemory.com/cloud/api-keys
