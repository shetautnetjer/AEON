# Protected Cloud update route — read-only discovery

Task: `aeon/t_d1739707`  
Prepared: 2026-10-17 (UTC)  
Phase: AYA-released, read-only source/documentation discovery only. This is not acceptance of the original parent outcome.

## Finding

No safe caller-revision-protected route is qualified for ordinary Basic Memory Cloud notes by the evidence gathered here. The current public MCP reference documents `revision_checksum` in structured Cloud `read_note` responses and an `expected_checksum` parameter on `edit_note`, but its stated rejection guarantee is for Cloud reviewed notes / ordinary edits while review work is open—not a general ordinary-note compare-and-swap guarantee.[1] The public issue record reports the opposite for an ordinary note: a sequential edit carrying a stale checksum was accepted and changed content; that report did not test simultaneous writers.[2]

The distinction is between field transport and mutation semantics. Public Cloud-facing documentation and issue discussion show a field can be named on that route, but they do not establish that an ordinary Cloud note rejects a stale value atomically. The installed Basic Memory 0.23.2 route examined here cannot send the field at all: local `edit_note` has no `expected_checksum`, its PATCH JSON is assembled without a caller revision, and `write_note` exposes `overwrite` but no checksum precondition. The controller-supplied observation of the currently exposed MCP schema has the same omission, but was not independently re-measured as a live `tools/list` call. The local CLI `--help` results independently confirm the installed CLI lacks an expected-checksum option for edit/write.

The current public Core issue #1552 explicitly distinguishes the Cloud ordinary-note bug from Core MCP: it says Cloud exposes `expected_checksum` but ignores stale values on ordinary notes, while the Core MCP `edit_note` initially lacked a checksum argument despite a lower-level Core accepted-content precondition.[4] A separate public Core commit adds `expected_checksum` to `write_note` when `overwrite=True`; that is evidence of a Core source change, not evidence that the installed 0.23.2 package or a hosted Cloud account has it.[5] The supplied Cloud PR 2071 URL returned HTTP 404 through the unauthenticated public GitHub API and a not-found page in the browser; its existence, contents, merge state, and deployment are therefore unavailable here.[3]

## Evidence and scope

Read the released discovery packet, AEON `AGENTS.md`, `PROJECT.md`, `STATUS.md`, `DECISIONS.md`, the authorized local captures (selected metadata/excerpts only), and Finance's existing `CLOUD_UPDATE_PROPOSAL.md`. The proposal remains explicitly “not published”; its latest compact delta points to the existing NEXT-01 run17 disposition and says neither Cloud owner was written. No Cloud account call, note write, client upgrade, credential/config inspection, install, or service change was made.

The authorized Working capture is `working/AYA Working — Current Operating Context.md` in project `be29331d-c6a0-4d7b-bfcb-911c67925cb6`; the two Development captures are `Guides/AYA Development Wiki — Start Here.md` and `Guides/Source Map.md` in project `9469cb90-4139-4c2c-b863-2714dd42a4cb`. The Working capture contains the dated Hindsight/Prometheus statements described by the release packet. Those statements were not requalified against host runtime in this unit and were not edited. Capture bodies remain private and are not reproduced here.

The public documentation retrieval was inconsistent across retrieval methods: the first `web_extract` output omitted the newer review/checksum fields, while the live browser page and direct unauthenticated HTTP GET on 2026-10-17 showed them. The direct live page is the pinned documentation evidence used below; the extractor mismatch is preserved as a retrieval limitation, not silently treated as a product change.[1]

## Caller-to-mutation trace

Installed distribution metadata and `bm --version` both identify Basic Memory `0.23.2`. In that installation:

- `basic_memory/mcp/tools/edit_note.py` defines `edit_note` without `expected_checksum`; the edit path builds a payload from operation/content and optional section/find/metadata fields, then calls `KnowledgeClient.patch_entity`.
- `basic_memory/mcp/clients/knowledge.py` serializes that dictionary as the JSON body of PATCH `/v2/projects/{project_id}/knowledge/entities/{entity_id}`. No revision header or checksum field is added by this client path.
- `basic_memory/mcp/tools/write_note.py` accepts `overwrite`, but no expected revision; its JSON readback returns a checksum after the operation, which is not a precondition.
- `basic_memory/mcp/note_reads.py` shapes local structured JSON as title/permalink/file_path/content/frontmatter; it does not return `revision_checksum`. The public Cloud documentation describes a different hosted response shape, so local output must not be generalized to Cloud.
- The installed `NoteContentWriteService.edit_note` invokes the accepted-note transaction using `EditEntityRequest` data but the 0.23.2 source path inspected here has no caller-supplied base checksum. This is local Core package evidence, not Cloud server source.

The public Core issue #1552 describes a newer Core service/API boundary with `base_checksum` and a `x-bm-cloud-note-base-checksum` request header, and says the ordinary Core MCP path did not pass it through at that point.[4] This identifies a plausible Core-side route, but the Cloud backend implementation needed to prove ordinary-note enforcement was not available: PR 2071 returned 404 and no Cloud source or deployment receipt was supplied.[3][4]

## Why the apparent safeguards are weaker

- `expected_replacements` checks how many text matches the requested edit should replace. It does not bind the edit to the whole revision the caller read. Issue 1536's reported stale edit still had exactly one replacement target.[2]
- The installed Markdown processor's `expected_checksum` check is a local-file dirty check before writing a locally materialized file. It is not a Cloud note revision token, and the check and subsequent file replacement are separate operations in that local code path.
- Refreshing immediately before an edit only narrows the stale interval. Another writer can act after refresh and before the mutation unless the mutation boundary compares the caller's revision atomically.
- Readback after a write can reveal the resulting content, but cannot prevent a stale overwrite or restore the intervening revision safely.

For ordinary Cloud notes, the required property is a server-side conditional mutation: compare the exact caller revision and accept the write or return a conflict in the same atomic mutation boundary. The issue report is sequential evidence of stale acceptance, not a concurrency experiment; it cannot establish simultaneous-race behavior or today's deployed behavior.[2]

## Supported next checks and finite qualification proposal

A bounded read-only check exists for documentation and tool shape: re-read the current public reference and, only if AYA supplies an authorized hosted read-only route, inspect that route's `tools/list` schema and one structured `read_note` response. This can show whether a particular route exposes/returns the field; it cannot prove that an ordinary-note stale mutation will be rejected. No authorized Cloud account route was available in this task.

If AYA later authorizes disposable synthetic-note mutations, run two separate cases—not as part of this discovery:

1. Sequential stale check on one synthetic ordinary note: create note with a unique replacement target; read revision A; append a unique marker; read and save B; confirm the original target still occurs exactly once; attempt an edit with A; require an explicit conflict and a post-attempt readback byte-identical to B; delete the note and read back absence.
2. Concurrency distinction on a separate synthetic note: create and read revision A; issue two distinguishable conditional edits based on A concurrently; require exactly one success and one conflict; read back and verify the final content is exactly the winner's result (not a merged/partial state); delete the note and read back absence.

Keep both notes synthetic, operations finite, and results/identifiers/checksums confined to the approved evidence owner. These are proposals only, not authorized runs. A missing or unusable conditional route should stop before mutation; request Cloud-side source/deployment evidence or an explicitly authorized synthetic qualification route rather than upgrading the client or substituting refresh/readback.

## Original parent scope classification

| Criterion / outcome | Status in this discovery | Boundary |
|---|---|---|
| Pin installed package, relevant files, public references, retrieval date and hashes | Verified, with PR 2071 unavailable | See `SOURCE_PINS.json`; public hashes are response-body hashes, not deployment evidence. |
| Trace caller fields through local serialization/transport toward mutation | Partially verified | Installed local path reaches the PATCH JSON boundary; hosted Cloud source/mutation boundary is unavailable. |
| Compare expected-replacement count, local hash checks, refresh and readback with atomic caller-revision protection | Verified at source/evidence level | None substitutes for an atomic stale-revision reject on ordinary Cloud notes. |
| Reconcile ordinary versus reviewed-note semantics and issue/PR history | Verified with unresolved Cloud-source gap | Docs constrain their explicit rejection statement to reviewed-note context; issue 1536 reports ordinary stale acceptance; PR 2071 unavailable. |
| Determine whether the inspected route can carry a checksum | Verified by route class, not as a live account probe | Public Cloud docs/issue indicate a field exists in hosted context; installed 0.23.2 and controller-observed active schema cannot carry it. Ordinary-note CAS remains unqualified. |
| Sequential stale rejection, simultaneous-writer behavior, and deployed account behavior | Unperformed | No mutation, account route, or Cloud source/deployment evidence in scope. |
| Disposable note creation, writes, cleanup; production pointer updates to Working/Finance | Explicitly held | No Cloud/disposable-note/production write authorization in this subunit. |
| Client upgrade/install or full original parent acceptance | Explicitly held / unfinished | This report does not complete or narrow the original parent task. |

## Disposition

Read-only discovery delivered to AYA for source-pin verification and disposition. The stale Working/Finance Cloud pointers remain unreconciled; no claim is made that any Cloud update route is deployed, atomic, or production-qualified. Await AYA's next scoped decision before any synthetic write test or production-writer release.

## Sources

[1] https://docs.basicmemory.com/reference/mcp-tools-reference — Basic Memory MCP Tools Reference
[2] https://github.com/basicmachines-co/basic-memory/issues/1536 — Basic Memory issue 1536
[3] https://github.com/basicmachines-co/basic-memory-cloud/pull/2071 — Basic Memory Cloud PR 2071
[4] https://github.com/basicmachines-co/basic-memory/issues/1552 — Basic Memory issue 1552: checksum-guarded edit_note
[5] https://github.com/basicmachines-co/basic-memory/commit/62c76d28b1087f287aeb671b211dc516b683e3be — Basic Memory commit 62c76d28: conditional write_note overwrite
