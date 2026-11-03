import { realpath } from "node:fs/promises";
import {
  type DiscoverClientSideSkillsOptions,
  discoverClientSideSkills,
} from "@/agent/client-skills";
import { SKILL_CREATOR_PROMPT } from "@/agent/prompt-assets";
import {
  getFrontmatterBoolean,
  isUserInvocableSkill,
  type SkillSource,
} from "@/agent/skills";
import { SYSTEM_REMINDER_CLOSE, SYSTEM_REMINDER_OPEN } from "@/constants";
import { runWithRuntimeContext } from "@/runtime-context";
import {
  getResolvedSkillsDir,
  loadRenderedSkillContent,
  readSkillContent,
  renderSkillContent,
  wrapSkillContent,
  wrapSkillPrompt,
} from "@/tools/impl/skill";
import { parseFrontmatter } from "@/utils/frontmatter";

export interface AttachedSkillScope {
  agentId: string;
  conversationId: string;
  workingDirectory: string;
  skillSources?: SkillSource[];
  bundledSkills?: string[];
  skillsDirectory?: string | null;
}

interface SkillPromptDependencies {
  discover: typeof discoverClientSideSkills;
  load: typeof loadRenderedSkillContent;
  resolveDirectory: typeof getResolvedSkillsDir;
  read: typeof readSkillContent;
  canonicalPath: (path: string) => Promise<string>;
}
const defaultDeps: SkillPromptDependencies = {
  discover: discoverClientSideSkills,
  load: loadRenderedSkillContent,
  resolveDirectory: getResolvedSkillsDir,
  read: readSkillContent,
  canonicalPath: realpath,
};

export interface InvocableSkillListing {
  skills: Array<{ id: string; name: string; description: string }>;
  omitted: number;
}

/** Enumerate only skills that this runtime can resolve to the verified user-invocable file. */
export async function listAttachedInvocableSkills(
  scope: AttachedSkillScope,
  dependencies: Partial<SkillPromptDependencies> = {},
): Promise<InvocableSkillListing> {
  const deps = { ...defaultDeps, ...dependencies };
  return runWithRuntimeContext(
    {
      agentId: scope.agentId,
      conversationId: scope.conversationId,
      workingDirectory: scope.workingDirectory,
      skillSources: scope.skillSources,
      bundledSkills: scope.bundledSkills,
      skillsDirectory: scope.skillsDirectory,
    },
    async () => {
      const discovery = await deps.discover({
        agentId: scope.agentId,
        workingDirectory: scope.workingDirectory,
        skillSources: scope.skillSources,
        bundledSkills: scope.bundledSkills,
        skillsDirectory: scope.skillsDirectory,
      });
      const directory = await deps.resolveDirectory();
      const listing: InvocableSkillListing = {
        skills: [],
        omitted: discovery.errors.length,
      };
      for (const skill of discovery.skills) {
        if (!isUserInvocableSkill(skill)) continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill.id)) {
          listing.omitted++;
          continue;
        }
        try {
          const resolved = await deps.read(skill.id, directory, scope.agentId);
          if (
            (await deps.canonicalPath(resolved.path)) !==
              (await deps.canonicalPath(skill.path)) ||
            getFrontmatterBoolean(
              parseFrontmatter(resolved.content).frontmatter,
              "user-invocable",
            ) === false
          ) {
            listing.omitted++;
            continue;
          }
          listing.skills.push({
            id: skill.id,
            name: skill.name,
            description: skill.description,
          });
        } catch {
          listing.omitted++;
        }
      }
      return listing;
    },
  );
}

/** Build the native skill input; caller owns approvals, dispatch, and output visibility. */
export async function buildAttachedSkillPrompt(
  commandId: string,
  args: string,
  scope: AttachedSkillScope,
  dependencies: Partial<SkillPromptDependencies> = {},
  options: { genericOnly?: boolean } = {},
): Promise<string> {
  const deps = { ...defaultDeps, ...dependencies };
  return runWithRuntimeContext(
    {
      agentId: scope.agentId,
      conversationId: scope.conversationId,
      workingDirectory: scope.workingDirectory,
      skillSources: scope.skillSources,
      bundledSkills: scope.bundledSkills,
      skillsDirectory: scope.skillsDirectory,
    },
    async () => {
      if (!options.genericOnly && commandId === "skill-creator") {
        const description = args.trim().split(/\s+/).filter(Boolean).join(" ");
        const line = description
          ? `\n\nUser-provided skill description:\n${description}`
          : "\n\nThe user did not provide a description with /skill-creator. Ask what kind of skill they want to create before proceeding.";
        return `${SYSTEM_REMINDER_OPEN}\n${SKILL_CREATOR_PROMPT}${line}\n${SYSTEM_REMINDER_CLOSE}`;
      }
      if (
        !options.genericOnly &&
        (commandId === "statusline" || commandId === "mods")
      ) {
        let input = args.trim();
        const skill =
          commandId === "mods"
            ? "generating-mod-envs"
            : "customizing-statusline";
        if (commandId === "mods") {
          const match = /^generate-env(?:\s+([\s\S]*))?$/.exec(input);
          if (!match) throw new Error("Usage: /mods generate-env [request]");
          input = (match[1] ?? "").trim();
        }
        const content = await deps.load(skill, {
          agentId: scope.agentId,
          allowDisabledModelInvocation: true,
        });
        const request =
          commandId === "mods"
            ? input
              ? `The user ran \`/mods generate-env ${input}\`. Use the loaded skill to help them generate, review, validate, or improve a mod learning env JSON.`
              : "The user ran `/mods generate-env` without arguments. Use the loaded skill's bare behavior for mod learning env generation."
            : input
              ? `The user ran \`/statusline ${input}\`. Use the loaded skill to help them create, edit, or migrate their Letta Code statusline mod.`
              : "The user ran `/statusline` without arguments. Use the loaded skill's bare `/statusline` behavior.";
        return `${wrapSkillContent(skill, content)}\n\n${SYSTEM_REMINDER_OPEN}\n${request}\n${SYSTEM_REMINDER_CLOSE}`;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(commandId))
        throw new Error("Invalid skill identifier");
      const discoveryOptions: DiscoverClientSideSkillsOptions = {
        agentId: scope.agentId,
        workingDirectory: scope.workingDirectory,
        skillSources: scope.skillSources,
        bundledSkills: scope.bundledSkills,
        skillsDirectory: scope.skillsDirectory,
      };
      const discovery = await deps.discover(discoveryOptions);
      const selected = discovery.skills.find(
        (skill) => skill.id === commandId && isUserInvocableSkill(skill),
      );
      if (!selected)
        throw new Error(
          "This skill is not available for direct user invocation",
        );
      // Load through the canonical precedence, but refuse if it resolves a different
      // same-named skill than the one whose user-invocable metadata was checked.
      const resolved = await deps.read(
        commandId,
        await deps.resolveDirectory(),
        scope.agentId,
      );
      if (
        (await deps.canonicalPath(resolved.path)) !==
        (await deps.canonicalPath(selected.path))
      ) {
        throw new Error(
          "Skill resolution changed; reload skills before invoking it",
        );
      }
      if (
        getFrontmatterBoolean(
          parseFrontmatter(resolved.content).frontmatter,
          "user-invocable",
        ) === false
      ) {
        throw new Error(
          "This skill is not available for direct user invocation",
        );
      }
      const content = renderSkillContent(
        commandId,
        resolved.content,
        resolved.path,
        { allowDisabledModelInvocation: true },
      );
      return wrapSkillPrompt(commandId, content, args.trim());
    },
  );
}

/** Invoke the specifically selected skill, even when its ID collides with a built-in. */
export async function buildAttachedInvocableSkillPrompt(
  skillId: string,
  args: string,
  scope: AttachedSkillScope,
  dependencies: Partial<SkillPromptDependencies> = {},
): Promise<string> {
  return buildAttachedSkillPrompt(skillId, args, scope, dependencies, {
    genericOnly: true,
  });
}
