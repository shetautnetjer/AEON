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
is still idle. Ctrl-C targets an exactly owned turn; `/stop` explicitly targets
the selected conversation. A send whose acknowledgement is lost stays visibly
uncertain until correlated completion or cancellation; it is not automatically
sent again. Reopen chat after disconnecting from a restarted server.

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

## Verification

Focused checks cover scoped transport, exact input ownership, approval retention,
uncertain sends, private command dispatch, masked forms, skill selection, native
accumulator compatibility, actual offline PTY rendering and the Node-targeted
bundle. Startup fixtures isolate HOME, TMPDIR and backend state. Run repository
`bun run check` as well as affected behavior tests. Offline fixtures do not prove
live provider behavior; deployment evidence belongs in the owning installation's
status record (Aya: evolve `aya/chat/STATUS.md`).
