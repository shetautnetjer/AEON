import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunWorkerConfig,
  type AgentRunWorkerRequest,
  createAgentRunWorkerHost,
} from "./agentrun-worker";
import type { SdkClient, SdkQuery } from "./tools/workflow/types";

const dirs: string[] = [];
const originalBackend = process.env.LETTA_LOCAL_BACKEND_DIR;
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  if (originalBackend === undefined) delete process.env.LETTA_LOCAL_BACKEND_DIR;
  else process.env.LETTA_LOCAL_BACKEND_DIR = originalBackend;
});
function config(): AgentRunWorkerConfig {
  const cwd = mkdtempSync(join(tmpdir(), "aeon-agentrun-"));
  dirs.push(cwd);
  process.env.LETTA_LOCAL_BACKEND_DIR = cwd;
  return {
    cwd,
    backendDir: cwd,
    backend: "local",
    parentAgentId: "parent",
    model: "fixture",
    allowedTools: ["Read"],
    timeoutMs: 1000,
    maxToolCalls: 2,
    maxConcurrent: 1,
    permissionMode: "strict",
    stopSettlementTimeoutMs: 20,
  };
}
function request(): AgentRunWorkerRequest {
  return {
    user: "inspect",
    system: "instructions",
    schema: { type: "object" },
    signal: new AbortController().signal,
    step: { sessionId: "logical:step:a1", attempt: 1, earlierSessionIds: [] },
  };
}

test("host binds authority, passes native options, and never resumes the logical DSL session", async () => {
  const conf = config();
  let received: Parameters<SdkClient["query"]>[0] | undefined;
  const calls: unknown[] = [];
  let disposed = false;
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query(params) {
        received = params;
        return {
          conversationId: "native-conversation",
          agentId: null,
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              success: true,
              structuredOutput: { ok: true },
            };
          },
          async interrupt() {},
          close() {},
        };
      },
      async [Symbol.asyncDispose]() {
        disposed = true;
      },
    },
  });
  expect(
    await host.runAgent({ ...request(), call: (record) => calls.push(record) }),
  ).toEqual({ ok: true });
  expect(received?.options.conversationId).toBeUndefined();
  expect(received?.options.cwd).toBe(conf.cwd);
  expect(received?.options.allowedTools).toEqual(["Read"]);
  expect(host.workerBinding.maxConcurrent).toBe(1);
  expect(host.workerBinding.backendDir).toBe(conf.cwd);
  expect(Object.isFrozen(host.workerBinding.allowedTools)).toBe(true);
  expect(calls).toContainEqual({
    outcome: "applied",
    conversationId: "native-conversation",
    totalTokens: null,
  });
  await host.close();
  expect(disposed).toBe(true);
});

test("host refuses unsupported policy and authority changes before dispatch", async () => {
  const conf = config();
  let queries = 0;
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query() {
        queries++;
        throw new Error("must not dispatch");
      },
    },
  });
  for (const changed of [
    { tools: ["Bash"] },
    { context: { fork: true } },
    { budgetUsd: 1 },
  ]) {
    await expect(
      host.runAgent({ ...request(), ...changed }),
    ).rejects.toMatchObject({ code: "AEON_WORKER_POLICY" });
  }
  const controller = new AbortController();
  controller.abort();
  await expect(
    host.runAgent({ ...request(), signal: controller.signal }),
  ).rejects.toMatchObject({ code: "AEON_WORKER_CANCELLED" });
  delete process.env.LETTA_LOCAL_BACKEND_DIR;
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_CONFIG",
  });
  expect(queries).toBe(0);
  await host.close();
});

test("close stops admission, aborts the active worker and waits for native settlement", async () => {
  const conf = config();
  let release!: () => void,
    interrupts = 0,
    disposed = false;
  const terminal = new Promise<void>((r) => {
    release = r;
  });
  const query: SdkQuery = {
    conversationId: "native",
    agentId: null,
    async *[Symbol.asyncIterator]() {
      yield { type: "assistant", content: "started" };
      await terminal;
      yield { type: "result", success: false, error: "cancelled" };
    },
    async interrupt() {
      interrupts++;
    },
    close() {},
  };
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query: () => query,
      async [Symbol.asyncDispose]() {
        disposed = true;
      },
    },
  });
  const running = host.runAgent(request()).catch((e) => e);
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_STATE",
  });
  const closing = host.close();
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_STATE",
  });
  expect(disposed).toBe(false);
  release();
  await closing;
  expect(await running).toMatchObject({ code: "AEON_WORKER_FAILED" });
  expect(interrupts).toBeGreaterThan(0);
  expect(disposed).toBe(true);
});

test("unknown cleanup holds host reuse and is reported after disposal", async () => {
  const conf = config();
  let queries = 0;
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query() {
        queries++;
        return {
          conversationId: "native",
          agentId: null,
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              success: false,
              errorCode: "stream_closed",
            };
          },
          async interrupt() {},
          close() {},
        };
      },
    },
  });
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_CLEANUP_UNCONFIRMED",
  });
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_STATE",
  });
  await expect(host.close()).rejects.toMatchObject({
    code: "AEON_WORKER_CLEANUP_UNCONFIRMED",
  });
  expect(queries).toBe(1);
});
