import { finalizeMultiReflectionCompletion } from "@/cli/helpers/reflection-completion";
import { completeReflectionLaunch } from "@/cli/helpers/reflection-launch-completion";
import { finalizeReflectionMemoryWorktreeLaunch } from "@/cli/helpers/reflection-launcher";
import type { MultiReflectionManifest } from "@/cli/helpers/reflection-transcript";
import { telemetry } from "@/telemetry";

/** Shared by explicit-conversation and auto-selected manual reflection. */
export async function completeManualReflectionLaunch(
  options: {
    finalization: Parameters<typeof finalizeReflectionMemoryWorktreeLaunch>[0];
    telemetryConversationId: string;
    manifest: MultiReflectionManifest;
    notify: (messages: string[]) => void;
    release: () => void;
  },
  deps: {
    finalize?: typeof finalizeReflectionMemoryWorktreeLaunch;
    finalizeTranscript?: typeof finalizeMultiReflectionCompletion;
  } = {},
): Promise<void> {
  const params = options.finalization;
  await completeReflectionLaunch({
    finalize: async () => {
      telemetry.trackReflectionEnd("manual", params.subagentSuccess, {
        subagentId: params.subagentAgentId,
        conversationId: options.telemetryConversationId,
        error: params.subagentError,
        model: params.model ?? undefined,
      });
      return (deps.finalize ?? finalizeReflectionMemoryWorktreeLaunch)(params);
    },
    finalizeTranscript: (success) =>
      (deps.finalizeTranscript ?? finalizeMultiReflectionCompletion)(
        params.agentId,
        options.manifest,
        success,
      ),
    notify: ({ completionMessage }) => options.notify([completionMessage]),
    release: options.release,
  });
}
