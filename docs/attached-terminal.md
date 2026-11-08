# Native terminal attached to an App Server

`letta attach --agent <id> [--conversation <id> | --new [title]]` opens the
native Ink input, transcript, reasoning, tool, approval and command components
against an existing App Server. Closing it closes the client socket. The server
continues to own turns, tools, queues, hooks and agent memory.

Use `--url` and `--token-file` to select the server. Tokens are read in-process
from a file, never accepted as command-line values. `--list` lists sessions without
starting a turn. `--phone` uses the existing Aya route; ordinary startup resumes
the saved terminal selection. Aya's launcher supplies its existing default agent
and preserves the original selection paths. Generic `letta attach` requires an
explicit agent or `AYA_AGENT_ID`.

Existing conversations use validated scoped sync with approval recovery and
interrupted-turn resumption disabled. A new conversation uses `runtime_start`.
Switching prepares another socket and commits only while the current conversation
is still idle. Esc targets an exactly owned turn; `/stop` explicitly targets
the selected conversation. A send whose acknowledgement is lost stays visibly
uncertain until correlated completion or cancellation; it is not automatically
sent again. Reopen chat after disconnecting from a restarted server.

Ctrl-C clears the draft; a second Ctrl-C within one second exits chat. `/quit`
also exits. Neither exit requests cancellation of a server-owned turn.

Display preferences are read without bootstrapping credentials, migrating
settings or starting browser discovery. Native transcript accumulation runs in
presentation-only mode: pre-tool, post-tool and pre-compaction hooks execute on
the server, never in this client. Ordinary native TUI behavior is unchanged.

## Commands

Type `/` for native autocomplete and `/help` for the attached command list and
keyboard help. Each native command is explicitly classified; an unsupported
slash command is never sent to the model as ordinary text.

- Session and agent selection: `/agents`, `/pinned`, `/profiles`, `/resume`,
  `/threads`, `/switch <id>`, `/new`, `/fork`, `/rename`.
- Agent settings: `/model`, `/description`, `/toolset`, `/experiments`,
  `/system`, `/personality`, `/sleeptime`, `/compaction`, `/pin`, `/unpin`.
- Memory and inspection: `/memory`, `/memfs`, `/recompile`, `/search`, `/mcp`,
  `/context`, `/usage`, `/subagents`, `/bg`, `/history`, `/status`.
- Skills: `/skills` lists verified user-invocable skills. Selected skills,
  `/skill-creator`, `/mods generate-env` and `/statusline` build their canonical
  prompts on the server, then submit through the client's ordinary durable input
  path. Discovered skill slash commands use the same path. Private commands use reserved `attached:` wire IDs; ordinary mod commands
  retain their IDs and precedence. Automatic discovery cannot invoke a colliding mod.
- `/secret` and `/memory-repository` open masked forms. Secret values use the
  dedicated secret protocol and do not enter the visible composer or transcript.
  Repository URLs must omit embedded credentials, query and fragment; use the
  existing SSH or credential-helper setup. `/hooks` supports status and user
  enable/disable.
- Existing remote commands such as `/init`, `/doctor`, `/reflect`, `/compact`,
  `/reload`, `/context-limit`, and advertised mod commands remain server-owned.

The client uses capabilities advertised by the connected server. Older servers
can still chat, but do not expose the new private command panels. Inspection
results, configuration responses and prepared skill prompts go only to the
requesting socket, not to shared transcript subscribers. Their command arguments
are omitted from protocol diagnostic logs.

## Deliberate limits

This is the native interface with an attached execution path, not complete parity
with the standalone coordinator. Cloud login/provider setup, cloud-only surfaces,
local shell/terminal launch, teleport/link controls and experimental arena/palace
flows are unavailable here. `/clear` remains removed because the old remote
implementation corrupted durable input identities; use `/new`.

MCP is inventory, not an editor; memory is browsable and MemFS can be enabled,
but reset/disable/sync controls are not implemented. `/usage` and `/context` label
last-observed information rather than pretending to expose account totals or a
live context measurement. Configuration mutations check resident agent activity
and serialize other new configuration controls in this process; they do not
reserve the agent against subsequently arriving turns or other processes.

Approvals show complete escaped arguments. If the terminal cannot fit the entire
input, approval is disabled until resized; denial remains possible. Replayed
approvals are retained conservatively because an old terminal receipt or an empty
status is not proof that a pending approval was resolved. History/stream overlap
is deduplicated by canonical message IDs and incomplete tools remain live, but
the protocol supplies no history cutoff for perfectly distinguishing overlapping
partial text chunks with the same ID.

## Herdr status and exact-session restore

Inside a Herdr-managed pane, the attached client uses `HERDR_ENV=1`,
`HERDR_SOCKET_PATH` and `HERDR_PANE_ID` to report native state through Herdr's
existing local API. Outside that environment it does nothing. No Herdr hooks,
CLI installation, new daemon or terminal scraping are required by this adapter.

Native active work is `working`; approval, paused input, uncertain delivery,
disconnect or a session error is `blocked`; an idle native session is `idle`.
Startup stays `blocked` until the native keyboard handlers have mounted, so a
ready-state observer cannot send Enter while the terminal is still loading.
Herdr can display an unseen idle transition as `done`. Neither label certifies
a checked task result. AEON still owns approvals, cancellation, tools, queues,
Letta memory and Brain operations.

The client supplies Herdr's `resume_argv` with the exact native agent and
conversation, absolute runtime/entry/cwd/state directory, server URL and token
**file path**, plus the original primary-agent selection binding. Resume attaches
without submitting input or starting interrupted work. An idle conversation
switch updates the command to the newly validated native scope. The supported
entries are Bun's attached `entry.ts` or `src/index.ts`, and the Node/Bun
`letta.js` bundle on POSIX. An npm-style `letta` bin symlink is resolved to its
canonical `letta.js` target before that path is saved for restore. Broken links
and unrelated entry targets do not produce restore commands.
This first integration is qualified on Linux with
Herdr 0.9.5. Paths containing apostrophes/control characters and credential-bearing
URLs cannot be represented under this restore contract; native chat still works,
with a warning and withdrawal of this client's stale restore metadata.

Herdr's default **Ctrl+B, q** detaches its TUI while its server and pane processes
continue. **Esc** in the AEON pane cancels the exactly owned native turn; `/stop`
explicitly targets the selected conversation. **Ctrl+C** clears a draft and a
second Ctrl+C exits. `/quit` also deliberately exits and releases Herdr's report
and restore command. Unexpected process shutdown retains restore metadata so
Herdr can reopen the client. Stopping Herdr's server exits its pane processes;
it does not stop a separately owned AEON App Server or certify cancellation.

Reports are ordered within each client, coalesced, and bounded by a 250 ms socket
deadline. An unavailable reporter warns and retries on a later native update;
there is no independent polling loop. Displayed status/restore metadata may be
stale after a failed report. Reconcile native state before accepting results or
retrying work. Cold restore requires the original runtime, source/bundle, cwd,
token file and AEON server to remain available. This does not restart AEON itself
or reconstruct unknown workers after a host failure.

## Verification

The attached renderer gives Ink a fresh static-items array when completed lines
are committed. Ink memoizes pending static output by array identity; passing the
model's in-place-mutated array could erase the live line without printing its
completed replacement. Native conversation history remained intact. The render
regression checks bytes emitted at the commit transition, excluding earlier live
output. An isolated Linux/Herdr 0.9.5 qualification on 2026-11-07 retained Unicode
results through all four snapshot sources in single/split panes and after resize,
for both Bun source and the Node bundle. Detach, exact restore with zero replay,
scoped Esc cancellation and blocked approvals also passed. Existing sessions and
the installed AEON service were not changed by that source qualification.

Herdr's named prompt/key commands currently require a built-in agent identity;
AEON remains the custom identity `aeon`. Use explicit owned-pane input for this
qualified setup. Native history and checked artifacts remain the durable result
sources; a readable snapshot or an idle label is not result acceptance.

Focused checks cover scoped transport, exact input ownership, approval retention,
uncertain sends, private command dispatch, masked forms, skill selection, native
accumulator compatibility, actual offline PTY rendering and the Node-targeted
bundle. Startup fixtures isolate HOME, TMPDIR and backend state. Run repository
`bun run check` as well as affected behavior tests. Offline fixtures do not prove
live provider behavior; deployment evidence belongs in the owning installation's
status record (Aya: evolve `aya/chat/STATUS.md`).

### Current-main reconciliation, 2026-11-07

The Herdr branch merged main at `06396884` (daemon reflection PR #13) without
conflicts. Attached runtime, fixture, dependency and vendored Ink bytes were
unchanged by that merge. The first combined test run exposed a timing flaw in
the existing PTY driver: its fixed 600 ms expand key could arrive while the
initial approval still owned focus. A deliberate 1.2-second child startup
delay reproduced the same missing-thinking assertion. The driver now waits
for the rendered `ctrl+t to expand` control, sends the key once and always
cleans up its owned child. The delayed control passes with every content
assertion retained; production behavior and the fixture are unchanged.

All 13 source checks, the merged-source build, 35 attached tests and 46
reflection tests passed. Reflection transport used
`LETTA_TEST_BUILT_ARTIFACT=1` to include both Bun and built Node. The first
34-pass/one-failure attached run and the earlier 45-test Bun-only reflection
run remain in the SUPERAGENT qualification packet. Earlier native Herdr
readback/lifecycle evidence still applies to the unchanged attached runtime;
those native pane exercises were not repeated for this test-driver repair.
