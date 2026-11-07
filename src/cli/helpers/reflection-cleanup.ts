import type {
  ReflectionMemoryWorktree,
  ReflectionMemoryWorktreeFinalizeResult,
} from "@/agent/memory-worktree";

/** Describe retained evidence without finalizing, syncing or consuming it. */
export function unconfirmedReflectionCleanup(
  worktree: ReflectionMemoryWorktree,
  error?: string,
  previous?: ReflectionMemoryWorktreeFinalizeResult,
  conversationId?: string,
) {
  const summary = `Reflection process cleanup is unconfirmed; retain ${worktree.worktreeDir} and its branch for reconciliation${error ? `: ${error}` : "."}`;
  const integration: ReflectionMemoryWorktreeFinalizeResult = {
    ...previous,
    status: "failed",
    parentMemoryDir: worktree.parentMemoryDir,
    reflectionWorktreeDir: worktree.worktreeDir,
    reflectionBranch: worktree.branchName,
    // No Git inspection follows unconfirmed cleanup; zero is the existing
    // failed-outcome placeholder when no prior integration count is available.
    commitCount: previous?.commitCount ?? 0,
    summary,
    error: error ?? "Reflection process cleanup is unconfirmed",
  };
  return {
    cleanupUnconfirmed: true,
    integration,
    completionSuccess: false,
    completionMessage: summary,
    shouldNotify: true,
    integrationConversationId: conversationId,
  };
}
