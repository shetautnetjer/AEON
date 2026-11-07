# Harness-owned AgentRun workers

The opt-in `@letta-ai/letta-code/agentrun-worker` export supplies
`createAgentRunWorkerHost(config)`. It connects the existing SDK spawner to an
external harness-owned AgentRun procedure. It is not a mod tool, scheduler or
replacement for the native Letta agent, memory, permission or steering lifecycle.

The config explicitly selects `parentAgentId`, `model`, canonical `cwd`,
`allowedTools`, `timeoutMs`, `maxToolCalls`, `maxConcurrent: 1`, `backend: "local"`,
`backendDir`, `permissionMode`, and optional `stopSettlementTimeoutMs` (default
5000). `LETTA_LOCAL_BACKEND_DIR` must resolve to that directory; the caller must
set `LETTA_CLI_PATH` to its intended built harness. The returned immutable
`workerBinding` is bound into AgentRun's native recovery journal by the Evolve
runner. A changed parent, model, workspace, tool selection, backend or limit
cannot reuse that journal's completed output. The SDK retains its native login
and provider ownership; this module does not copy credentials.
Resolved CLI/SDK override paths also join the binding and are checked before
dispatch. Keep the process's route environment stable for the host lifetime;
the SDK resolves its CLI lazily. Evolve's entry rejects concurrent invocation
before changing that route and restores its prior values after close. Installed
SDK dependency bytes remain pinned by the owning AEON dependency lock; supplying
a custom injected SDK client transfers that implementation choice to the caller.
Unresolvable configured paths, including removed backend/CLI/SDK routes at a
dispatch recheck, produce `AEON_WORKER_CONFIG` with `final: true` before any
query. Unset optional CLI/SDK overrides remain null in the binding; adding one
after binding is a route change, not permission to retry the procedure.

This first host admits one worker at a time and refuses overlapping calls. There
is no deferred queue. `close()` stops admission, aborts/drains an active turn and
disposes the SDK client. An abort acknowledgment alone is insufficient: the
spawner waits for a native terminal result, bounded by the settlement timeout.
Delayed SDK startup triggers another interrupt when its identity becomes known.
A dropped stream, pending `requires_approval`, missing verdict or expired settlement deadline reports
`cleanupUnconfirmed`, retains the observed conversation ID and blocks reuse.
An SDK client disposal is not proof of OS child exit; provider qualification must
observe owned subprocesses separately. A settled turn may share a still-running
App Server with other turns.

The host's `runAgent` consumes native AgentRun step metadata and passes explicit
workspace/tool/model policy to the existing spawner. The logical `step.sessionId`
never selects a native conversation. Results and native IDs are returned to the
native journal; incomplete work is not automatically resumed or redispatched.
The host requests a JSON final response with the schema in its instructions and
returns a parsed candidate. The pinned AgentRun interpreter owns transport/stage
schema validation immediately after `runNode`, including replay. Invalid JSON
fails without another query; schema-invalid JSON stays failed on replay and does
not promote the workflow. `resultTransport: "json"` is part of the binding.

This transport is an explicit SDK 0.8.38 workaround. The first real cancellation
canary exposed `streamStructuredTurns` starting portable structured-output repair
turns after a native `interrupted` result, then rewriting the terminal reason.
The AgentRun host therefore omits SDK `outputFormat`; the shared Workflow schema
API is unchanged. The failed canary remains retained in SUPERAGENT evidence;
the workaround's offline regressions do not replace a fresh real qualification.
The plain SDK stream can mark `requires_approval` as successful; the spawner
explicitly treats it as unfinished work and holds cleanup/reuse rather than
accepting preceding JSON or changing the configured approval policy.

Wall-clock expiry requests interruption and has a separate bounded settlement
wait. `maxToolCalls` reuses the spawner's observed-call stop threshold: after
seeing a call beyond the threshold it interrupts asynchronously. It is not a
qualified pre-execution tool admission cap. Strict native `maxTurns`, fork,
monetary budgets and per-step reasoning policy are unsupported and refused, not
silently interpreted as another limit. API-backend integration is not provided
by this first host; the existing SDK/API spawner remains unchanged in scope.

Evolve runner 0.5.0 supplies the runnable harness entry at
`aya/agentrun/src/harness-cli.mjs` and documents its explicit config/command.
Its worker effects use the existing AgentRun recovery journal and checked result
schema. A completed effect can be replayed after coordinator death before node
commit; an unknown effect remains held for native reconciliation. No new general
job database or native session registry is introduced.

As of 2026-11-07, source checks, build/import and deterministic SDK-host fixtures
have been exercised on `codex/aeon-agentrun-workers-20261107`. The owner
SUPERAGENT qualification packet records the exact source revisions and any
separate real-provider canary. This document does not claim installation,
daemon adoption, a provider cleanup guarantee or a Brain memory migration.

The PR 14 review follow-up at source `1586258c3` passed all 13 checks,
`bun build.js`, and 156 affected tests across 13 files. The reflection-launcher
suite also passed separately as required by its isolation manifest (19 tests;
already included in the 156). A built Node worker-module fixture passed seven
checks for final path failures and a normal JSON result, using an injected SDK
client and no provider calls. Node was 26.9.0, below the declared supported Node
26 range; these checks do not repeat or replace native provider qualification.
