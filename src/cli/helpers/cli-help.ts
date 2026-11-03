import { renderCliOptionsHelp } from "@/cli/args";

export function printHelp() {
  // Keep this plaintext (no colors) so output pipes cleanly
  const usage = `
Letta Code is a general purpose CLI for interacting with Letta agents

USAGE
  # interactive TUI
  letta                 Resume last conversation for this project
  letta --new           Create a new conversation (for concurrent sessions)
  letta --resume        Open agent selector UI to pick agent/conversation
  letta --new-agent     Create a new agent directly (skip profile selector)
  letta --agent <id>    Open a specific agent by ID

  # headless
  letta -p "..."        One-off prompt in headless mode (no TTY UI)

  # attach to an existing app server
  letta attach --agent <id> [--conversation <id> | --new]

  # maintenance
  letta update          Check for updates and install (aliases: upgrade, --update, --upgrade)
  letta memory ...      Memory filesystem subcommands
  letta agents ...      Agents subcommands (JSON-only)
  letta model ...       Get, list, or set models and reasoning (JSON-only)
  letta usage           Show account credits and Letta quota (Markdown)
  letta computers ...   List available remote computers (JSON-only)
  letta teleport ...    Move the current conversation between computers
  letta messages ...    Messages subcommands (JSON-only)
  letta mcp ...         List, search, and call MCP servers available to an agent
  letta mods ...        List and manage local mods
  letta sandbox ...     Transfer files to or from the current Cloud sandbox
  letta server ...      Run a remote computer, channels, or the App Server
  letta connect ...     Connect providers from terminal
  letta backend ...     Show or set the default backend
  letta setup           Re-run first-run setup
  letta install ...     Install a skill or mod package
  letta skills ...      List or delete installed agent skills
OPTIONS
${renderCliOptionsHelp()}
SUBCOMMANDS
  letta memory status --agent <id>
  letta memory diff --agent <id>
  letta memory resolve --agent <id> --resolutions '<JSON>'
  letta memory backup --agent <id>
  letta memory backups --agent <id>
  letta memory restore --agent <id> --from <backup> --force
  letta memory export --agent <id> --out <dir>
  letta memory pull --agent <id>
  letta memory tokens [--memory-dir <path>] [--agent <id>] [--format text|json]
  letta agents list [--query <text> | --name <name> | --tags <tags>]
  letta computers list [--online-only] | current
  letta teleport list|cloud|local|<computer>
  letta messages search --query <text> [--all-agents]
  letta messages list [--agent <id>]
  letta messages transcript --conversation <id> [--out <path>]
  letta steps trace --agent <id> --step <id>
  letta mods list [--agent <id>]
  letta mods package <mod-file> --name <package-name> [--out <dir>]
  letta mods enable <package-spec>
  letta mods disable <package-spec>
  letta mods remove <package-spec>
  letta mcp list|get|tools|search|call ... [--agent <id>]
  letta server [--computer-name <name> | --listen [url]] [options]
  letta connect <provider> [options]
  letta install <thing> [--agent <id> | -n <name>]
  letta skills list [--agent <id> | -n <name>]
  letta skills delete <skill_name> --agent <id>
  letta backend [cloud|local]
  letta local-backend migrate-transcripts [--storage-dir <path>] [--dry-run]

BEHAVIOR
  On startup, Letta Code checks for saved profiles:
  - If profiles exist, you'll be prompted to select one or create a new agent
  - Agents can be pinned for quick access with /pin
  - Use /profile save <name> to bookmark your current agent

  Agent pins are stored in ~/.letta/settings.json.

  If no credentials are configured, you'll be prompted to authenticate via
  Letta Cloud OAuth on first run.

EXAMPLES
  # when installed as an executable
  letta                    # Show profile selector or create new
  letta --new              # Create new conversation
  letta --agent agent_123  # Open specific agent
  letta install official/finance/stocks --agent agent-123
  letta install npm:@letta-ai/mod-plan-mode

  # inside the interactive session
  /profile save MyAgent    # Save current agent as profile
  /profiles                # Open profile selector
  /pin                     # Pin current agent
  /unpin                   # Unpin current agent
  /logout                  # Clear saved credentials and exit

  # headless with JSON output (includes stats)
  letta -p "hello" --output-format json

`.trim();

  console.log(usage);
}
