import type { ReflectionMemoryWorktreeFinalizeResult } from "@/agent/memory-worktree";
import type { SpawnBackgroundSubagentTaskArgs } from "@/tools/impl/task";

export function buildReflectionMergeRepairPrompt(
  integration: ReflectionMemoryWorktreeFinalizeResult,
): string {
  return `A background reflection's memory commits were merged into your memory repository and the merge stopped on a conflict, which is still in progress. Complete that in-progress merge: these conflicts are almost always the reflection and a newer update both adding to the same file, so keep both sides' information. Do not reorganize or perform unrelated edits. Stage the resolved files, commit the merge, then delete the now-merged reflection branch (\`git branch -D ${integration.reflectionBranch}\`), and stop. If the conflict is already resolved, still delete the branch and stop.

Memory directory: ${integration.parentMemoryDir}
Reflection branch (merge source): ${integration.reflectionBranch}
Reported status: ${integration.summary}`;
}

/**
 * Hand a claimed reflection merge conflict to the background memory repair
 * worker and wait for it to finish. The merge is still in progress in the
 * parent checkout — exactly what the repair worker expects — and
 * `integration.repairToken` is the attempt claimed under the finalize lease,
 * so no second claim is made. Resolves to whether a worker ran on the
 * problem, carrying uncertain cleanup to the finalizer; the caller must not hold the
 * checkout lease, which the worker needs.
 */
export async function launchReflectionMergeRepair(
  params: {
    agentId: string;
    conversationId: string;
    actingUserId?: string | null;
    integration: ReflectionMemoryWorktreeFinalizeResult;
  },
  deps: {
    spawnMemoryRepair?: (args: SpawnBackgroundSubagentTaskArgs) => unknown;
  } = {},
): Promise<{
  launched: boolean;
  cleanupUnconfirmed?: boolean;
  error?: string;
}> {
  if (!params.integration.repairToken) return { launched: false };
  const [{ ensureMemoryRepair }, { spawnBackgroundSubagentTask }] =
    await Promise.all([
      import("@/tools/impl/memory-task-lifecycle"),
      import("@/tools/impl/task"),
    ]);
  const spawn = deps.spawnMemoryRepair ?? spawnBackgroundSubagentTask;
  let finished = () => {};
  let cleanupUnconfirmed: boolean | undefined;
  let error: string | undefined;
  const repairFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const launched = await ensureMemoryRepair(
    {
      agentId: params.agentId,
      conversationId: params.conversationId,
      actingUserId: params.actingUserId,
      repairToken: params.integration.repairToken,
      description: "Repair reflection memory merge",
      prompt: buildReflectionMergeRepairPrompt(params.integration),
      result: {
        status: "conflict",
        memoryDir: params.integration.parentMemoryDir,
        summary: params.integration.summary,
        localOnly: false,
      },
    },
    // The worker's onComplete runs on success, failure and cancellation.
    (args) =>
      spawn({
        ...args,
        onComplete: async (result) => {
          cleanupUnconfirmed = result.cleanupUnconfirmed;
          error = result.error;
          finished();
        },
      }),
  );
  if (launched) await repairFinished;
  return { launched, cleanupUnconfirmed, error };
}
