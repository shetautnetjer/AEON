import { getErrorMessage } from "@/utils/error";
import type { SubagentResult } from ".";
import { SubagentProcessCleanupError } from "./subagent-process";
import type { ExecutionState } from "./subagent-stream";

/** Keep the native stream evidence when process execution or cleanup rejects. */
export function failedSubagentExecution(
  error: unknown,
  state: ExecutionState,
): SubagentResult {
  return {
    agentId: state.agentId ?? "",
    conversationId: state.conversationId ?? undefined,
    report: state.finalResult ?? "",
    success: false,
    error: getErrorMessage(error),
    ...(error instanceof SubagentProcessCleanupError && {
      cleanupUnconfirmed: true,
    }),
    totalTokens: state.resultStats?.totalTokens,
    stepCount: state.resultStats?.stepCount,
    durationMs: state.resultStats?.durationMs,
  };
}
