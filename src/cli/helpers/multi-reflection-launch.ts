import {
  buildReflectionMemoryScope,
  finalizeReflectionMemoryWorktree,
} from "@/agent/memory-worktree";
import { finalizeMultiReflectionCompletion } from "@/cli/helpers/reflection-completion";
import { completeReflectionLaunch } from "@/cli/helpers/reflection-launch-completion";
import {
  finalizeReflectionMemoryWorktreeLaunch,
  getReflectionMergeLaunchOptions,
  prepareReflectionMemoryWorktreeLaunch,
  releaseReflectionLaunch,
  tryReserveReflectionLaunch,
} from "@/cli/helpers/reflection-launcher";
import { buildMultiReflectionPayload } from "@/cli/helpers/reflection-transcript";
import type { SpawnBackgroundSubagentTaskArgs } from "@/tools/impl/task";
import { debugWarn } from "@/utils/debug";

export type MultiReflectionSelection =
  | { kind: "recent"; limit: number }
  | { kind: "conversations"; conversationIds: string[] };

export type MultiReflectionLaunchResult =
  | { launched: true; transcriptCount: number; payloadPath: string }
  | { launched: false; reason: "already_active" | "no_payload" };

const defaultDeps = {
  tryReserve: tryReserveReflectionLaunch,
  release: releaseReflectionLaunch,
  buildPayload: buildMultiReflectionPayload,
  prepareWorktree: prepareReflectionMemoryWorktreeLaunch,
  finalizeWorktree: finalizeReflectionMemoryWorktreeLaunch,
  discardWorktree: finalizeReflectionMemoryWorktree,
  finalizeManifest: finalizeMultiReflectionCompletion,
  mergeOptions: getReflectionMergeLaunchOptions,
  spawn: async (args: SpawnBackgroundSubagentTaskArgs) => {
    const { spawnBackgroundSubagentTask } = await import("@/tools/impl/task");
    spawnBackgroundSubagentTask(args);
  },
};

export type MultiReflectionLaunchDeps = typeof defaultDeps;

/**
 * Launch one background reflection over several conversations (`/dream
 * --recent N` or `--conversation ID ...`) outside the TUI, for the App Server
 * listener. Same path as the TUI: an isolated memory worktree, merged back
 * under the memory checkout lease by finalizeReflectionMemoryWorktreeLaunch.
 */
export async function launchMultiReflection(
  params: {
    agentId: string;
    conversationId: string;
    selection: MultiReflectionSelection;
    instruction?: string;
    actingUserId?: string | null;
    recompileByConversation: Map<string, Promise<void>>;
    recompileQueuedByConversation: Set<string>;
    onComplete?: (completionMessage: string, success: boolean) => Promise<void>;
  },
  overrides: Partial<MultiReflectionLaunchDeps> = {},
): Promise<MultiReflectionLaunchResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { agentId, conversationId } = params;
  if (!deps.tryReserve(agentId)) {
    return { launched: false, reason: "already_active" };
  }
  let delegated = false;
  try {
    if (params.selection.kind === "conversations") {
      const invalid = params.selection.conversationIds.find(
        (id) => id === "." || id === "..",
      );
      if (invalid !== undefined) {
        throw new Error(`Invalid conversation ID: ${invalid}`);
      }
    }
    const payload = await deps.buildPayload({
      agentId,
      selectionPolicy:
        params.selection.kind === "recent"
          ? { mode: "recent", limit: params.selection.limit }
          : {
              mode: "explicit-conversations",
              conversationIds: params.selection.conversationIds,
            },
      instruction: params.instruction,
    });
    if (!payload) return { launched: false, reason: "no_payload" };

    const { worktree, reflectionPrompt } = await deps.prepareWorktree({
      agentId,
      instruction: params.instruction,
    });
    try {
      await deps.spawn({
        subagentType: "reflection",
        prompt: reflectionPrompt,
        description: "Reflecting on recent conversations",
        silentCompletion: true,
        transcriptPath: payload.payloadPath,
        memoryScope: buildReflectionMemoryScope(worktree),
        parentScope: { agentId, conversationId },
        actingUserId: params.actingUserId,
        onComplete: async ({
          success,
          error,
          agentId: reflectionAgentId,
          model,
        }) => {
          await completeReflectionLaunch({
            finalize: async () => {
              try {
                return await deps.finalizeWorktree({
                  worktree,
                  subagentSuccess: success,
                  subagentError: error,
                  agentId,
                  conversationId,
                  subagentAgentId: reflectionAgentId ?? undefined,
                  model,
                  actingUserId: params.actingUserId,
                  ...deps.mergeOptions(agentId),
                  telemetryContext: { triggerSource: "manual" },
                  recompileByConversation: params.recompileByConversation,
                  recompileQueuedByConversation:
                    params.recompileQueuedByConversation,
                  logRecompileFailure: (message) =>
                    debugWarn("memory", message),
                });
              } catch (error) {
                debugWarn(
                  "memory",
                  `Reflection finalization failed: ${String(error)}`,
                );
                return {
                  completionSuccess: false,
                  completionMessage:
                    "Reflection finalization failed; will retry later.",
                };
              }
            },
            finalizeTranscript: (success) =>
              deps.finalizeManifest(agentId, payload.manifest, success),
            notify: ({ completionMessage, completionSuccess }) =>
              params.onComplete?.(completionMessage, completionSuccess),
            release: () => deps.release(agentId),
          });
        },
      });
    } catch (error) {
      await deps
        .discardWorktree(worktree, { shouldMerge: false })
        .catch((cleanupError) =>
          debugWarn(
            "memory",
            `Reflection cleanup failed: ${String(cleanupError)}`,
          ),
        );
      throw error;
    }
    delegated = true;
    return {
      launched: true,
      transcriptCount: payload.manifest.transcripts.length,
      payloadPath: payload.payloadPath,
    };
  } finally {
    if (!delegated) deps.release(agentId);
  }
}
