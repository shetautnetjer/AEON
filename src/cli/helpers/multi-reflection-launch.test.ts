import { describe, expect, test } from "bun:test";
import type { SpawnBackgroundSubagentTaskArgs } from "@/tools/impl/task";
import {
  launchMultiReflection,
  type MultiReflectionLaunchDeps,
} from "./multi-reflection-launch";

const base = {
  agentId: "agent-1",
  conversationId: "conv-1",
  selection: { kind: "recent" as const, limit: 3 },
  recompileByConversation: new Map<string, Promise<void>>(),
  recompileQueuedByConversation: new Set<string>(),
};

function fakeDeps(payload: unknown) {
  const state = {
    reserved: false,
    calls: [] as string[],
    spawned: null as SpawnBackgroundSubagentTaskArgs | null,
  };
  const deps = {
    tryReserve: () => {
      if (state.reserved) return false;
      state.reserved = true;
      return true;
    },
    release: () => {
      state.reserved = false;
      state.calls.push("release");
    },
    buildPayload: async () => payload,
    prepareWorktree: async () => ({
      worktree: {
        worktreeDir: "/wt",
        gitCommonDir: "/wt/.git",
        parentMemoryDir: "/mem/memory",
      },
      reflectionPrompt: "prompt",
    }),
    finalizeWorktree: async () => {
      state.calls.push("finalize");
      return { completionSuccess: true, completionMessage: "merged" };
    },
    mergeOptions: () => ({ mergePolicy: "auto" }),
    finalizeManifest: async () => {
      state.calls.push("manifest");
    },
    spawn: async (args: SpawnBackgroundSubagentTaskArgs) => {
      state.spawned = args;
    },
  } as unknown as Partial<MultiReflectionLaunchDeps>;
  return { state, deps };
}

describe("launchMultiReflection", () => {
  test("releases the reservation when there is nothing to reflect on", async () => {
    const { state, deps } = fakeDeps(null);
    expect(await launchMultiReflection(base, deps)).toEqual({
      launched: false,
      reason: "no_payload",
    });
    expect(state.reserved).toBe(false);
    expect(state.spawned).toBeNull();
  });

  test("refuses while another reflection holds the reservation", async () => {
    const { state, deps } = fakeDeps(null);
    state.reserved = true;
    expect(await launchMultiReflection(base, deps)).toEqual({
      launched: false,
      reason: "already_active",
    });
  });

  test("holds the reservation until the merge finishes, then releases it", async () => {
    const { state, deps } = fakeDeps({
      payloadPath: "/p.json",
      manifest: { transcripts: [{}, {}] },
    });
    const done: string[] = [];
    const result = await launchMultiReflection(
      { ...base, onComplete: async (message) => void done.push(message) },
      deps,
    );
    expect(result).toEqual({
      launched: true,
      transcriptCount: 2,
      payloadPath: "/p.json",
    });
    expect(state.reserved).toBe(true);
    expect(state.spawned?.transcriptPath).toBe("/p.json");
    expect(state.spawned?.memoryScope?.primaryRoot).toBe("/wt");
    await state.spawned?.onComplete?.({ success: true } as never);
    expect(state.calls).toEqual(["finalize", "manifest", "release"]);
    expect(done).toEqual(["merged"]);
    expect(state.reserved).toBe(false);
  });
});
