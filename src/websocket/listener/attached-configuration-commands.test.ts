import { describe, expect, test } from "bun:test";
import { getRuntimeContext } from "@/runtime-context";
import {
  isAttachedConfigurationCommand,
  runAttachedConfigurationCommand,
} from "./attached-configuration-commands";

const ctx = {
  agentId: "agent-a",
  conversationId: "conv-a",
  workingDirectory: "/workspace",
  isBusy: () => false,
};

describe("attached configuration commands", () => {
  test("dispatches known IDs only", () => {
    for (const id of ["system", "personality", "pin", "unpin", "hooks"])
      expect(isAttachedConfigurationCommand(id)).toBe(true);
    expect(isAttachedConfigurationCommand("other")).toBe(false);
  });
  test("uses the native prompt updater with the selected prompt", async () => {
    const calls: string[][] = [];
    const result = await runAttachedConfigurationCommand(
      "system",
      "default",
      ctx,
      {
        updatePrompt: async (agent, prompt) => {
          calls.push([agent, prompt]);
          return { success: true, message: "ok", agent: null };
        },
      },
    );
    expect(calls).toEqual([["agent-a", "default"]]);
    expect(result).toContain("system prompt");
    await expect(
      runAttachedConfigurationCommand("system", "not-a-prompt", ctx, {
        updatePrompt: async () => {
          throw new Error("must not call");
        },
      }),
    ).rejects.toThrow("Unknown system prompt");
  });
  test("rejects busy and cloud personality before mutating", async () => {
    let called = false;
    const applyPersonality = async () => {
      called = true;
      throw new Error("must not call");
    };
    await expect(
      runAttachedConfigurationCommand(
        "personality",
        "memo",
        { ...ctx, isBusy: () => true },
        { applyPersonality },
      ),
    ).rejects.toThrow("Finish the current turn");
    await expect(
      runAttachedConfigurationCommand("personality", "memo", ctx, {
        memfsEnabled: () => true,
        localMemfs: () => false,
        applyPersonality,
      }),
    ).rejects.toThrow("local memory backend only");
    expect(called).toBe(false);
  });
  test("applies personality through the canonical helper before recompiling", async () => {
    const calls: string[] = [];
    const result = await runAttachedConfigurationCommand(
      "personality",
      "memo",
      ctx,
      {
        memfsEnabled: () => true,
        localMemfs: () => true,
        applyPersonality: async ({ agentId }) => {
          calls.push(`apply:${agentId}`);
          return {
            changed: true,
            personality: { id: "memo", label: "Letta Code", description: "" },
            personaRelativePath: "system/persona.md",
            humanRelativePath: "system/human.md",
          };
        },
        recompile: async (conversation, agent) => {
          calls.push(`recompile:${conversation}:${agent}`);
        },
      },
    );
    expect(calls).toEqual(["apply:agent-a", "recompile:conv-a:agent-a"]);
    expect(result).toContain("Personality switched");
  });
  test("a dirty-memory refusal never recompiles, and a later recompile failure reports the applied change", async () => {
    let recompiled = false;
    await expect(
      runAttachedConfigurationCommand("personality", "memo", ctx, {
        memfsEnabled: () => true,
        localMemfs: () => true,
        applyPersonality: async () => {
          throw new Error("Memory repo has uncommitted changes");
        },
        recompile: async () => {
          recompiled = true;
        },
      }),
    ).rejects.toThrow("uncommitted changes");
    expect(recompiled).toBe(false);
    await expect(
      runAttachedConfigurationCommand("personality", "memo", ctx, {
        memfsEnabled: () => true,
        localMemfs: () => true,
        applyPersonality: async () => ({
          changed: true,
          personality: { id: "memo", label: "Letta Code", description: "" },
          personaRelativePath: "system/persona.md",
          humanRelativePath: "system/human.md",
        }),
        recompile: async () => {
          throw new Error("backend rejected");
        },
      }),
    ).rejects.toThrow("Personality was changed, but recompiling failed");
  });
  test("hooks status uses conversation cwd and changing the toggle uses native writer", async () => {
    const changes: boolean[] = [];
    const deps = {
      hookCount: (cwd: string) => {
        expect(cwd).toBe("/workspace");
        return 2;
      },
      hooksDisabled: () => false,
      setHooksDisabled: (v: boolean) => changes.push(v),
    };
    expect(
      await runAttachedConfigurationCommand("hooks", "status", ctx, deps),
    ).toContain("2 configured");
    await runAttachedConfigurationCommand("hooks", "disable", ctx, deps);
    expect(changes).toEqual([true]);
  });
  test("pin and unpin call native favorite handlers", async () => {
    const calls: string[] = [];
    expect(
      await runAttachedConfigurationCommand("pin", "New name", ctx, {
        rename: async (id, name) => {
          calls.push(`${id}:${name}`);
        },
        pin: async () => "pinned",
      }),
    ).toBe("Agent pinned.");
    expect(calls).toEqual(["agent-a:New name"]);
    expect(
      await runAttachedConfigurationCommand("unpin", "", ctx, {
        unpin: async () => "unpinned",
      }),
    ).toBe("Agent unpinned.");
  });
  test("pinned listing uses native favorite discovery", async () => {
    const output = await runAttachedConfigurationCommand("pinned", "", ctx, {
      pinnedAgents: async () => [
        {
          agentId: "agent-pinned",
          agent: null,
          error: null,
          backendMode: "local",
        },
      ],
    });
    expect(JSON.parse(output)).toEqual([
      { id: "agent-pinned", name: "agent-pinned", error: null },
    ]);
  });
  test("memory repository uses the selected runtime scope and rejects URLs with credentials", async () => {
    const result = await runAttachedConfigurationCommand(
      "memory-repository",
      "status",
      ctx,
      {
        memoryRepository: async (args) => {
          expect(args).toEqual(["status"]);
          expect(getRuntimeContext()).toMatchObject({
            agentId: "agent-a",
            conversationId: "conv-a",
            workingDirectory: "/workspace",
          });
          return { output: "repository status" };
        },
      },
    );
    expect(result).toBe("repository status");
    await expect(
      runAttachedConfigurationCommand(
        "memory-repository",
        "set https://secret@example.test/repo",
        ctx,
        {
          memoryRepository: async () => {
            throw new Error("must not call");
          },
        },
      ),
    ).rejects.toThrow("without URL credentials");
  });
  test("concurrent changes to one agent are rejected until the first finishes", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runAttachedConfigurationCommand("system", "default", ctx, {
      updatePrompt: async () => {
        await gate;
        return { success: true, message: "ok", agent: null };
      },
    });
    await expect(
      runAttachedConfigurationCommand("pin", "", ctx, {
        pin: async () => "pinned",
      }),
    ).rejects.toThrow("already in progress");
    release?.();
    await first;
    expect(
      await runAttachedConfigurationCommand("pin", "", ctx, {
        pin: async () => "pinned",
      }),
    ).toBe("Agent pinned.");
  });
});
