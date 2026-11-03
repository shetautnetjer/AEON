import { describe, expect, test } from "bun:test";
import type { Skill } from "@/agent/skills";
import { SYSTEM_REMINDER_CLOSE, SYSTEM_REMINDER_OPEN } from "@/constants";
import {
  buildAttachedInvocableSkillPrompt,
  buildAttachedSkillPrompt,
  listAttachedInvocableSkills,
} from "./attached-skill-prompt";

const scope = {
  agentId: "aya",
  conversationId: "conv",
  workingDirectory: "/virtual/project",
  skillSources: ["project"] as const,
};
const scoped = { ...scope, skillSources: [...scope.skillSources] };
const skill = (
  id: string,
  path = `/virtual/${id}/SKILL.md`,
  userInvocable = true,
): Skill => ({
  id,
  name: id,
  description: `description ${id}`,
  path,
  source: "project",
  userInvocable,
});

describe("attached skill prompt", () => {
  test("built-in commands load and wrap native skill instructions with the original request", async () => {
    const calls: unknown[] = [];
    const load = async (
      ...args: Parameters<
        typeof import("@/tools/impl/skill").loadRenderedSkillContent
      >
    ) => {
      calls.push(args);
      return "RENDERED";
    };
    const mods = await buildAttachedSkillPrompt(
      "mods",
      "generate-env make a lesson",
      scoped,
      { load },
    );
    expect(calls[0]).toEqual([
      "generating-mod-envs",
      { agentId: "aya", allowDisabledModelInvocation: true },
    ]);
    expect(mods).toContain(
      '<skill_content name="generating-mod-envs">\nRENDERED',
    );
    expect(mods).toContain("/mods generate-env make a lesson");
    expect(mods).toContain(SYSTEM_REMINDER_OPEN);
    expect(mods).toContain(SYSTEM_REMINDER_CLOSE);
    const status = await buildAttachedSkillPrompt("statusline", "", scoped, {
      load,
    });
    expect(status).toContain('<skill_content name="customizing-statusline">');
    expect(status).toContain("bare `/statusline` behavior");
    await expect(
      buildAttachedSkillPrompt("mods", "other", scoped, { load }),
    ).rejects.toThrow("Usage");
  });

  test("skill creator preserves the native reminder and description behavior", async () => {
    const prompt = await buildAttachedSkillPrompt(
      "skill-creator",
      "research helper",
      scoped,
    );
    expect(prompt.startsWith(SYSTEM_REMINDER_OPEN)).toBe(true);
    expect(prompt).toContain(
      "User-provided skill description:\nresearch helper",
    );
    expect(prompt.endsWith(SYSTEM_REMINDER_CLOSE)).toBe(true);
    const bare = await buildAttachedSkillPrompt("skill-creator", "", scoped);
    expect(bare).toContain("Ask what kind of skill they want to create");
  });

  test("only user-invocable matching resolved files are listed and can be invoked", async () => {
    const found = [
      skill("permitted"),
      skill("hidden", undefined, false),
      skill("shadowed"),
    ];
    const deps = {
      discover: async () => ({ skills: found, errors: [] }),
      resolveDirectory: async () => "/virtual",
      read: async (id: string) => ({
        path: id === "shadowed" ? "/other/SKILL.md" : `/virtual/${id}/SKILL.md`,
        content:
          "---\nname: permitted\nuser-invocable: true\n---\nInstructions",
      }),
      canonicalPath: async (path: string) => path,
    };
    const listed = await listAttachedInvocableSkills(scoped, deps);
    expect(listed.skills.map((s) => s.id)).toEqual(["permitted"]);
    expect(listed.omitted).toBe(1);
    const prompt = await buildAttachedSkillPrompt(
      "permitted",
      "do the task",
      scoped,
      deps,
    );
    expect(prompt).toContain('<skill_content name="permitted">');
    expect(prompt).toContain("Instructions");
    expect(prompt.endsWith("do the task")).toBe(true);
    await expect(
      buildAttachedSkillPrompt("hidden", "", scoped, deps),
    ).rejects.toThrow("not available");
    await expect(
      buildAttachedSkillPrompt("shadowed", "", scoped, deps),
    ).rejects.toThrow("resolution changed");
  });

  test("a stale invocability decision is rejected when loaded frontmatter changed", async () => {
    const deps = {
      discover: async () => ({ skills: [skill("x")], errors: [] }),
      resolveDirectory: async () => "/virtual",
      read: async () => ({
        path: "/virtual/x/SKILL.md",
        content: "---\nuser-invocable: false\n---\nblocked",
      }),
      canonicalPath: async (path: string) => path,
    };
    await expect(
      buildAttachedSkillPrompt("x", "", scoped, deps),
    ).rejects.toThrow("not available");
    expect((await listAttachedInvocableSkills(scoped, deps)).skills).toEqual(
      [],
    );
  });

  test("selected skill IDs that collide with builtins still invoke the selected skill", async () => {
    const deps = {
      discover: async () => ({ skills: [skill("statusline")], errors: [] }),
      resolveDirectory: async () => "/virtual",
      read: async () => ({
        path: "/virtual/statusline/SKILL.md",
        content: "---\nuser-invocable: true\n---\nSELECTED_SKILL_BODY",
      }),
      canonicalPath: async (path: string) => path,
    };
    const prompt = await buildAttachedInvocableSkillPrompt(
      "statusline",
      "hello",
      scoped,
      deps,
    );
    expect(prompt).toContain('<skill_content name="statusline">');
    expect(prompt).toContain("SELECTED_SKILL_BODY");
    expect(prompt).not.toContain("customizing-statusline");
  });
});
