import type { SubagentResult } from "@/agent/subagents";
import { SubagentProcessCleanupError } from "@/agent/subagents/subagent-process";
import { appendToOutputFile } from "./process_manager";

export type TaskCompletionCallback = (result: {
  success: boolean;
  error?: string;
  agentId?: string;
  conversationId?: string;
  model?: string;
  stepCount?: number;
  durationMs?: number;
  report?: string;
  /** Internal settlement evidence; callbacks must not finalize active work. */
  cleanupUnconfirmed?: boolean;
}) => void | Promise<void>;

/** Reflection callbacks finalize worktrees; uncertain cleanup must retain them. */
export async function runTaskCompletionCallback(
  subagentType: string,
  result: Parameters<TaskCompletionCallback>[0],
  callback: TaskCompletionCallback | undefined,
  outputFile: string,
): Promise<void> {
  if (subagentType === "reflection" && result.cleanupUnconfirmed) {
    appendToOutputFile(
      outputFile,
      "[Reflection finalization deferred: process cleanup is unconfirmed; worktree, transcript frontier and launch reservation retained for reconciliation]\n",
    );
    return;
  }
  try {
    await callback?.(result);
  } catch (error) {
    appendToOutputFile(
      outputFile,
      `[onComplete error] ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** Publication errors must not erase the worker's cleanup evidence or identity. */
export function failedTaskResult(
  error: unknown,
  result?: SubagentResult,
  agentId?: string,
  conversationId?: string,
): SubagentResult {
  const cleanupUnconfirmed =
    result?.cleanupUnconfirmed || error instanceof SubagentProcessCleanupError;
  const message = error instanceof Error ? error.message : String(error);
  return {
    agentId: agentId ?? "",
    conversationId,
    report: "",
    ...result,
    success: false,
    error:
      result?.cleanupUnconfirmed && result.error
        ? `${result.error}; ${message}`
        : message,
    ...(cleanupUnconfirmed && { cleanupUnconfirmed: true }),
  };
}

/** Preserve cleanup uncertainty without losing background result publication. */
export function backgroundTaskCompletion(
  execution: Promise<SubagentResult>,
  lifecycle: Promise<unknown>,
  memoryTask: boolean,
): Promise<void> {
  // Even failed memory execution waits for integration/repair finalization.
  const completion = Promise.allSettled([
    execution,
    memoryTask ? lifecycle : Promise.resolve(),
  ] as const).then(([outcome, finalized]) => {
    if (outcome.status === "rejected") throw outcome.reason;
    if (outcome.value.cleanupUnconfirmed)
      throw new SubagentProcessCleanupError(
        outcome.value.error ?? "Subagent cleanup is unconfirmed",
      );
    if (finalized.status === "rejected") throw finalized.reason;
  });
  // Background work is not always awaited. Observing rejection here prevents
  // an unhandled rejection while explicit stop/drain callers still receive it.
  void completion.catch(() => undefined);
  return completion;
}
