import type { ReflectionMemoryWorktreeFinalizeResult } from "@/agent/memory-worktree";
import type { SpawnBackgroundSubagentTaskArgs } from "@/tools/impl/task";

export function buildReflectionMergeRepairPrompt(
  integration: ReflectionMemoryWorktreeFinalizeResult,
): string {
  return `A background reflection's memory commits were merged into your memory repository and the merge stopped on a conflict, which is still in progress. Complete that in-progress merge: these conflicts are almost always the reflection and a newer update both adding to the same file, so keep both sides' information. Do not reorganize or perform unrelated edits. Stage the resolved files, commit the merge, and stop. If the conflict is already resolved, stop.

Memory directory: ${integration.parentMemoryDir}
Reflection branch (merge source): ${integration.reflectionBranch}
Reported status: ${integration.summary}`;
}

/**
 * Hand a claimed reflection merge conflict to the background memory repair
 * worker. The merge is still in progress in the parent checkout — exactly
 * what the repair worker expects — and `integration.repairToken` is the
 * attempt claimed under the finalize lease, so no second claim is made.
 * Resolves to whether a worker is now on the problem.
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
): Promise<boolean> {
  if (!params.integration.repairToken) return false;
  const [{ ensureMemoryRepair }, { spawnBackgroundSubagentTask }] =
    await Promise.all([
      import("@/tools/impl/memory-task-lifecycle"),
      import("@/tools/impl/task"),
    ]);
  return ensureMemoryRepair(
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
    deps.spawnMemoryRepair ?? spawnBackgroundSubagentTask,
  );
}
