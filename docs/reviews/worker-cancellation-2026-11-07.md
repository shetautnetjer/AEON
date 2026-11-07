# Worker cancellation qualification — 2026-11-07

Source candidate based on AEON `61b6634`, branch
`codex/aeon-worker-cancellation`. This implements the approved cancellation
slice alongside the separate worker-limit change. It does not deploy or restart
AEON, change models or credentials, or establish live-provider qualification.

## Settlement contract

| Boundary | Evidence now required |
| --- | --- |
| Claude final result | Its owned transport must settle before the result is accepted. Cancellation wins over a late native success; nonzero exit or uncertain group cleanup remains failure. |
| Codex interrupt | Native `turn/interrupt` acknowledgment requests cancellation. A terminal turn notification settles work; the reusable app-server can remain alive. Cancellation intent cannot be overwritten by a later completed status. |
| Codex transport loss | Missing, rejected or timed-out process exit evidence produces an explicit cleanup failure, preserving thread ID and partial report. |
| Process-group cancellation | After SIGINT and SIGKILL, failure to observe group exit rejects completion instead of claiming cleanup. The existing signal sequence is unchanged. |
| Remote stop response | `stopped: true` requires task settlement, bounded by five seconds. Missing completion, rejection and timeout return failure with `stopped: false`. |
| Exact-session continuation | Claude and Codex keep an in-process failed session entry after uncertain cleanup. Attempts to resume that exact session are refused before spawning a replacement. Confirmed shutdown still permits resume. |

The additive `SubagentResult.cleanupUnconfirmed` and corresponding callback
fields are internal execution evidence. No WebSocket schema, registry vocabulary,
new scheduler, process reaper, memory store or billing route is introduced.
Native IDs, available reports and usage survive cleanup failure. Task transcripts
include failed workers' partial reports once. Publication errors cannot erase
cleanup evidence or invoke the completion callback twice.

Sources: [process cleanup](../../src/agent/subagents/subagent-process.ts),
[Claude](../../src/tools/impl/claude-stream-session.ts),
[Codex](../../src/tools/impl/codex-app-server.ts),
[stop handler](../../src/websocket/listener/commands/subagent-control.ts),
[task completion](../../src/tools/impl/task-completion.ts).

## Letta behavior retained

Ordinary memory cancellation still discards the isolated worker worktree;
ordinary merge, no-change, conflict repair, prompt refresh and conversation capture
paths retain their existing behavior. Failed memory execution still waits for its
memory lifecycle before the task's completion settles.

Unconfirmed cleanup is different: an update worker's private worktree and branch,
repair marker, handoff snapshot and existing checkout lease are retained. There
is no merge, deletion, sync or success claim for that branch. Reflection worker
callbacks that would finalize worktrees are deferred. Nested explicit integration
and merge-repair callbacks return failure, so their promises finish; finalizers
preserve the worktree/merge and do not consume the source transcript. Existing
reflection launch reservations are retained, including manual and arena paths.
An uncertain arena choice leaves the run and both candidates unchanged and
refuses another choice while the reservation is held.

These holds require manual process reconciliation. The checkout lock is owned
by the parent PID and start time; its existing dead-owner reaping does not prove
an uncertain child stopped. Session-map entries and reflection reservations are
process-local. Restarting the parent is not a reconciliation procedure. This
slice adds neither an automatic release decision nor cross-restart recovery for
these unresolved states. Inspect actual child/process-group state and retained
Git evidence before explicitly releasing an existing hold or retrying work.

Sources: [memory lease](../../src/agent/memory-operation.ts),
[memory worker](../../src/agent/subagents/memory-worker.ts),
[handoff](../../src/agent/subagents/memory-handoff.ts),
[reflection finalization](../../src/cli/helpers/reflection-launcher.ts),
[caller completion](../../src/cli/helpers/reflection-launch-completion.ts),
[arena choice](../../src/cli/helpers/reflection-arena.ts).

## Qualification

Offline tests use fake provider transports, temporary Git repositories and owned
fixture processes; no Claude/Codex model calls are involved. The regressions
cover final-result/abort races, interrupt acknowledgments, process-group escalation,
uncertain group exit, transport loss, exact-session refusal, stop settlement,
partial transcripts, publication failure, memory lease/snapshot retention,
reflection finalization and reservation/frontier preservation.

Successful checks on the candidate include a 234-test combined sweep across 22
files, followed by checks of the final provider continuation changes (22 Claude
and 31 Codex tests), 21 reflection worktree-finalization tests, 17 caller/task
tests, and 11 rendered TUI interruption tests. These groups overlap; they are
not a summed test total. The final built Node process fixture passed 1/1.

`bun run check` passed all 13 source checks. Bun is 1.3.14. The built Node
fixture uses Node 26.9.0, which is below the package's declared supported Node
engine ranges; its passing result is runtime evidence on that version only.
Build and run the offline Node fixture with:

```sh
bun build src/tools/impl/claude-cancellation.node-test.ts --target=node --format=esm --outfile=/tmp/aeon-cancellation.node-test.mjs
node --test /tmp/aeon-cancellation.node-test.mjs
```

For direct Bun tests, use a fresh writable `TMPDIR`: this host's pre-existing
`/tmp/memory-worktrees` is owned by another user. Tests requiring real subprocess
pipes must run through a native terminal route; restricted execution dropped
fixture stdout with `EPERM`. Reflection worktree completion tests also need the
repository's existing isolated test setting `LETTA_CODE_TELEM=1`; that suite
captures telemetry locally with a stubbed drain. The normal project test runner
already supplies this setting.

Windows taskkill behavior, live Claude/Codex providers, remote deployment, and
cross-restart child reconciliation were not qualified by this source candidate.
The parent implementation branch must still combine this change with worker
limits, run the full required checks and review before adoption.
