import {
  pinAgentForCurrentUser,
  unpinAgentForCurrentUser,
} from "@/agent/favorites";
import { updateAgentSystemPrompt } from "@/agent/modify";
import { applyPersonalityToMemory } from "@/agent/personality";
import {
  PERSONALITY_OPTIONS,
  type PersonalityId,
} from "@/agent/personality-presets";
import { SYSTEM_PROMPTS } from "@/agent/prompt-assets";
import { getBackend } from "@/backend";
import { handleMemoryRepositoryCommand } from "@/cli/commands/memory-repository";
import { listPinnedAgentsForCurrentUser } from "@/cli/helpers/pinned-agent-listing";
import {
  countTotalHooks,
  isUserHooksDisabled,
  setHooksDisabled,
} from "@/hooks/writer";
import { runWithRuntimeContext } from "@/runtime-context";
import { settingsManager } from "@/settings-manager";

const IDS = [
  "system",
  "personality",
  "pin",
  "unpin",
  "hooks",
  "memory-repository",
  "pinned",
] as const;
const activeConfiguration = new Set<string>();
export type AttachedConfigurationCommand = (typeof IDS)[number];
export function isAttachedConfigurationCommand(
  id: string,
): id is AttachedConfigurationCommand {
  return (IDS as readonly string[]).includes(id);
}

export interface AttachedConfigurationContext {
  agentId: string;
  conversationId: string;
  workingDirectory: string;
  isBusy: () => boolean;
}

interface Dependencies {
  updatePrompt: typeof updateAgentSystemPrompt;
  applyPersonality: typeof applyPersonalityToMemory;
  pin: typeof pinAgentForCurrentUser;
  unpin: typeof unpinAgentForCurrentUser;
  memfsEnabled: (agentId: string) => boolean;
  localMemfs: () => boolean;
  recompile: (conversationId: string, agentId: string) => Promise<unknown>;
  rename: (agentId: string, name: string) => Promise<unknown>;
  hookCount: (cwd: string) => number;
  hooksDisabled: () => boolean;
  setHooksDisabled: (disabled: boolean) => void;
  memoryRepository: typeof handleMemoryRepositoryCommand;
  pinnedAgents: () => ReturnType<typeof listPinnedAgentsForCurrentUser>;
}
const defaults: Dependencies = {
  updatePrompt: updateAgentSystemPrompt,
  applyPersonality: applyPersonalityToMemory,
  pin: pinAgentForCurrentUser,
  unpin: unpinAgentForCurrentUser,
  memfsEnabled: (id) => settingsManager.isMemfsEnabled(id),
  localMemfs: () => getBackend().capabilities.localMemfs,
  recompile: (conversationId, agentId) =>
    getBackend().recompileConversation(conversationId, { agent_id: agentId }),
  rename: (agentId, name) => getBackend().updateAgent(agentId, { name }),
  hookCount: countTotalHooks,
  hooksDisabled: isUserHooksDisabled,
  setHooksDisabled,
  memoryRepository: handleMemoryRepositoryCommand,
  pinnedAgents: () =>
    listPinnedAgentsForCurrentUser([
      getBackend().capabilities.localMemfs ? "local" : "api",
    ]),
};

/** Server-side canonical configuration actions, for a selected runtime scope. */
export async function runAttachedConfigurationCommand(
  id: AttachedConfigurationCommand,
  args: string,
  ctx: AttachedConfigurationContext,
  dependencies: Partial<Dependencies> = {},
): Promise<string> {
  const readOnly =
    id === "pinned" ||
    (id === "hooks" && (!args.trim() || args.trim() === "status")) ||
    (id === "memory-repository" &&
      ["", "status", "help"].includes(args.trim()));
  const lockKey = id === "hooks" ? "hooks:user" : `agent:${ctx.agentId}`;
  if (!readOnly && activeConfiguration.has(lockKey))
    throw new Error("Another configuration change is already in progress.");
  if (!readOnly) activeConfiguration.add(lockKey);
  try {
    return await runWithRuntimeContext(
      {
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        workingDirectory: ctx.workingDirectory,
      },
      () => runConfiguration(id, args, ctx, dependencies),
    );
  } finally {
    if (!readOnly) activeConfiguration.delete(lockKey);
  }
}

async function runConfiguration(
  id: AttachedConfigurationCommand,
  args: string,
  ctx: AttachedConfigurationContext,
  dependencies: Partial<Dependencies>,
): Promise<string> {
  const d = { ...defaults, ...dependencies };
  const value = args.trim();
  if (id === "pinned") {
    if (value) throw new Error("/pinned does not accept arguments.");
    const agents = await d.pinnedAgents();
    return JSON.stringify(
      agents.map((item) => ({
        id: item.agentId,
        name: item.agent?.name ?? item.agentId,
        error: item.error,
      })),
    );
  }
  if (id === "memory-repository") {
    const pieces = value ? value.split(/\s+/) : [];
    if (
      pieces[0] === "set" &&
      /:\/\/[^/\s]*@|[?#]/.test(pieces.slice(1).join(" "))
    )
      throw new Error(
        "Use a repository URL without URL credentials, query, or fragment.",
      );
    if (ctx.isBusy() && !["status", "help", ""].includes(pieces[0] ?? ""))
      throw new Error(
        "Finish the current turn before changing the memory repository.",
      );
    return (await d.memoryRepository(pieces)).output;
  }
  if (id === "hooks") {
    if (!value || value === "status")
      return `Hooks: ${d.hooksDisabled() ? "disabled in user settings" : "enabled in user settings"}; ${d.hookCount(ctx.workingDirectory)} configured across user and project settings. Project overrides can affect execution.`;
    if (value !== "enable" && value !== "disable")
      throw new Error(
        "Usage: /hooks [status|enable|disable]. Editing individual hooks is not available here.",
      );
    if (ctx.isBusy())
      throw new Error("Finish the current turn before changing hooks.");
    d.setHooksDisabled(value === "disable");
    return `User-level hooks ${value === "disable" ? "disabled" : "enabled"}. Project overrides can affect execution.`;
  }
  if (ctx.isBusy())
    throw new Error("Finish the current turn before changing agent settings.");
  if (id === "system") {
    const prompt = SYSTEM_PROMPTS.find((item) => item.id === value);
    if (!prompt) throw new Error("Unknown system prompt selection.");
    const result = await d.updatePrompt(ctx.agentId, prompt.id);
    if (!result.success) throw new Error(result.message);
    return `Switched system prompt to ${prompt.label}.`;
  }
  if (id === "personality") {
    const personality = PERSONALITY_OPTIONS.find((item) => item.id === value);
    if (!personality) throw new Error("Unknown personality selection.");
    if (!d.memfsEnabled(ctx.agentId))
      throw new Error(
        "Memory filesystem is disabled. Run /memfs enable first.",
      );
    if (!d.localMemfs())
      throw new Error(
        "Personality switching from an attached terminal is available for the local memory backend only.",
      );
    const result = await d.applyPersonality({
      agentId: ctx.agentId,
      personalityId: personality.id as PersonalityId,
    });
    if (!result.changed)
      return `Personality already set to ${personality.label}.`;
    try {
      await d.recompile(ctx.conversationId, ctx.agentId);
    } catch (error) {
      throw new Error(
        `Personality was changed, but recompiling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return `Personality switched to ${personality.label}. Start /new for it to take full effect.`;
  }
  if (id === "pin") {
    if (value) await d.rename(ctx.agentId, value);
    try {
      return (await d.pin(ctx.agentId)) === "already-pinned"
        ? "This agent is already pinned."
        : "Agent pinned.";
    } catch (error) {
      if (value)
        throw new Error(
          `Agent was renamed, but pinning failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      throw error;
    }
  }
  if (value) throw new Error("Usage: /unpin");
  return (await d.unpin(ctx.agentId)) === "not-pinned"
    ? "This agent is not pinned."
    : "Agent unpinned.";
}
