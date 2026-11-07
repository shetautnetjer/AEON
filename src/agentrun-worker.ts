/** Public harness-owned worker adapter. This is never installed as a mod tool. */
import { realpathSync, statSync } from "node:fs";
import type { RuntimePermissionMode } from "@/runtime-context";
import { loadAgentSdk } from "@/tools/workflow/sdk-loader";
import { createSdkSpawner } from "@/tools/workflow/sdk-spawner";
import type { SdkClient, SubagentOutcome } from "@/tools/workflow/types";

export interface AgentRunWorkerConfig {
  parentAgentId: string;
  model: string;
  cwd: string;
  allowedTools: string[];
  timeoutMs: number;
  maxToolCalls: number;
  maxConcurrent: 1;
  /** This adapter enforces wall-clock/tool-call bounds, not a native turn cap. */
  maxTurns?: never;
  backend: "local";
  backendDir: string;
  permissionMode: RuntimePermissionMode;
  stopSettlementTimeoutMs?: number;
}

export interface AgentRunWorkerRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  label?: string;
  signal: AbortSignal;
  tools?: string[];
  budgetUsd?: number;
  context?: { fork?: boolean };
  effort?: unknown;
  thinking?: unknown;
  tier?: unknown;
  step?: { sessionId: string; attempt: number; earlierSessionIds: string[] };
  /** Native recovery evidence callback; it never selects a conversation. */
  call?: (record: unknown) => void;
}

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, final: true });
}

/** One worker at a time; callers retain the native journal and its run key. */
export async function createAgentRunWorkerHost(
  config: AgentRunWorkerConfig,
  deps: { client?: SdkClient } = {},
) {
  if (!config.parentAgentId?.trim() || !config.model?.trim())
    throw failure(
      "AEON_WORKER_CONFIG",
      "Explicit parent identity and model are required",
    );
  if (
    config.backend !== "local" ||
    config.maxConcurrent !== 1 ||
    config.maxTurns !== undefined ||
    !["standard", "acceptEdits", "unrestricted", "strict"].includes(
      config.permissionMode,
    )
  )
    throw failure(
      "AEON_WORKER_CONFIG",
      "Explicit backend and permission mode are required",
    );
  for (const value of [
    config.timeoutMs,
    config.maxToolCalls,
    config.stopSettlementTimeoutMs ?? 5_000,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw failure(
        "AEON_WORKER_CONFIG",
        "Worker limits must be positive integers",
      );
  }
  if (
    !Array.isArray(config.allowedTools) ||
    config.allowedTools.some((tool) => typeof tool !== "string" || !tool.trim())
  )
    throw failure(
      "AEON_WORKER_CONFIG",
      "An explicit tool selection is required",
    );
  const resolveBound = (path: string, name: string) => {
    try {
      return realpathSync(path);
    } catch {
      throw failure("AEON_WORKER_CONFIG", `${name} cannot be resolved`);
    }
  };
  const cwd = resolveBound(config.cwd, "cwd");
  if (!statSync(cwd).isDirectory())
    throw failure("AEON_WORKER_CONFIG", "Worker cwd must be a directory");
  const backendDir = resolveBound(config.backendDir, "backendDir");
  const routePath = (key: string) =>
    process.env[key] ? resolveBound(process.env[key], key) : null;
  const cliPath = routePath("LETTA_CLI_PATH"),
    sdkPath = routePath("LETTA_AGENT_SDK_PATH");
  const assertBackend = () => {
    if (
      !process.env.LETTA_LOCAL_BACKEND_DIR ||
      resolveBound(
        process.env.LETTA_LOCAL_BACKEND_DIR,
        "LETTA_LOCAL_BACKEND_DIR",
      ) !== backendDir
    )
      throw failure(
        "AEON_WORKER_CONFIG",
        "LETTA_LOCAL_BACKEND_DIR must match the explicit backendDir",
      );
    if (
      routePath("LETTA_CLI_PATH") !== cliPath ||
      routePath("LETTA_AGENT_SDK_PATH") !== sdkPath
    )
      throw failure(
        "AEON_WORKER_CONFIG",
        "The bound native CLI/SDK route changed",
      );
  };
  assertBackend();
  const binding = Object.freeze({
    parentAgentId: config.parentAgentId,
    model: config.model,
    cwd,
    allowedTools: Object.freeze([...new Set(config.allowedTools)].sort()),
    timeoutMs: config.timeoutMs,
    maxToolCalls: config.maxToolCalls,
    stopSettlementTimeoutMs: config.stopSettlementTimeoutMs ?? 5_000,
    backend: config.backend,
    permissionMode: config.permissionMode,
    backendDir,
    maxConcurrent: config.maxConcurrent,
    cliPath,
    sdkPath,
    resultTransport: "json",
  });
  const client =
    deps.client ?? (await loadAgentSdk()).createLocalClient(binding.backend);
  const spawn = createSdkSpawner(client, {
    ...binding,
    allowedTools: [...binding.allowedTools],
    verifyPersistedRuns: false,
    // Recovery is through the effect's retained result, not another prompt.
    supportsAgentFreeResume: false,
  });
  let active = false,
    closed = false,
    uncertain = false,
    callIndex = 0;
  const shutdown = new AbortController();
  let activeDone: Promise<void> | undefined;
  return {
    workerBinding: binding,
    async runAgent(request: AgentRunWorkerRequest): Promise<unknown> {
      if (closed || active || uncertain)
        throw failure(
          "AEON_WORKER_STATE",
          "Host is closed, occupied, or awaiting cleanup reconciliation",
        );
      assertBackend();
      if (
        !request.step?.sessionId ||
        !request.signal ||
        typeof request.user !== "string" ||
        typeof request.system !== "string" ||
        !request.schema
      )
        throw failure(
          "AEON_WORKER_REQUEST",
          "A native step, signal, prompt and result schema are required",
        );
      if (
        request.context?.fork ||
        request.budgetUsd !== undefined ||
        request.effort !== undefined ||
        request.thinking !== undefined ||
        request.tier !== undefined
      )
        throw failure(
          "AEON_WORKER_POLICY",
          "This host cannot enforce the requested fork, money, or reasoning policy",
        );
      const tools = request.tools ?? [...binding.allowedTools];
      if (tools.some((tool) => !binding.allowedTools.includes(tool)))
        throw failure(
          "AEON_WORKER_POLICY",
          "Requested tools exceed the configured worker selection",
        );
      if (request.signal.aborted)
        throw failure(
          "AEON_WORKER_CANCELLED",
          "Worker request was already cancelled",
        );
      active = true;
      let settled!: () => void;
      activeDone = new Promise((resolve) => {
        settled = resolve;
      });
      try {
        const result: SubagentOutcome = await spawn(
          {
            prompt: request.user,
            callIndex: callIndex++,
            options: {
              label: request.label,
              // SDK 0.8.38 portable structured output repairs an interrupted
              // turn. Keep cancellation native; AgentRun validates the parsed
              // candidate against this schema after runNode, including replay.
              json: true,
              systemPrompt: `${request.system}\n\nReturn only a JSON value matching this schema:\n${JSON.stringify(request.schema)}`,
              allowedTools: tools,
              timeoutMs: binding.timeoutMs,
              maxToolCalls: binding.maxToolCalls,
            },
          },
          AbortSignal.any([request.signal, shutdown.signal]),
          {
            onStarted: (conversationId) =>
              request.call?.({ outcome: "unknown", conversationId }),
          },
        );
        uncertain ||= result.cleanupUnconfirmed === true;
        request.call?.({
          outcome: result.cleanupUnconfirmed
            ? "unknown"
            : result.failed
              ? "failed"
              : "applied",
          conversationId: result.conversationId ?? null,
          totalTokens: result.totalTokens ?? null,
        });
        if (result.failed)
          throw failure(
            result.cleanupUnconfirmed
              ? "AEON_WORKER_CLEANUP_UNCONFIRMED"
              : "AEON_WORKER_FAILED",
            result.error ?? "Worker failed",
          );
        return result.value;
      } finally {
        active = false;
        settled();
      }
    },
    async close(): Promise<void> {
      closed = true;
      shutdown.abort();
      await activeDone;
      await client[Symbol.asyncDispose]?.();
      if (uncertain)
        throw failure(
          "AEON_WORKER_CLEANUP_UNCONFIRMED",
          "Worker terminal settlement remains unknown",
        );
    },
  };
}
