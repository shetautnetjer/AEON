import { runWithRuntimeContext } from "@/runtime-context";
import { attachedControlName } from "@/types/attached-control-commands";
import {
  isAttachedConfigurationCommand,
  runAttachedConfigurationCommand,
} from "./attached-configuration-commands";
import { runAttachedInspectionCommand } from "./attached-inspection-commands";
import {
  buildAttachedInvocableSkillPrompt,
  buildAttachedSkillPrompt,
  listAttachedInvocableSkills,
} from "./attached-skill-prompt";
import { getConversationWorkingDirectory } from "./cwd";
import { ATTACHED_CONTROL_COMMANDS } from "./listener-constants";
import type { ConversationRuntime } from "./types";

export function isAttachedControlCommand(id: string): boolean {
  return attachedControlName(id) !== null;
}

/** Agent settings are shared by its conversations, so check every resident scope. */
export function attachedAgentIsBusy(runtime: ConversationRuntime): boolean {
  const scopes = new Set([
    runtime,
    ...runtime.listener.conversationRuntimes.values(),
  ]);
  return [...scopes].some(
    (scope) =>
      scope.agentId === runtime.agentId &&
      (scope.turnLifecycle.kind !== "idle" ||
        scope.queuePumpActive ||
        scope.queuePumpScheduled ||
        scope.pendingInboundDispatches > 0 ||
        scope.pendingTurns > 0 ||
        scope.pendingApprovalResolvers.size > 0 ||
        scope.pendingApprovalBatchByToolCallId.size > 0 ||
        scope.recoveredApprovalState !== null ||
        scope.pendingInterruptedContext !== null ||
        scope.pendingInterruptedResults !== null ||
        (scope.pendingInterruptedToolCallIds?.length ?? 0) > 0 ||
        scope.queuedMessagesByItemId.size > 0 ||
        scope.queueRuntime.length > 0),
  );
}

/** Returns private command results; callers must not broadcast these as transcript deltas. */
export async function runAttachedControlCommand(
  wireId: string,
  args: string,
  runtime: ConversationRuntime,
): Promise<string> {
  const id = attachedControlName(wireId);
  if (!id || !ATTACHED_CONTROL_COMMANDS.includes(wireId))
    throw new Error("Unsupported attached control command.");
  if (!runtime.agentId)
    throw new Error("An attached command requires an active agent.");
  const ctx = {
    agentId: runtime.agentId,
    conversationId: runtime.conversationId,
    workingDirectory: getConversationWorkingDirectory(
      runtime.listener,
      runtime.agentId,
      runtime.conversationId,
    ),
    isBusy: () => attachedAgentIsBusy(runtime),
  };
  if (isAttachedConfigurationCommand(id))
    return runAttachedConfigurationCommand(id, args, ctx);
  if (id === "search" || id === "mcp") {
    return runWithRuntimeContext(ctx, () =>
      runAttachedInspectionCommand(id, args, {
        agent_id: ctx.agentId,
        conversation_id: ctx.conversationId,
      }),
    );
  }
  const skillScope = {
    ...ctx,
    skillSources: runtime.skillSources,
    bundledSkills: runtime.bundledSkills,
  };
  if (id === "skills" && !args.trim())
    return JSON.stringify(await listAttachedInvocableSkills(skillScope));
  if (["skills", "mods", "statusline", "skill-creator"].includes(id)) {
    if (
      runtime.pendingApprovalResolvers.size ||
      runtime.recoveredApprovalState ||
      runtime.pendingApprovalBatchByToolCallId.size
    ) {
      throw new Error(
        "Answer the pending tool approval before invoking a skill.",
      );
    }
    if (id === "skills") {
      const selection: unknown = JSON.parse(args);
      if (
        !selection ||
        typeof selection !== "object" ||
        Array.isArray(selection) ||
        !("id" in selection) ||
        typeof selection.id !== "string" ||
        !("args" in selection) ||
        typeof selection.args !== "string"
      ) {
        throw new Error(
          "A skill selection requires an ID and argument string.",
        );
      }
      return buildAttachedInvocableSkillPrompt(
        selection.id,
        selection.args,
        skillScope,
      );
    }
    return buildAttachedSkillPrompt(id, args, skillScope);
  }
  throw new Error("Unsupported attached control command.");
}
