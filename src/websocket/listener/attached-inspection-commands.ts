import type { MessageSearchResponse } from "@letta-ai/letta-client/resources/messages";
import { getBackend } from "@/backend";
import { getClient } from "@/backend/api/client";
import { listServerMcpServers } from "@/backend/api/mcp-servers";
import { searchMessagesForBackend } from "@/backend/message-search";
import { getClientMcpServerStates } from "@/mcp-runtime";
import { settingsManager } from "@/settings-manager";
import type { AgentRuntimeScope } from "@/types/runtime-scope";

export interface AttachedInspectionDeps {
  localSearch: boolean;
  search: (body: Record<string, unknown>) => Promise<MessageSearchResponse>;
  localServers: (
    agentId: string,
  ) => Array<{ name: string; status: "connected" | "failed" | "not observed" }>;
  registeredServers: (() => Promise<string[]>) | null;
}

/** Only return names and statuses: never send config targets, arguments, headers or environment. */
function defaultDeps(): AttachedInspectionDeps {
  const backend = getBackend();
  return {
    localSearch: backend.capabilities.localModelCatalog,
    search: (body) =>
      searchMessagesForBackend<MessageSearchResponse>(body, backend),
    localServers: (agentId) => {
      const observed = getClientMcpServerStates(agentId);
      return settingsManager.getMcpServers(agentId).map((config) => ({
        name: config.name,
        status:
          observed.find((entry) => entry.config.name === config.name)?.status ??
          "not observed",
      }));
    },
    registeredServers: backend.capabilities.serverSideToolManagement
      ? async () =>
          (await listServerMcpServers(await getClient())).map(
            (server) => server.server_name,
          )
      : null,
  };
}

function display(value: unknown, max = 240): string {
  let result = "";
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0) ?? 0;
    const unsafe =
      code < 32 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
    result += unsafe ? `\\u${code.toString(16).padStart(4, "0")}` : character;
    if (result.length >= max) return `${result.slice(0, max)}…`;
  }
  return result;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part: unknown) => {
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join(" ");
}

type SearchOptions = {
  query: string;
  mode: "fts" | "vector" | "hybrid";
  range: "agent" | "conv" | "all";
};

function searchOptions(args: string, localSearch: boolean): SearchOptions {
  let value: unknown = { query: args };
  if (args.trimStart().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(args);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.hasOwn(parsed, "query")
      )
        value = parsed;
    } catch {
      value = { query: args };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid attached search request");
  const request = value as Record<string, unknown>;
  if (typeof request.query !== "string" || !request.query.trim())
    throw new Error("Enter a search query");
  const mode = request.mode ?? (localSearch ? "fts" : "hybrid");
  const range = request.range ?? "agent";
  if (
    (mode !== "fts" && mode !== "vector" && mode !== "hybrid") ||
    (range !== "agent" && range !== "conv" && range !== "all")
  )
    throw new Error("Invalid search mode or range");
  if (localSearch && mode !== "fts")
    throw new Error("The local backend supports full-text search only");
  return { query: request.query.trim(), mode, range };
}

export async function runAttachedInspectionCommand(
  commandId: "search" | "mcp",
  args: string,
  scope: AgentRuntimeScope,
  deps: AttachedInspectionDeps = defaultDeps(),
): Promise<string> {
  if (commandId === "search") {
    const request = searchOptions(args, deps.localSearch);
    const body: Record<string, unknown> = {
      query: request.query,
      search_mode: request.mode,
      limit: 100,
    };
    if (request.range !== "all") body.agent_id = scope.agent_id;
    if (request.range === "conv") body.conversation_id = scope.conversation_id;
    let results: MessageSearchResponse;
    try {
      results = await deps.search(body);
    } catch {
      throw new Error("Message search failed on the app server");
    }
    if (!Array.isArray(results))
      throw new Error("Message search returned an invalid response");
    const lines = results.slice(0, 100).map((item) => {
      const content = contentText(
        "content" in item ? item.content : item.reasoning,
      ).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
      return `${display(item.message_type ?? "message", 40)} | ${display(item.created_at, 40)} | ${display(item.conversation_id ?? "unknown", 100)} | ${display(content)}`;
    });
    return [
      `Search: ${request.mode}, ${request.range}; ${results.length} result(s) (maximum 100).`,
      ...(lines.length ? lines : ["No results."]),
    ].join("\n");
  }
  if (args.trim())
    throw new Error("Attached MCP inspection does not accept arguments");
  const local = deps.localServers(scope.agent_id);
  const lines = [
    "Agent-local configured MCP servers (cached settings may be stale; runtime state is observed only in this process):",
  ];
  for (const server of local.slice(0, 100))
    lines.push(`${display(server.name, 120)} — ${server.status}`);
  if (!local.length)
    lines.push("None configured in this process's agent settings.");
  if (local.length > 100) lines.push(`${local.length - 100} more omitted.`);
  if (deps.registeredServers) {
    try {
      const names = await deps.registeredServers();
      lines.push(
        "Letta-server registrations (registration does not imply connection or agent attachment):",
      );
      for (const name of names.slice(0, 100)) lines.push(display(name, 120));
      if (!names.length) lines.push("None registered.");
      if (names.length > 100) lines.push(`${names.length - 100} more omitted.`);
    } catch {
      lines.push("Letta-server registrations could not be read.");
    }
  } else
    lines.push(
      "Server-side registrations are not supported by the active backend.",
    );
  return lines.join("\n");
}
