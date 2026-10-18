# Native Cloud setup — controller disposition

Recorded 2026-10-18 UTC. Existing owner: `aeon/t_d1739707`; target profile: `knowledge-writer`.

## Accepted scope

Khamani explicitly authorized: “You can set up native cloud tools” in Telegram session `20261009_130319_a23158`. This supersedes the prior unanswered setup decision prospectively; that receipt remains valid history. The authorization covers the same writer's native read/edit connection for the existing three-note task, with general command approvals unchanged. It is not a new note-writing mandate, new task, broader account grant or Finance release.

The writer now has native custom HTTP registration `basic_memory_cloud` at `https://cloud.basicmemory.com/mcp`. Its exact exposed tools are:

- `mcp__basic_memory_cloud__read_note`
- `mcp__basic_memory_cloud__edit_note`

The service-specific credential is resolved by the native command secret source through the existing scoped 1Password helper. The registration contains an environment reference, not the API key. The initial OAuth attempt did not establish authenticated consent; the existing API-credential route subsequently passed. No new API key was minted. Neither installer process remains running.

`tools.include` contains only `read_note` and `edit_note`; resource/prompt helpers and sampling are disabled. Parallel tool calls are disabled for this binding. Per-server `trust: full` permits these exposed native operations; general `approvals.mode=manual` and `single_query_mode=deny` are unchanged. Task authority still limits edits to the three exact notes in the owner brief; the MCP allowlist is a tool boundary, not a project/path permission sandbox.

## Real verification

Private evidence root: `/home/aya-hmw/.local/state/aya-task-supervisor/cloud-native-setup-7h5zetmm/`.

- Native installer/test authenticated and discovered the hosted inventory. Inventory size alone was not used as the exposed-surface acceptance test.
- Two separate installation-bound native registry/handler checks used the actual writer profile. The second explicitly asserted the single-query context, effective manual/deny policy, and an admitted native edit trust gate without invoking an edit.
- Both registered exactly the two named tools. Create/delete and an unselected future-tool name were absent. The live edit schema contains `expected_checksum`.
- The single-query read returned the exact Working project UUID `be29331d-c6a0-4d7b-bfcb-911c67925cb6`, exact path `working/AYA Working — Current Operating Context.md`, nonempty content and server `revision_checksum`. Text and structured JSON payloads agreed. Native connections were closed after the second check.
- `configuration-verification.json` confirms the writer's only top-level configuration differences are the new MCP binding and command secret source. Other secret sources, MCP registrations, general approvals, model and agent settings match the pre-setup snapshot. All other captured profile configurations, including the default profile, have matching endpoint digests.
- The latest writer model session still belonged to blocked run27 at the setup check. These are fresh native-runtime checks, not a claimed new model-worker execution or a reload of an existing chat.

Decisive receipts: `single-query/summary.json`, `single-query/native-exposed-schemas.json`, `single-query/native-read-result.json`, `configuration-verification.json`, `setup-worker-session-check.json`. Raw note bodies and secret-bearing configuration backups remain private, outside Git. Hermes source at verification: `a1f2370dd579dc72d27737bc3c3448fc8d7596b3`.

## Retained setup correction

The piped installer driver expected a numbered selection prompt. This build's non-TTY curses fallback instead saved the default all-selected tool inventory, so the driver returned failure after a successful registration side effect. The saved target was inspected and corrected with the supported native configuration setter before adding full trust and before any new writer session. `non-tty-installer-selection.json` preserves that intermediate registration. The corrected two-tool surface was independently exercised as above. Do not rerun the historical installer driver or mistake its exit status for absence of a registration.

## Handoff and limits

Native setup is accepted for fresh writer sessions. This setup made no Cloud note mutation and did not repeat the already accepted synthetic canary. Actual three-note reconciliation and independent controller readback remain outstanding.

The existing supervisor may consume this disposition and the updated task owner to continue only `aeon/t_d1739707` under its original three-note authority. Inspect current task/run/recurrence first, preserve run26/run27 evidence, use the new disjoint continuation output paths, and do not recreate the task, weaken approvals, repeat a permission question or extend note scope. A source-bound setup handoff is not proof that the supervisor consumed it or that production reconciliation completed.
