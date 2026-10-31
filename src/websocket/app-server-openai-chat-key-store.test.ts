import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend } from "@/backend";
import { __testSetBackend } from "@/backend";
import {
  __testChatKeyStoreSize,
  __testClearChatKeyStore,
  __testResetChatKeyStoreForReload,
  flushChatKeyStore,
  getChatKeyConversation,
  getChatKeyStorePath,
  isChatKeyUnverified,
  MAX_TRACKED_CHAT_KEYS,
  setChatKeyConversation,
} from "@/websocket/app-server-openai-chat-key-store";
import { resolveConversationId } from "@/websocket/app-server-openai-common";

const ENV_KEY = "LETTA_LOCAL_BACKEND_DIR";

describe("OpenAI chat-key store persistence", () => {
  let dir: string;
  let originalDir: string | undefined;

  beforeEach(() => {
    originalDir = process.env[ENV_KEY];
    dir = mkdtempSync(join(tmpdir(), "chat-key-store-"));
    process.env[ENV_KEY] = dir;
    __testResetChatKeyStoreForReload();
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    __testClearChatKeyStore();
    __testSetBackend(null);
    if (originalDir === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test("persists chat-key entries and reloads them after a restart", async () => {
    setChatKeyConversation("chat-key:agent-1:a", "conv-a");
    setChatKeyConversation("chat-key:agent-1:b", "conv-b");
    await flushChatKeyStore();

    const path = getChatKeyStorePath();
    expect(path).toBe(join(dir, "openai-chat-keys.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);

    __testResetChatKeyStoreForReload();
    expect(getChatKeyConversation("chat-key:agent-1:a")).toBe("conv-a");
    expect(getChatKeyConversation("chat-key:agent-1:b")).toBe("conv-b");
  });

  test("flushes automatically shortly after a change", async () => {
    setChatKeyConversation("chat-key:agent-1:auto", "conv-auto");
    const path = getChatKeyStorePath();
    const deadline = Date.now() + 1500;
    while (!existsSync(path) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("conv-auto");
  });

  test("does not persist non chat-key entries", async () => {
    setChatKeyConversation("transcript:abc", "conv-t");
    setChatKeyConversation("chat-key:agent-1:a", "conv-a");
    await flushChatKeyStore();
    const raw = readFileSync(getChatKeyStorePath(), "utf8");
    expect(raw).not.toContain("transcript:abc");
    expect(getChatKeyConversation("transcript:abc")).toBe("conv-t");

    __testResetChatKeyStoreForReload();
    expect(getChatKeyConversation("transcript:abc")).toBeUndefined();
    expect(getChatKeyConversation("chat-key:agent-1:a")).toBe("conv-a");
  });

  test("corrupt file starts empty without throwing", () => {
    writeFileSync(getChatKeyStorePath(), "{not json", { mode: 0o600 });
    __testResetChatKeyStoreForReload();
    expect(getChatKeyConversation("chat-key:agent-1:a")).toBeUndefined();
    expect(__testChatKeyStoreSize()).toBe(0);
  });

  test("drops invalid entries on load", () => {
    writeFileSync(
      getChatKeyStorePath(),
      JSON.stringify({
        version: 1,
        entries: [
          ["chat-key:agent-1:ok", "conv-ok"],
          ["transcript:x", "conv-x"],
          ["chat-key:agent-1:num", 42],
          [7, "conv-7"],
          "garbage",
        ],
      }),
    );
    __testResetChatKeyStoreForReload();
    expect(__testChatKeyStoreSize()).toBe(1);
    expect(getChatKeyConversation("chat-key:agent-1:ok")).toBe("conv-ok");
  });

  test("enforces the FIFO bound on disk", async () => {
    const total = MAX_TRACKED_CHAT_KEYS + 5;
    for (let i = 0; i < total; i++) {
      setChatKeyConversation(`chat-key:agent-1:${i}`, `conv-${i}`);
    }
    // Re-remembering moves an entry to the tail (protects it from eviction).
    setChatKeyConversation("chat-key:agent-1:10", "conv-10");
    setChatKeyConversation("chat-key:agent-1:new", "conv-new");
    await flushChatKeyStore();

    const parsed = JSON.parse(readFileSync(getChatKeyStorePath(), "utf8")) as {
      entries: Array<[string, string]>;
    };
    expect(parsed.entries.length).toBe(MAX_TRACKED_CHAT_KEYS);
    expect(parsed.entries.at(-1)).toEqual(["chat-key:agent-1:new", "conv-new"]);
    expect(parsed.entries.at(-2)).toEqual(["chat-key:agent-1:10", "conv-10"]);

    __testResetChatKeyStoreForReload();
    expect(__testChatKeyStoreSize()).toBe(MAX_TRACKED_CHAT_KEYS);
    expect(getChatKeyConversation("chat-key:agent-1:0")).toBeUndefined();
    // 0..4 evicted by the fill, 5 by the final insert; 6 is now oldest.
    expect(getChatKeyConversation("chat-key:agent-1:5")).toBeUndefined();
    expect(getChatKeyConversation("chat-key:agent-1:6")).toBe("conv-6");
    expect(getChatKeyConversation("chat-key:agent-1:10")).toBe("conv-10");
    expect(getChatKeyConversation(`chat-key:agent-1:${total - 1}`)).toBe(
      `conv-${total - 1}`,
    );
  });

  test("restored mapping is reused when the conversation still exists", async () => {
    setChatKeyConversation("chat-key:agent-1:a", "conv-live");
    await flushChatKeyStore();
    __testResetChatKeyStoreForReload();

    const created: string[] = [];
    __testSetBackend({
      retrieveConversation: async (id: string) => ({ id }),
      createConversation: async () => {
        created.push("x");
        return { id: "conv-new" };
      },
    } as unknown as Backend);

    expect(await resolveConversationId("agent-1", "chat-key:agent-1:a")).toBe(
      "conv-live",
    );
    expect(created).toEqual([]);
  });

  test("stale restored mapping falls back to a new conversation", async () => {
    setChatKeyConversation("chat-key:agent-1:a", "conv-gone");
    await flushChatKeyStore();
    __testResetChatKeyStoreForReload();

    __testSetBackend({
      retrieveConversation: async (id: string) => {
        const error = new Error(`Conversation ${id} not found`);
        error.name = "LocalBackendNotFoundError";
        throw error;
      },
      createConversation: async () => ({ id: "conv-fresh" }),
    } as unknown as Backend);

    expect(await resolveConversationId("agent-1", "chat-key:agent-1:a")).toBe(
      "conv-fresh",
    );
  });
  test("failed write stays dirty and the next flush retries", async () => {
    setChatKeyConversation("chat-key:agent-1:a", "conv-a");
    chmodSync(dir, 0o500);
    await flushChatKeyStore();
    const path = getChatKeyStorePath();
    expect(existsSync(path)).toBe(false);

    chmodSync(dir, 0o700);
    await flushChatKeyStore();
    expect(readFileSync(path, "utf8")).toContain("conv-a");
  });

  test("transient retrieve failure keeps the restored mapping unverified", async () => {
    setChatKeyConversation("chat-key:agent-1:a", "conv-live");
    await flushChatKeyStore();
    __testResetChatKeyStoreForReload();

    let failRetrieve = true;
    let retrieves = 0;
    const created: string[] = [];
    __testSetBackend({
      retrieveConversation: async (id: string) => {
        retrieves++;
        if (failRetrieve) {
          const error = new Error("Service Unavailable") as Error & {
            status: number;
          };
          error.status = 503;
          throw error;
        }
        return { id };
      },
      createConversation: async () => {
        created.push("x");
        return { id: "conv-new" };
      },
    } as unknown as Backend);

    const key = "chat-key:agent-1:a";
    expect(await resolveConversationId("agent-1", key)).toBe("conv-live");
    expect(isChatKeyUnverified(key)).toBe(true);

    failRetrieve = false;
    expect(await resolveConversationId("agent-1", key)).toBe("conv-live");
    expect(isChatKeyUnverified(key)).toBe(false);
    expect(retrieves).toBe(2);
    expect(created).toEqual([]);
  });

  test("concurrent requests for a new key share one conversation", async () => {
    let n = 0;
    __testSetBackend({
      retrieveConversation: async (id: string) => ({ id }),
      createConversation: async () => {
        n++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { id: `conv-${n}` };
      },
    } as unknown as Backend);

    const key = "chat-key:agent-1:new";
    const [a, b] = await Promise.all([
      resolveConversationId("agent-1", key),
      resolveConversationId("agent-1", key),
    ]);
    expect(a).toBe("conv-1");
    expect(b).toBe("conv-1");
    expect(n).toBe(1);
    expect(getChatKeyConversation(key)).toBe("conv-1");
    expect(isChatKeyUnverified(key)).toBe(false);
  });
});
