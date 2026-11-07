import { expect, test } from "bun:test";
import { createSdkSpawner } from "./sdk-spawner";
import type { SdkQuery, SdkStreamMessage } from "./types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("abort during lazy SDK startup interrupts again on identity and waits for terminal settlement", async () => {
  const started = deferred(),
    launch = deferred(),
    terminal = deferred();
  const caller = new AbortController();
  let interrupts = 0,
    closed = false,
    observedId: string | undefined;
  let conversationId: string | null = null;
  const query: SdkQuery = {
    get conversationId() {
      return conversationId;
    },
    agentId: null,
    async *[Symbol.asyncIterator]() {
      started.resolve();
      await launch.promise;
      conversationId = "late-worker";
      yield { type: "stream_event", event: { type: "loop_status" } };
      await terminal.promise;
      yield { type: "result", success: true, result: "late success" };
    },
    async interrupt() {
      interrupts++;
    },
    close() {
      closed = true;
    },
  };
  const spawn = createSdkSpawner(
    { query: () => query },
    {
      parentAgentId: "parent",
      model: "fixture",
      stopSettlementTimeoutMs: 1000,
    },
  );
  let settled = false;
  const pending = spawn(
    { prompt: "inspect", options: {}, callIndex: 0 },
    caller.signal,
    {
      onStarted: (id) => {
        observedId = id;
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });
  await started.promise;
  caller.abort();
  expect(interrupts).toBe(1);
  expect(closed).toBe(false);
  launch.resolve();
  await new Promise((r) => setTimeout(r, 10));
  expect(interrupts).toBe(2);
  expect(observedId).toBe("late-worker");
  expect(settled).toBe(false);
  terminal.resolve();
  const outcome = await pending;
  expect(outcome.failed).toBe(true);
  expect(outcome.error).toBe("Workflow subagent interrupted");
  expect(outcome.cleanupUnconfirmed).toBeUndefined();
  expect(outcome.conversationId).toBe("late-worker");
  expect(closed).toBe(true);
});

for (const message of [
  { type: "result", success: false, errorCode: "stream_closed" },
  { type: "result", success: true, error: "stream_closed" },
  { type: "result", result: "missing verdict" },
] satisfies SdkStreamMessage[]) {
  test(`synthetic or malformed result cannot establish settlement: ${JSON.stringify(message)}`, async () => {
    const query: SdkQuery = {
      conversationId: "worker",
      agentId: null,
      async *[Symbol.asyncIterator]() {
        yield message;
      },
      async interrupt() {},
      close() {},
    };
    const spawn = createSdkSpawner(
      { query: () => query },
      { parentAgentId: "parent", model: "fixture" },
    );
    const outcome = await spawn(
      { prompt: "inspect", options: {}, callIndex: 0 },
      new AbortController().signal,
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.cleanupUnconfirmed).toBe(true);
  });
}

test("interrupt acknowledgment without terminal evidence retains partial identity and unknown cleanup", async () => {
  const release = deferred();
  const query: SdkQuery = {
    conversationId: "worker",
    agentId: null,
    async *[Symbol.asyncIterator]() {
      yield { type: "assistant", content: "partial" };
      await release.promise;
    },
    async interrupt() {},
    close() {
      release.resolve();
    },
  };
  const spawn = createSdkSpawner(
    { query: () => query },
    {
      parentAgentId: "parent",
      model: "fixture",
      stopSettlementTimeoutMs: 10,
    },
  );
  const result = await spawn(
    { prompt: "inspect", options: { timeoutMs: 10 }, callIndex: 0 },
    new AbortController().signal,
  );
  expect(result.cleanupUnconfirmed).toBe(true);
  expect(result.conversationId).toBe("worker");
  expect(result.failed).toBe(true);
});
