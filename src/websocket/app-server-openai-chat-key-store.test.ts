import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
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
  __testSetChatKeyPreWriteHook,
  deleteChatKeyConversation,
  flushChatKeyStore,
  getChatKeyConversation,
  getChatKeyStorePath,
  isChatKeyUnverified,
  MAX_TRACKED_CHAT_KEYS,
  setChatKeyConversation,
} from "@/websocket/app-server-openai-chat-key-store";
import { resolveConversationId } from "@/websocket/app-server-openai-common";

const ENV_KEY = "LETTA_LOCAL_BACKEND_DIR";

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function readStoreEntries(path: string): Array<[string, string]> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    entries: Array<[string, string]>;
  };
  return parsed.entries;
}

function writeStoreEntries(
  path: string,
  entries: Array<[string, string]>,
): void {
  writeFileSync(path, JSON.stringify({ version: 1, entries }), {
    mode: 0o600,
  });
}

// Second-process worker: loads the store (before the parent's flush), signals
// readiness, then waits for the go signal so both processes have loaded before
// either one writes. Its pre-write hook marks when it sits inside its own
// read/write critical section.
const WORKER_SOURCE = `
import { existsSync, writeFileSync } from "node:fs";
import {
  __testSetChatKeyPreWriteHook,
  flushChatKeyStore,
  getChatKeyConversation,
  setChatKeyConversation,
} from ${JSON.stringify(join(import.meta.dir, "app-server-openai-chat-key-store.ts"))};

const readyPath = process.env.CHAT_KEY_READY as string;
const goPath = process.env.CHAT_KEY_GO as string;
const insidePath = process.env.CHAT_KEY_INSIDE as string;

getChatKeyConversation("chat-key:warmup");
__testSetChatKeyPreWriteHook(() => {
  writeFileSync(insidePath, "");
});
writeFileSync(readyPath, "");
const deadline = Date.now() + 15_000;
while (!existsSync(goPath)) {
  if (Date.now() > deadline) process.exit(3);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}
setChatKeyConversation("chat-key:agent-2:b", "conv-b");
await flushChatKeyStore();
`;

// Exit-during-flush worker: the pre-write hook fires inside the async write's
// critical section (after the disk read, lock held) and exits the process,
// leaving the flush suspended on an await it can never resume from. The exit
// listener's sync write must then reuse the lock this process still holds.
// The hook is one-shot because the sync write invokes it again inside the
// "exit" handler, where a nested process.exit would be wrong.
const EXIT_WORKER_SOURCE = `
import {
  __testSetChatKeyPreWriteHook,
  flushChatKeyStore,
  setChatKeyConversation,
} from ${JSON.stringify(join(import.meta.dir, "app-server-openai-chat-key-store.ts"))};

let exiting = false;
__testSetChatKeyPreWriteHook(() => {
  if (exiting) return;
  exiting = true;
  process.exit(0);
});
setChatKeyConversation("chat-key:agent-1:exit", "conv-exit");
void flushChatKeyStore();
`;

// Same exit shape, but the hook marks when it sits inside the critical section
// and then busy-waits while holding the lock, so a second process spawned on
// that mark is provably blocked on the lock when the exit write runs.
const EXIT_HOLD_WORKER_SOURCE = `
import { writeFileSync } from "node:fs";
import {
  __testSetChatKeyPreWriteHook,
  flushChatKeyStore,
  setChatKeyConversation,
} from ${JSON.stringify(join(import.meta.dir, "app-server-openai-chat-key-store.ts"))};

let exiting = false;
__testSetChatKeyPreWriteHook(() => {
  if (exiting) return;
  exiting = true;
  writeFileSync(process.env.CHAT_KEY_INSIDE as string, "");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  process.exit(0);
});
setChatKeyConversation("chat-key:agent-1:exit", "conv-exit");
void flushChatKeyStore();
`;

// Second process that waits on the lock while the exiting process holds it,
// then merges its own key on top of whatever the exit write left on disk.
const LATE_WRITER_SOURCE = `
import {
  flushChatKeyStore,
  setChatKeyConversation,
} from ${JSON.stringify(join(import.meta.dir, "app-server-openai-chat-key-store.ts"))};

setChatKeyConversation("chat-key:agent-2:b", "conv-b");
await flushChatKeyStore();
`;

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
  test("failed write keeps changes pending and the next flush retries", async () => {
    // A directory at the store path blocks the rename target everywhere —
    // including as root, where permission bits don't apply.
    const path = getChatKeyStorePath();
    mkdirSync(path);
    setChatKeyConversation("chat-key:agent-1:a", "conv-a");
    await flushChatKeyStore();
    expect(statSync(path).isDirectory()).toBe(true);

    rmdirSync(path);
    await flushChatKeyStore();
    expect(readFileSync(path, "utf8")).toContain("conv-a");
  });

  test("a flush merges keys another process wrote after this one loaded", async () => {
    // Load first; then a second process sharing the storage dir replaces the
    // file with its own snapshot containing only its key.
    expect(__testChatKeyStoreSize()).toBe(0);
    writeStoreEntries(getChatKeyStorePath(), [
      ["chat-key:agent-2:b", "conv-b"],
    ]);

    setChatKeyConversation("chat-key:agent-1:a", "conv-a");
    await flushChatKeyStore();

    expect(readStoreEntries(getChatKeyStorePath())).toEqual([
      ["chat-key:agent-2:b", "conv-b"],
      ["chat-key:agent-1:a", "conv-a"],
    ]);
    // The other process's key is adopted into memory, still unverified.
    expect(getChatKeyConversation("chat-key:agent-2:b")).toBe("conv-b");
    expect(isChatKeyUnverified("chat-key:agent-2:b")).toBe(true);
  });

  test("a delete removes only that key from the merged file", async () => {
    writeStoreEntries(getChatKeyStorePath(), [
      ["chat-key:agent-1:a", "conv-a"],
      ["chat-key:agent-2:b", "conv-b"],
    ]);

    deleteChatKeyConversation("chat-key:agent-1:a");
    await flushChatKeyStore();

    expect(readStoreEntries(getChatKeyStorePath())).toEqual([
      ["chat-key:agent-2:b", "conv-b"],
    ]);
  });

  test("two processes sharing a storage dir merge their chat keys", async () => {
    const workerFile = join(dir, "chat-key-store-worker.ts");
    writeFileSync(workerFile, WORKER_SOURCE, { mode: 0o600 });
    for (let i = 0; i < 5; i++) {
      const sub = join(dir, `iter-${i}`);
      mkdirSync(sub, { recursive: true });
      const readyPath = join(sub, "ready");
      const goPath = join(sub, "go");
      const childInside = join(sub, "child-inside");
      process.env[ENV_KEY] = sub;
      __testResetChatKeyStoreForReload();
      // Pause inside this process's write after the disk read so the child's
      // own read/write either waits on the lock or provably overlaps.
      __testSetChatKeyPreWriteHook(async () => {
        const deadline = Date.now() + 500;
        while (!existsSync(childInside) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      });

      const child = Bun.spawn([process.execPath, workerFile], {
        cwd: join(import.meta.dir, "..", ".."),
        env: {
          ...process.env,
          [ENV_KEY]: sub,
          CHAT_KEY_READY: readyPath,
          CHAT_KEY_GO: goPath,
          CHAT_KEY_INSIDE: childInside,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        await waitForFile(readyPath, 15_000);
        setChatKeyConversation("chat-key:agent-1:a", "conv-a");
        writeFileSync(goPath, "");
        await flushChatKeyStore();
        const exitCode = await Promise.race([
          child.exited,
          new Promise<number>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("child process timed out")),
              20_000,
            ),
          ),
        ]);
        if (exitCode !== 0) {
          throw new Error(
            `worker exited ${exitCode}: ${await new Response(child.stderr).text()}`,
          );
        }
      } finally {
        try {
          child.kill();
        } catch {}
      }

      const entries = new Map(readStoreEntries(getChatKeyStorePath()));
      expect(entries.get("chat-key:agent-1:a")).toBe("conv-a");
      expect(entries.get("chat-key:agent-2:b")).toBe("conv-b");
    }
  });

  test("local eviction does not delete a key only another process wrote", async () => {
    // Another process's key only exists on disk; this process loads it, then
    // evicts it locally under memory pressure from non-persisted keys.
    writeStoreEntries(getChatKeyStorePath(), [
      ["chat-key:agent-2:b", "conv-b"],
      ["chat-key:agent-1:k", "conv-k"],
    ]);
    expect(__testChatKeyStoreSize()).toBe(2);
    for (let i = 0; i < MAX_TRACKED_CHAT_KEYS; i++) {
      setChatKeyConversation(`memory-only-${i}`, `conv-m-${i}`);
    }
    expect(getChatKeyConversation("chat-key:agent-2:b")).toBeUndefined();

    setChatKeyConversation("chat-key:agent-1:n", "conv-n");
    await flushChatKeyStore();

    const entries = new Map(readStoreEntries(getChatKeyStorePath()));
    expect(entries.get("chat-key:agent-2:b")).toBe("conv-b");
    expect(entries.get("chat-key:agent-1:n")).toBe("conv-n");
    // Adopted back into memory from the merged file, still unverified.
    expect(getChatKeyConversation("chat-key:agent-2:b")).toBe("conv-b");
    expect(isChatKeyUnverified("chat-key:agent-2:b")).toBe(true);
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

  test("exit with a suspended flush holding the lock still writes pending keys", async () => {
    const workerFile = join(dir, "chat-key-exit-worker.ts");
    writeFileSync(workerFile, EXIT_WORKER_SOURCE, { mode: 0o600 });
    const startedAt = Date.now();
    const child = Bun.spawn([process.execPath, workerFile], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, [ENV_KEY]: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    let exitCode: number;
    try {
      exitCode = await Promise.race([
        child.exited,
        new Promise<number>((_resolve, reject) =>
          setTimeout(() => reject(new Error("exit worker timed out")), 10_000),
        ),
      ]);
    } finally {
      try {
        child.kill();
      } catch {}
    }
    const elapsedMs = Date.now() - startedAt;
    if (exitCode !== 0) {
      throw new Error(
        `worker exited ${exitCode}: ${await new Response(child.stderr).text()}`,
      );
    }
    // A sync write that tried to re-acquire the lock would eat the full 2 s
    // lock wait against this process's own suspended flush.
    expect(elapsedMs).toBeLessThan(1500);
    const entries = new Map(readStoreEntries(getChatKeyStorePath()));
    expect(entries.get("chat-key:agent-1:exit")).toBe("conv-exit");
  });

  test("a process waiting on the lock merges correctly after the exit write", async () => {
    const exitWorkerFile = join(dir, "chat-key-exit-hold-worker.ts");
    const lateWorkerFile = join(dir, "chat-key-late-worker.ts");
    writeFileSync(exitWorkerFile, EXIT_HOLD_WORKER_SOURCE, { mode: 0o600 });
    writeFileSync(lateWorkerFile, LATE_WRITER_SOURCE, { mode: 0o600 });
    const insidePath = join(dir, "child-inside");
    const exiting = Bun.spawn([process.execPath, exitWorkerFile], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, [ENV_KEY]: dir, CHAT_KEY_INSIDE: insidePath },
      stdout: "pipe",
      stderr: "pipe",
    });
    let late: ReturnType<typeof Bun.spawn> | undefined;
    try {
      // The exiting worker is now inside its critical section holding the
      // lock for ~800 ms, so the late worker is forced to wait on it.
      await waitForFile(insidePath, 15_000);
      const lateProc = Bun.spawn([process.execPath, lateWorkerFile], {
        cwd: join(import.meta.dir, "..", ".."),
        env: { ...process.env, [ENV_KEY]: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      late = lateProc;
      const lateStderr = new Response(lateProc.stderr).text();
      const exitCode = await Promise.race([
        exiting.exited,
        new Promise<number>((_resolve, reject) =>
          setTimeout(() => reject(new Error("exit worker timed out")), 10_000),
        ),
      ]);
      if (exitCode !== 0) {
        throw new Error(
          `exit worker exited ${exitCode}: ${await new Response(exiting.stderr).text()}`,
        );
      }
      const lateCode = await Promise.race([
        late.exited,
        new Promise<number>((_resolve, reject) =>
          setTimeout(() => reject(new Error("late worker timed out")), 10_000),
        ),
      ]);
      if (lateCode !== 0) {
        throw new Error(`late worker exited ${lateCode}: ${await lateStderr}`);
      }
    } finally {
      try {
        exiting.kill();
      } catch {}
      try {
        late?.kill();
      } catch {}
    }
    const entries = new Map(readStoreEntries(getChatKeyStorePath()));
    expect(entries.get("chat-key:agent-1:exit")).toBe("conv-exit");
    expect(entries.get("chat-key:agent-2:b")).toBe("conv-b");
  });
});
