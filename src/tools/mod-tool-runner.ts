import { AsyncLocalStorage } from "node:async_hooks";
import { INTERRUPTED_BY_USER } from "@/constants";
import type {
  ModToolCallResult,
  ModToolInfo,
  ModToolsHandle,
} from "@/mods/types";
import type { PermissionDecision } from "@/permissions/types";
import { createLinkedAbortSignal } from "@/utils/linked-abort-signal";
import type { ClientTool } from "./external-tool-types";
import { getServerToolName } from "./tool-name-mapping";

/** Longest chain of mod tools that may each be running `ctx.tools.run`. */
export const MAX_MOD_TOOL_CALL_DEPTH = 3;

// Interactive question tools need a model-issued tool call to answer.
// Agent-spawning and orchestration tools are excluded for the same reason
// the Workflow script scope excludes them (see SCRIPT_EXCLUDED_TOOLS):
// a mod tool should not start unbounded agents or nested workflows.
// Skill delivers its instructions through a side channel keyed by the model's
// toolCallId; a nested call has none, so it would report success while the
// skill content is silently dropped.
const NON_RUNNABLE_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "AskUserQuestionAsync",
  "Skill",
  "Agent",
  "Task",
  "SendAgentMessage",
  "Workflow",
  "CodeMode",
]);

// Mod tools currently running nested calls, outermost first.
const modToolCallChain = new AsyncLocalStorage<readonly string[]>();

type ToolReturn = string | ReadonlyArray<{ type?: unknown; text?: unknown }>;

export interface ModToolsHandleDeps {
  /** Name of the mod tool that receives this handle. */
  callerToolName: string;
  /** The calling mod tool's cancellation signal. */
  signal: AbortSignal;
  /** Model-facing tools of the current turn. */
  listTools: () => ClientTool[];
  checkPermission: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    decision: PermissionDecision;
    matchedRule?: string;
    reason?: string;
  }>;
  execute: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<{ status: "success" | "error"; toolReturn: ToolReturn }>;
}

function errorResult(output: string): ModToolCallResult {
  return { status: "error", output };
}

function toText(toolReturn: ToolReturn): string {
  if (typeof toolReturn === "string") return toolReturn;
  return toolReturn
    .map((part) =>
      part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

function abortedPromise(signal: AbortSignal): {
  promise: Promise<ModToolCallResult>;
  cleanup: () => void;
} {
  let onAbort = () => {};
  const promise = new Promise<ModToolCallResult>((resolve) => {
    onAbort = () => resolve(errorResult(INTERRUPTED_BY_USER));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    cleanup: () => signal.removeEventListener("abort", onAbort),
  };
}

/**
 * Build `ctx.tools` for a mod tool run. Calls use the same permission check
 * as a model-issued call; `ask`/`alwaysAsk` decisions return an error result
 * because a running tool cannot open an approval prompt.
 */
export function createModToolsHandle(deps: ModToolsHandleDeps): ModToolsHandle {
  const chain = [...(modToolCallChain.getStore() ?? []), deps.callerToolName];

  const isRunnable = (name: string) =>
    !NON_RUNNABLE_TOOL_NAMES.has(name) && !chain.includes(name);

  const list = async (): Promise<ModToolInfo[]> =>
    deps
      .listTools()
      .filter((tool) => isRunnable(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters ?? {},
      }));

  const run = async (
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<ModToolCallResult> => {
    if (typeof name !== "string" || name.length === 0) {
      return errorResult("Error: tool name is required.");
    }
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return errorResult(`Error: arguments for ${name} must be an object.`);
    }
    if (chain.includes(name)) {
      return errorResult(
        `Error: ${deps.callerToolName} cannot run ${name}: recursive mod tool calls are not allowed.`,
      );
    }
    if (chain.length > MAX_MOD_TOOL_CALL_DEPTH) {
      return errorResult(
        `Error: ${deps.callerToolName} cannot run ${name}: nested mod tool calls are limited to depth ${MAX_MOD_TOOL_CALL_DEPTH}.`,
      );
    }
    const knownNames = new Set(deps.listTools().map((tool) => tool.name));
    if (
      NON_RUNNABLE_TOOL_NAMES.has(name) ||
      !(knownNames.has(name) || knownNames.has(getServerToolName(name)))
    ) {
      return errorResult(
        `Error: tool not available to mod tools: ${name}. Available tools: ${[
          ...knownNames,
        ]
          .filter(isRunnable)
          .join(", ")}`,
      );
    }

    const linked = createLinkedAbortSignal([deps.signal, options?.signal]);
    const aborted = abortedPromise(linked.signal);
    try {
      if (linked.signal.aborted) return errorResult(INTERRUPTED_BY_USER);
      const permission = await Promise.race([
        deps.checkPermission(name, args),
        aborted.promise,
      ]);
      if ("status" in permission) return permission;
      if (permission.decision === "deny") {
        const rule = permission.matchedRule
          ? ` (${permission.matchedRule})`
          : "";
        return errorResult(
          `Error: ${name} is denied by permission rules${rule}. ${permission.reason ?? ""}`.trim(),
        );
      }
      if (permission.decision !== "allow") {
        return errorResult(
          `Error: ${name} requires user approval, which a mod tool cannot request. Ask the user to add an allow rule or have the model call ${name} directly.`,
        );
      }
      if (linked.signal.aborted) return errorResult(INTERRUPTED_BY_USER);
      return await Promise.race([
        modToolCallChain
          .run(chain, () => deps.execute(name, args, linked.signal))
          .then((result) => ({
            status: result.status,
            output: toText(result.toolReturn),
          })),
        aborted.promise,
      ]);
    } catch (error) {
      if (linked.signal.aborted) return errorResult(INTERRUPTED_BY_USER);
      return errorResult(
        `Error: ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      aborted.cleanup();
      linked.cleanup();
    }
  };

  return { run, list };
}
