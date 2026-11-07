# Optional Brain tools

The native `BrainRecall` and `BrainDrop` tools connect AEON to the existing
Brain Python CLI. They complement Letta's MemFS and transcript recall. They do
not change agent identity, the compiled core-memory prompt, compaction,
reflection checkpoints, or memory write ownership. No automatic turn capture,
new daemon, MCP, store, model override, or filer execution is introduced.

This is source qualification, not runtime adoption. Existing services and
operator configuration were left unchanged.

## Host configuration and discovery

Set both paths explicitly in the environment of the chosen AEON process:

```sh
export AEON_BRAIN_PYTHON=/absolute/path/to/brain-venv/bin/python
export AEON_BRAIN_HOME=/absolute/path/to/brain-home
# Optional integer 1–60000; default 15000 milliseconds.
export AEON_BRAIN_TIMEOUT_MS=15000
```

The selected Python environment must already provide the reviewed `brain`
package (`python -m brain.cli`) and its dependencies. No package is installed
by AEON. The Python executable's directory is the child working directory;
the caller's project directory cannot implicitly select a different module.
The host's Python environment is inherited. `AEON_BRAIN_HOME` explicitly
overrides Brain's ambient `BRAIN_HOME`; no default private vault is selected.

Both tools are in the Letta, Claude/default and Codex presets, through the
existing shared native tool registry used by TUI, headless and listener
execution. The `none` preset remains empty. Existing `--tools` and per-turn
client allowlists can omit them. If selected without configuration, the tool
reports unavailable. Registered tools do not prove a configured CLI works.

Normal permission rules apply unchanged: these tools default to **ask** in
standard/acceptEdits mode and respect existing allow/deny rules. This change
adds no auto-approval or mod agent-spawn authority. A shared-vault connection
is not an agent-private transcript store or a new per-agent ACL.

## Exact operations

`BrainRecall({query, limit?})` accepts a non-empty query of at most 4000
characters and 1–20 results (default 5). It invokes, without a shell:

```text
PYTHON -m brain.cli --home HOME recall --json --top LIMIT -- QUERY
```

The returned array retains `path`, nullable `type`, finite `score` and quoted
`line`. It separately retains `document_status` and the selected fact line's
`provenance`: `source`, `added`, `status`, `drops`. Those fields project Brain's
existing fact tags; they are not verified truth or instructions. Old CLI
output without structured metadata maps to null. Unknown status strings stay
literal; nothing silently becomes active. Malformed JSON, invalid typed
metadata or excess results produce an error, not an empty-success fallback.

`BrainDrop({text})` accepts non-empty UTF-8 text up to 64 KiB. It invokes:

```text
PYTHON -m brain.cli --home HOME drop --writer aya
```

Text is sent unchanged on stdin, preserving frontmatter and source-bearing
fact text. The model cannot select another writer, file, executable, vault,
schema or command. The CLI must exit successfully and acknowledge the native
absolute `HOME/inbox/new/aya/YYYYmmddTHHMMSSffffffZ-HASH8.md` path. The result
uses the canonical home resolved by Brain's `Paths.from_env`, including when
the configured home is a symlink. AEON validates that exact queue directory
and native filename without requiring the file to remain present after filing.
The result says **queued**, not admitted, filed, verified or learned. Runtime
agent and conversation IDs in this acknowledgement describe the submission;
they are not automatically written into facts or retained by Brain's filer. Include
relevant canonical source references in the fact text itself.

Brain's `run` and `release` remain host/operator operations. Successful queueing
does not run either operation or alter Letta reflection progress. There is no
automatic retry: interrupted or failed acknowledgement may follow a completed
write, so inspect the inbox before retrying.

## Failure and cancellation

The bridge uses AEON's existing owned process-group launcher. The internal
AbortSignal is supplied by shared tool execution and is absent from the model
schemas. A pre-cancelled request launches nothing. Timeout, cancellation,
input-delivery failure, or combined stdout/stderr exceeding 128 KiB stop the
owned group. Existing SIGINT-to-SIGKILL escalation is retained; a separate
three-second cleanup deadline returns an explicit unconfirmed-cleanup error
if settlement cannot be established. Never interpret that error as stopped.

Nonzero exit, missing executable/module and malformed output remain visible.
Arbitrary child stderr is drained but not echoed into the model context.
These tools have no paid-provider fallback. General orphan reconciliation
after host restart and Windows process-tree guarantees are not newly qualified.

## Qualification (2026-11-07)

`bun run check` passed all 13 checks, including TypeScript and the existing
runtime dependency graph. Native fixtures passed 40 tests / 237 assertions
across `src/tools/impl/brain.test.ts`, shared toolset construction and catalog
tests. Cases cover exact argv, preserved stdin bytes, null/unknown provenance,
invalid output, missing configuration, timeout escalation, shared-executor
cancellation, permission decisions and allowlist filtering.

The combined Brain and retained-Letta baseline passed **69 tests / 351
assertions** across eight files. The additional baseline covers durable message
search, committed system-prompt projection, compaction parity, acting-user
identity and reflection completion. Brain failure cases ran alongside those
checks; no Letta implementation was changed.

`bun build.js` produced the full Node-targeted CLI and package artifacts. A
separately bundled Node-targeted Brain module passed the temporary-vault
drop/recall roundtrip, pre-cancellation and missing-executable checks under
Node 26.9.0. This is module behavior qualification on the installed test runtime;
the repository's published supported Node range starts at 26.12.1 for Node 26.
No live terminal/listener provider session was started.

The optional actual CLI test uses a new temporary vault and the selected source
checkout only. It queues a Unicode/frontmatter drop, reads back exact bytes,
recalls a seeded fact through the shared executor, verifies source/status
metadata, and confirms no filer ledger was created. Run it with:

```sh
AEON_BRAIN_TEST_SOURCE=/absolute/path/to/reviewed/the-brain \
  bun test src/tools/impl/brain.test.ts \
  src/tools/toolset-construction.test.ts src/tools/toolset-catalog.test.ts
```

That test uses `/usr/bin/python3`, PyYAML and task-local `PYTHONPATH`; it does
not inspect the operator's Brain home. Without the explicit source opt-in it
is skipped. On this host, sandboxed Bun child stdin returned empty even in an
independent minimal fixture, while native Bun and Node delivered bytes. The
stdin/cancellation qualification therefore used the approved native route.
This distinction is retained rather than modifying working runtime semantics
to mask the sandbox limitation. No live provider or private memory was read.

The PR 14 follow-up corrected the Python test fixture to resolve its home like
the actual CLI. Both the fixture and disposable-vault CLI now exercise a
symlinked home. Strict queue/path/filename rejection stays unchanged, including
noncanonical alias acknowledgements. This coverage is part of the 156-test
review rerun recorded in [AgentRun workers](agentrun-workers.md); no production
Brain path validation was widened.
