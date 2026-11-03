import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function readAttachedSelection(directory: string): string | undefined {
  for (const name of ["last-conversation", "terminal-conversation"]) {
    try {
      const id = readFileSync(join(directory, name), "utf8").trim();
      if (id && !/\s/.test(id)) return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export function saveAttachedSelection(
  directory: string,
  conversationId: string,
  created = false,
): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of created
    ? ["last-conversation", "terminal-conversation"]
    : ["last-conversation"]) {
    const target = join(directory, name);
    const temporary = `${target}.tmp-${process.pid}`;
    writeFileSync(temporary, `${conversationId}\n`, { mode: 0o600 });
    renameSync(temporary, target);
  }
}

/** Read the existing phone routing records; the server still validates the selected agent. */
export function findAttachedPhoneConversation(
  home: string,
  agentId: string,
): string | undefined {
  try {
    const map = JSON.parse(
      readFileSync(
        join(home, ".letta/lc-local-backend/openai-chat-keys.json"),
        "utf8",
      ),
    ) as { entries?: unknown[] };
    const prefix = `chat-key:${agentId}:aya-phone-`;
    const matching = (map.entries ?? []).filter(
      (entry): entry is [string, string] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        entry[0].startsWith(prefix) &&
        typeof entry[1] === "string",
    );
    const latest = matching.at(-1)?.[1];
    if (latest) return latest;
  } catch {
    /* Fall back to the channel's persisted routing record. */
  }
  try {
    const routing = JSON.parse(
      readFileSync(
        join(home, ".letta/channels/aya-phone/routing.json"),
        "utf8",
      ),
    ) as {
      routes?: Array<{
        agentId?: string;
        enabled?: boolean;
        conversationId?: string;
      }>;
    };
    return routing.routes?.find(
      (route) =>
        route.agentId === agentId &&
        route.enabled !== false &&
        typeof route.conversationId === "string",
    )?.conversationId;
  } catch {
    return undefined;
  }
}
