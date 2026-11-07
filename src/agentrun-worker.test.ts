import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunWorkerConfig,
  type AgentRunWorkerRequest,
  createAgentRunWorkerHost,
} from "./agentrun-worker";
import type { SdkClient, SdkQuery } from "./tools/workflow/types";

const dirs: string[] = [];
const routeKeys = [
  "LETTA_LOCAL_BACKEND_DIR",
  "LETTA_CLI_PATH",
  "LETTA_AGENT_SDK_PATH",
] as const;
const originalRoutes = routeKeys.map((key) => process.env[key]);
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  routeKeys.forEach((key, index) => {
    if (originalRoutes[index] === undefined) delete process.env[key];
    else process.env[key] = originalRoutes[index];
  });
});
function config(): AgentRunWorkerConfig {
  const cwd = mkdtempSync(join(tmpdir(), "aeon-agentrun-"));
  dirs.push(cwd);
  process.env.LETTA_LOCAL_BACKEND_DIR = cwd;
  delete process.env.LETTA_CLI_PATH;
  delete process.env.LETTA_AGENT_SDK_PATH;
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

for (const key of routeKeys) {
  test(`missing ${key} path is a final configuration failure before dispatch`, async () => {
    const conf = config();
    process.env[key] = join(conf.cwd, "missing");
    let queries = 0;
    await expect(
      createAgentRunWorkerHost(conf, {
        client: {
          query() {
            queries++;
            throw new Error("must not dispatch");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "AEON_WORKER_CONFIG", final: true });
    expect(queries).toBe(0);
  });

  test(`removed ${key} path is a final configuration failure on recheck`, async () => {
    const conf = config();
    const bound =
      key === "LETTA_LOCAL_BACKEND_DIR" ? conf.backendDir : join(conf.cwd, key);
    if (bound !== conf.backendDir) mkdirSync(bound);
    process.env[key] = bound;
    let queries = 0;
    const host = await createAgentRunWorkerHost(conf, {
      client: {
        query() {
          queries++;
          throw new Error("must not dispatch");
        },
      },
    });
    rmSync(bound, { recursive: true });
    await expect(host.runAgent(request())).rejects.toMatchObject({
      code: "AEON_WORKER_CONFIG",
      final: true,
    });
    expect(queries).toBe(0);
    await host.close();
  });
}

test("unset optional CLI and SDK routes remain null and cannot be added after binding", async () => {
  const conf = config();
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query() {
        throw new Error("must not dispatch");
      },
    },
  });
  expect(host.workerBinding.cliPath).toBeNull();
  expect(host.workerBinding.sdkPath).toBeNull();
  for (const key of routeKeys.slice(1)) {
    process.env[key] = conf.cwd;
    await expect(host.runAgent(request())).rejects.toMatchObject({
      code: "AEON_WORKER_CONFIG",
      final: true,
    });
    delete process.env[key];
  }
  await host.close();
});

test.each(["cwd", "backendDir"] as const)(
  "missing explicit %s is a final configuration failure",
  async (key) => {
    const conf = config();
    conf[key] = join(conf.cwd, "missing");
    await expect(
      createAgentRunWorkerHost(conf, {
        client: {
          query() {
            throw new Error("must not dispatch");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "AEON_WORKER_CONFIG", final: true });
  },
);

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
              result: '{"ok":true}',
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
  expect(received?.options.outputFormat).toBeUndefined();
  expect(received?.options.system).toContain(JSON.stringify(request().schema));
  expect(received?.options.cwd).toBe(conf.cwd);
  expect(received?.options.allowedTools).toEqual(["Read"]);
  expect(host.workerBinding.maxConcurrent).toBe(1);
  expect(host.workerBinding.resultTransport).toBe("json");
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

test("AgentRun JSON transport preserves native interruption without SDK schema repair turns", async () => {
  const conf = config(),
    caller = new AbortController();
  let repairTurns = 0,
    queries = 0,
    interrupted!: () => void;
  const stopped = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query(params) {
        queries++;
        return {
          conversationId: "native",
          agentId: null,
          async *[Symbol.asyncIterator]() {
            yield { type: "assistant", content: "started" };
            caller.abort();
            await stopped;
            // Model the installed SDK's portable structured-output branch: it
            // rewrites interrupted and creates repair turns when outputFormat exists.
            if (params.options.outputFormat) {
              repairTurns += 2;
              yield {
                type: "result",
                success: false,
                errorCode: "structured_output_error",
              };
            } else
              yield {
                type: "result",
                success: false,
                errorCode: "interrupted",
              };
          },
          async interrupt() {
            interrupted();
          },
          close() {},
        };
      },
    },
  });
  const evidence: unknown[] = [];
  await expect(
    host.runAgent({
      ...request(),
      signal: caller.signal,
      call: (value) => evidence.push(value),
    }),
  ).rejects.toMatchObject({
    code: "AEON_WORKER_FAILED",
    message: "Workflow subagent interrupted",
  });
  expect(queries).toBe(1);
  expect(repairTurns).toBe(0);
  expect(evidence).toContainEqual({
    outcome: "failed",
    conversationId: "native",
    totalTokens: null,
  });
  await host.close();
});

test("non-JSON worker output fails without a repair query", async () => {
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
            yield { type: "result", success: true, result: "not JSON" };
          },
          async interrupt() {},
          close() {},
        };
      },
    },
  });
  await expect(host.runAgent(request())).rejects.toMatchObject({
    code: "AEON_WORKER_FAILED",
  });
  expect(queries).toBe(1);
  await host.close();
});

test("JSON before a pending native approval cannot complete or permit host reuse", async () => {
  const conf = config();
  let queries = 0;
  const host = await createAgentRunWorkerHost(conf, {
    client: {
      query() {
        queries++;
        return {
          conversationId: "native-pending",
          agentId: null,
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              success: true,
              stopReason: "requires_approval",
              result: '{"ok":true}',
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
