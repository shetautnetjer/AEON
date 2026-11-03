import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { listAttachedConversations } from "@/cli/attached/attached-list";
import {
  attachedStateDirectory,
  parseAttachedOptions,
} from "@/cli/attached/attached-options";
import {
  findAttachedPhoneConversation,
  readAttachedSelection,
  saveAttachedSelection,
} from "@/cli/attached/attached-state";

const HELP = `letta attach --agent <id> [--conversation <id> | --new [title]]

Open the native terminal interface on an existing AEON app server.
The server owns turns, tools, queues and memory; closing this client leaves it running.

  --url <ws-url>        Server address (AYA_APP_SERVER; default ws://127.0.0.1:4599/ws)
  --token-file <path>   Read the server token from a file, never a command-line value
  --agent <id>         Agent to attach (AYA_AGENT_ID)
  --conversation <id>  Existing session (--conv and -C are aliases)
  --new [title]        New session with the same agent and memory
  --list               List sessions without starting an agent turn
  --phone              Attach to the existing Aya phone route
  --state-dir <path>   Client session selection (AYA_CHAT_STATE)
  --no-color           Disable colors

Inside the terminal, type / for commands or /help for keyboard help.
Native commands use the server's capabilities; unavailable commands explain why.
`;

export async function runAttachSubcommand(argv: string[]): Promise<number> {
  let options: ReturnType<typeof parseAttachedOptions>;
  try {
    options = parseAttachedOptions(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const agentId = options.agentId ?? process.env.AYA_AGENT_ID;
  if (!agentId) {
    console.error("attach requires --agent <id> or AYA_AGENT_ID");
    return 2;
  }
  if (!options.list && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error(
      "The native attached interface needs an interactive terminal. Use aeon say for one-shot messages.",
    );
    return 2;
  }
  if (!options.list && process.env.TERM === "dumb") {
    console.error(
      "The native attached interface needs a terminal with cursor control.",
    );
    return 2;
  }
  if (!options.color) process.env.NO_COLOR = "1";
  const home = homedir();
  const url =
    options.url ?? process.env.AYA_APP_SERVER ?? "ws://127.0.0.1:4599/ws";
  const tokenFile =
    options.tokenFile ??
    process.env.AYA_TOKEN_FILE ??
    join(home, "Confidential/aya-gateway/token");
  let authToken: string;
  try {
    authToken = readFileSync(tokenFile, "utf8").trim();
    if (!authToken) throw new Error("empty token file");
  } catch {
    console.error(
      "Cannot read a nonempty app-server token file. Check --token-file or AYA_TOKEN_FILE.",
    );
    return 2;
  }
  if (options.list) {
    try {
      const conversations = await listAttachedConversations(
        { url, authToken, WebSocket },
        agentId,
      );
      for (const [index, conversation] of conversations.entries()) {
        console.log(
          `${index + 1}. ${visibleListText(conversation.id)}  ${visibleListText(conversation.summary ?? "")}`,
        );
      }
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  const stateRoot =
    options.stateDir ??
    process.env.AYA_CHAT_STATE ??
    join(home, ".local/state/aya/chat");
  let directory = attachedStateDirectory(
    stateRoot,
    agentId,
    process.env.AYA_AGENT_ID,
  );
  let conversationId: string | undefined;
  try {
    conversationId = options.phone
      ? findAttachedPhoneConversation(home, agentId)
      : (options.conversationId ??
        (options.create === undefined
          ? readAttachedSelection(directory)
          : undefined));
    if (options.phone && !conversationId)
      throw new Error("No saved phone conversation is routed to this agent.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const { AttachedSession } = await import("@/cli/attached/attached-session");
  let session: Awaited<ReturnType<typeof AttachedSession.connect>>;
  try {
    session = await AttachedSession.connect({
      url,
      authToken,
      WebSocket,
      agentId,
      conversationId,
      title: options.create ?? "Terminal",
      cwd: options.cwd ?? process.cwd(),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  let selected = "";
  let saveWarningShown = false;
  const save = () => {
    const scope = session.getSnapshot().scope;
    const key = `${scope.agentId}:${scope.conversationId}`;
    if (key === selected) return;
    directory = attachedStateDirectory(
      stateRoot,
      scope.agentId,
      process.env.AYA_AGENT_ID,
    );
    saveAttachedSelection(
      directory,
      scope.conversationId,
      !selected && !conversationId,
    );
    selected = key;
    saveWarningShown = false;
  };
  let unsubscribe = () => {};
  let framesUnsubscribe = () => {};
  try {
    save();
    unsubscribe = session.subscribe(() => {
      try {
        save();
      } catch {
        if (!saveWarningShown)
          console.error(
            "Could not save the selected session. Chat remains connected.",
          );
        saveWarningShown = true;
      }
    });
    if (process.env.AYA_CHAT_FRAMES) {
      const logFile = process.env.AYA_CHAT_FRAMES;
      framesUnsubscribe = session.onFrame(
        (frame) => {
          try {
            appendFileSync(
              logFile,
              `${new Date().toISOString()} ${frame.type}\n`,
            );
          } catch {
            /* Optional metadata diagnostics must not interrupt chat. */
          }
        },
        { replayPending: false },
      );
    }
    // Native input reads display preferences. It does not load a local agent or tool loop.
    const { settingsManager } = await import("@/settings-manager");
    await settingsManager.initialize({ readOnly: true });
    const { render } = await import("ink");
    const { AttachedApp } = await import("@/cli/attached/AttachedApp");
    const app = render(<AttachedApp session={session} />, {
      exitOnCtrlC: false,
    });
    await app.waitUntilExit();
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    unsubscribe();
    framesUnsubscribe();
    session.close();
  }
}

function visibleListText(value: string): string {
  return value.replace(
    /\p{C}/gu,
    (char) => `\\u{${char.codePointAt(0)?.toString(16)}}`,
  );
}
