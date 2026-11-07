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
  test.each([".", ".."])(
    "rejects unsafe conversation ID %s before building a payload",
    async (id) => {
      const { state, deps } = fakeDeps(null);
      let built = false;
      deps.buildPayload = async () => {
        built = true;
        return null;
      };
      await expect(
        launchMultiReflection(
          {
            ...base,
            selection: { kind: "conversations", conversationIds: ["safe", id] },
          },
          deps,
        ),
      ).rejects.toThrow(`Invalid conversation ID: ${id}`);
      expect(built).toBe(false);
      expect(state.reserved).toBe(false);
    },
  );

  test("allows separator-containing IDs through to existing payload sanitization", async () => {
    const { deps } = fakeDeps(null);
    let ids: string[] = [];
    deps.buildPayload = async ({ selectionPolicy }) => {
      if (selectionPolicy.mode === "explicit-conversations")
        ids = selectionPolicy.conversationIds;
      return null;
    };
    await launchMultiReflection(
      {
        ...base,
        selection: {
          kind: "conversations",
          conversationIds: ["../other", "a/b", "a/b"],
        },
      },
      deps,
    );
    expect(ids).toEqual(["../other", "a/b", "a/b"]);
  });

  test.each(["user-1", null, undefined])(
    "forwards acting user %s to spawn and finalization",
    async (actingUserId) => {
      const { state, deps } = fakeDeps({
        payloadPath: "/p.json",
        manifest: { transcripts: [] },
      });
      deps.finalizeWorktree = async (args) => {
        expect(args.actingUserId).toBe(actingUserId);
        return {
          completionSuccess: true,
          completionMessage: "merged",
        } as Awaited<ReturnType<MultiReflectionLaunchDeps["finalizeWorktree"]>>;
      };
      await launchMultiReflection({ ...base, actingUserId }, deps);
      expect(state.spawned?.actingUserId).toBe(actingUserId);
      await state.spawned?.onComplete?.({ success: true } as never);
    },
  );

  test.each([false, true])(
    "discards a prepared worktree on spawn failure (cleanup rejects: %s)",
    async (cleanupRejects) => {
      const { state, deps } = fakeDeps({
        payloadPath: "/p.json",
        manifest: { transcripts: [] },
      });
      const failure = new Error("capacity exhausted");
      deps.spawn = async () => {
        throw failure;
      };
      deps.discardWorktree = async (worktree, options) => {
        expect(worktree.worktreeDir).toBe("/wt");
        expect(options.shouldMerge).toBe(false);
        state.calls.push("discard");
        if (cleanupRejects) throw new Error("cleanup failed");
        return { status: "failed" } as Awaited<
          ReturnType<MultiReflectionLaunchDeps["discardWorktree"]>
        >;
      };
      await expect(launchMultiReflection(base, deps)).rejects.toBe(failure);
      expect(state.calls).toEqual(["discard", "release"]);
      expect(state.reserved).toBe(false);
    },
  );

  test("marks completion failed and notifies the caller when finalization rejects", async () => {
    const { state, deps } = fakeDeps({
      payloadPath: "/p.json",
      manifest: { transcripts: [] },
    });
    deps.finalizeWorktree = async () => {
      throw new Error("merge failed");
    };
    deps.finalizeManifest = async (_agentId, _manifest, success) => {
      expect(success).toBe(false);
      state.calls.push("manifest");
    };
    const done: boolean[] = [];
    await launchMultiReflection(
      {
        ...base,
        onComplete: async (message, success) => {
          expect(message).toContain("finalization failed");
          done.push(success);
        },
      },
      deps,
    );
    await state.spawned?.onComplete?.({ success: true } as never);
    expect(done).toEqual([false]);
    expect(state.calls).toEqual(["manifest", "release"]);
    expect(state.reserved).toBe(false);
  });
});
