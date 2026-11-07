# Worker execution qualification

As of 2026-11-07. Candidate implementation on `codex/aeon-worker-limits`, based
on `61b6634eb`. This records source behavior and disposable-fixture qualification;
it is not a claim that the running daemon has adopted this branch.

## Turn limits

`launch_subagent` and `Agent` accept the existing positive-integer `max_turns`
field. Native Letta launches retain the existing forwarding and enforcement
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

Cancellation and memory-retention qualification are recorded separately as that
candidate is integrated. Preserve turn leases, steering, native session capture,
mod spawning restrictions and reflection's integration-success checkpoint.
