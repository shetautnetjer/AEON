# Worker execution qualification

As of 2026-11-07. Candidate implementation on `codex/aeon-worker-limits`, based
on `61b6634eb`. This records source behavior and disposable-fixture qualification;
it is not a claim that the running daemon has adopted this branch.

## Turn limits

The App Server `launch_subagent` contract accepts the existing positive-integer
`max_turns` field. Native Letta launches retain the existing forwarding and enforcement
path. Requests for `claude-code`, `codex` or `opencode` with a supplied cap now
fail explicitly before task creation or remote dispatch. The direct local and
remote driver entrypoints apply the same rule before secrets, provider preflight
or connection work. Requests omitting the cap keep their existing behavior.

The external drivers have no qualified strict agentic-turn budget here. Codex
app-server turns are not interchangeable with the model/tool steps counted by
Letta. Native Claude 2.1.319 returned successful results reporting 43, 31 and 31
turns despite `--max-turns 30` in a separate bounded qualification. Merely passing
that flag or rejecting an oversized result afterward does not enforce a live
cap. There is no automatic provider fallback or silent removal of a requested
limit. Future support requires qualification of the actual driver path.

The shared launch implementation validates this field, but the current Agent
tool JSON schema does not advertise it. This change does not add a new Agent
tool parameter or claim that an ordinary model-generated Agent call sets a cap.

The source retains the limit in local/remote adapter options and remote argument
mapping, so a later qualified implementation cannot accidentally inherit the old
omission. Public errors use the existing launch failure shape; no wire schema or
new task registry is introduced.

## Checks for the limit change

- The full `bun run check` passed all 13 checks, including TypeScript, architectural
  checks and source-file-size limits.
- 107 worker/protocol/tool-contract checks passed together; isolated computer
  routing (26), fork receipt (16), and caller notification (6) checks also passed.
- Ten new external-limit cases exercise local, remote and direct paths, invalid
  limits and refusal before secret/connection/process side effects. Two added
  routing cases preserve native Letta budgets on local and remote selectors.
- Tests use controlled providers and fixtures. No real AEON worker, memory
  migration or live service restart was used for this limit qualification.

## Integrated cancellation and retained Letta behavior

The cancellation candidate `a0bd44b93` was integrated here as `fbec9d06a` after
the limit commit `c16aee3a8`. The existing fork-receipt mock was updated in
`73c5df8d8` to retain the new cleanup-error export; its behavior assertions were
unchanged. The [cancellation qualification](reviews/worker-cancellation-2026-11-07.md)
describes the source changes and process-local reconciliation limit.

Stops now require terminal evidence; a racing success cannot override an abort.
Unknown cleanup is a failure, with native identity and partial report preserved.
Claude/Codex exact-session continuation refuses that unresolved state. Confirmed
Codex turn interruption retains its reusable app-server session.

Unknown memory/reflection cleanup retains worktrees, snapshots, repair markers,
existing checkout leases and reflection reservations. It does not consume the
source transcript or merge/delete/sync that work. Integration/repair callback
promises return a failed result rather than hanging. Automatic/manual/arena
finalization and initial/retried TUI Stop preserve this ownership; ordinary
confirmed completion releases it. This preserves the existing Letta mechanisms
without adding a new scheduler, lock schema or memory provider.

Parent verification on the combined source passed:

- All 13 required source checks, including types, lint and architecture rules.
- 438 targeted tests across 42 isolated files, covering the changed paths plus
  steering, turn ownership, capture, memory leases/commits and mod spawn refusal.
  An initial fixture import failure was corrected by retaining real module
  exports; the 16 affected tests passed on rerun. No runtime assertion was weakened.
- The bundled offline Node cancellation fixture (1 test), `bun run build`, and
  the repository's built-entrypoint suite (14 tests).

No live Claude/Codex provider or daemon deployment was used for AEON acceptance.
The native fixture ran under Node 26.9.0, below this package's supported engine
ranges; Bun 1.3.14 checks/build passed. Windows and cross-restart unknown-child
reconciliation remain unqualified. Retained leases follow the parent PID/start
time; do not treat parent restart as proof that the worker has stopped.

SUPERAGENT retains the exact source/build hashes, check logs and original
failed fixture output in its dated worker-execution evidence index. Original
AEON checkout and running service were not changed by this candidate.
