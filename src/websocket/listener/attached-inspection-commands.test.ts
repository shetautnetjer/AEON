import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageSearchResponse } from "@letta-ai/letta-client/resources/messages";
import { LocalBackend } from "@/backend/local";
import {
  LOCAL_TRANSCRIPT_LEGACY_MESSAGE_FORMAT,
  LOCAL_TRANSCRIPT_LEGACY_SCHEMA_VERSION,
  LOCAL_TRANSCRIPT_PROVIDER_STACK,
} from "@/backend/local/local-transcript";
import { searchMessagesForBackend } from "@/backend/message-search";
import {
  type AttachedInspectionDeps,
  runAttachedInspectionCommand,
} from "./attached-inspection-commands";

const scope = { agent_id: "aya", conversation_id: "current" };
function fixture() {
  const calls: Record<string, unknown>[] = [];
  const deps: AttachedInspectionDeps = {
    localSearch: true,
    search: async (body) => {
      calls.push(body);
      return [
        {
          message_type: "user_message",
          message_id: "id",
          created_at: "today",
          agent_id: "aya",
          conversation_id: "older",
          content: "found from older conversation",
        },
      ] as MessageSearchResponse;
    },
    localServers: () => [
      { name: "swan", status: "not observed" },
      { name: "jetbrains", status: "connected" },
    ],
    registeredServers: null,
  };
  return { calls, deps };
}

describe("attached inspection server commands", () => {
  test("search bridge finds prior conversations through the real isolated local backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "attached-inspection-"));
    try {
      const directory = join(root, "conversations", "older");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "conversation.json"),
        JSON.stringify({ id: "older", agent_id: "aya" }),
      );
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({
          schema_version: LOCAL_TRANSCRIPT_LEGACY_SCHEMA_VERSION,
          message_format: LOCAL_TRANSCRIPT_LEGACY_MESSAGE_FORMAT,
          provider_stack: LOCAL_TRANSCRIPT_PROVIDER_STACK,
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      );
      await writeFile(
        join(directory, "messages.jsonl"),
        `${JSON.stringify({ id: "found", role: "user", content: "needle from an older conversation", timestamp: 1 })}\n`,
      );
      const backend = new LocalBackend({
        storageDir: root,
        executionMode: "deterministic",
        memfsEnabled: false,
      });
      const { deps } = fixture();
      deps.search = (body) =>
        searchMessagesForBackend<MessageSearchResponse>(body, backend);
      const output = await runAttachedInspectionCommand(
        "search",
        "needle",
        scope,
        deps,
      );
      expect(output).toContain("needle from an older conversation");
      expect(output).toContain("older");
      const currentOnly = await runAttachedInspectionCommand(
        "search",
        JSON.stringify({ query: "needle", range: "conv" }),
        scope,
        deps,
      );
      expect(currentOnly).toContain("No results.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("native default searches all current agent transcripts using local FTS", async () => {
    const { calls, deps } = fixture();
    const output = await runAttachedInspectionCommand(
      "search",
      "  earlier work  ",
      scope,
      deps,
    );
    expect(calls).toEqual([
      {
        query: "earlier work",
        search_mode: "fts",
        limit: 100,
        agent_id: "aya",
      },
    ]);
    expect(output).toContain("older");
    expect(output).toContain("found from older conversation");
    await runAttachedInspectionCommand(
      "search",
      '{"literal":"query"}',
      scope,
      deps,
    );
    expect(calls[1]?.query).toBe('{"literal":"query"}');
  });

  test("conversation and all-agent ranges use the runtime scope, not an injected conversation ID", async () => {
    const { calls, deps } = fixture();
    await runAttachedInspectionCommand(
      "search",
      JSON.stringify({ query: "q", range: "conv", conversationId: "other" }),
      scope,
      deps,
    );
    await runAttachedInspectionCommand(
      "search",
      JSON.stringify({ query: "q", range: "all" }),
      scope,
      deps,
    );
    expect(calls[0]).toEqual({
      query: "q",
      search_mode: "fts",
      limit: 100,
      agent_id: "aya",
      conversation_id: "current",
    });
    expect(calls[1]).toEqual({ query: "q", search_mode: "fts", limit: 100 });
    await expect(
      runAttachedInspectionCommand(
        "search",
        JSON.stringify({ query: "q", mode: "hybrid" }),
        scope,
        deps,
      ),
    ).rejects.toThrow("full-text search only");
  });

  test("remote mode uses hybrid and failures never expose provider error bodies", async () => {
    const { calls, deps } = fixture();
    deps.localSearch = false;
    await runAttachedInspectionCommand("search", "hello", scope, deps);
    expect(calls[0]?.search_mode).toBe("hybrid");
    deps.search = async () => {
      throw new Error("credential=secret");
    };
    await expect(
      runAttachedInspectionCommand("search", "hello", scope, deps),
    ).rejects.toThrow("Message search failed on the app server");
  });

  test("MCP inspection reports only names and qualified status, not values or server errors", async () => {
    const { deps } = fixture();
    deps.localServers = () => [
      {
        name: "swan",
        status: "not observed",
        env: { TOKEN: "secret" },
        url: "https://user:secret@example",
      } as ReturnType<AttachedInspectionDeps["localServers"]>[number],
    ];
    deps.registeredServers = async () => {
      throw new Error("secret response");
    };
    const output = await runAttachedInspectionCommand("mcp", "", scope, deps);
    expect(output).toContain("swan — not observed");
    expect(output).toContain("could not be read");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("https://");
  });
});
