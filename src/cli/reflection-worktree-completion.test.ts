import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimMemoryConflictRepair,
  completeMemoryConflictRepair,
} from "@/agent/memory-conflict-repair";
import { claimMemoryOperation } from "@/agent/memory-operation";
import {
  createReflectionMemoryWorktree,
  type ReflectionMemoryWorktree,
} from "@/agent/memory-worktree";
import {
  clearAutomaticReflectionSuppression,
  finalizeReflectionMemoryWorktreeLaunch,
  isAutomaticReflectionSuppressed,
} from "@/cli/helpers/reflection-launcher";
import {
  isReflectionRetryDeferred,
  recordReflectionIntegrationRetry,
} from "@/cli/helpers/reflection-retry";
import { telemetry } from "@/telemetry";
import type { SpawnBackgroundSubagentTaskArgs } from "@/tools/impl/task";

let tempDir: string;
let memoryDir: string;
const originalDoNotTrack = process.env.DO_NOT_TRACK;
const originalLettaCodeTelem = process.env.LETTA_CODE_TELEM;
const originalTelemetryDrain = telemetry.drain;
const telemetryState = telemetry as unknown as {
  events: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
};

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@test.com",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf-8",
  });
}

function writeParentMemoryFile(relativePath: string, content: string): void {
  writeFileSync(join(memoryDir, relativePath), content, "utf-8");
}

async function finalizeLaunch(
  worktree: ReflectionMemoryWorktree,
  subagentSuccess: boolean,
  overrides: Partial<
    Parameters<typeof finalizeReflectionMemoryWorktreeLaunch>[0]
  > = {},
) {
  return await finalizeReflectionMemoryWorktreeLaunch({
    worktree,
    subagentSuccess,
    subagentError: subagentSuccess ? undefined : "subagent failed",
    agentId: "agent-test",
    conversationId: "conv-test",
    subagentAgentId: "agent-reflection-test",
    model: "reflection-model",
    telemetryContext: { triggerSource: "manual" },
    recompileByConversation: new Map(),
    recompileQueuedByConversation: new Set(),
    updateIntegrationConversation: async () => {},
    ...overrides,
  });
}

/** A reflection and the parent both append to persona.md, so merging conflicts. */
async function conflictingReflection(): Promise<ReflectionMemoryWorktree> {
  const worktree = await createReflectionMemoryWorktree({
    parentMemoryDir: memoryDir,
  });
  writeFileSync(
    join(worktree.worktreeDir, "persona.md"),
    "base\nreflection\n",
    "utf-8",
  );
  git(worktree.worktreeDir, ["add", "persona.md"]);
  git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
  writeParentMemoryFile("persona.md", "base\nparent\n");
  git(memoryDir, ["add", "persona.md"]);
  git(memoryDir, ["commit", "-m", "parent"]);
  return worktree;
}

/**
 * A repair spawn stub that, like the real background task, does its work and
 * reports through `onComplete` only after the spawn call has returned.
 */
function repairWorker(
  work: (args: SpawnBackgroundSubagentTaskArgs) => Promise<boolean>,
) {
  return mock((args: SpawnBackgroundSubagentTaskArgs) => {
    setTimeout(async () => {
      const success = await work(args).catch(() => false);
      await args.onComplete?.({ success });
    }, 20);
    return { taskId: "task-1" };
  });
}

beforeEach(() => {
  clearAutomaticReflectionSuppression("agent-test");
  telemetry.cleanup();
  telemetryState.events = [];
  telemetry.drain = mock(async () => {});
  delete process.env.DO_NOT_TRACK;
  tempDir = mkdtempSync(join(tmpdir(), "reflection-completion-"));
  memoryDir = join(tempDir, "agent", "memory");
  git(tempDir, ["init", "-b", "main", memoryDir]);
  git(memoryDir, ["config", "core.autocrlf", "false"]);
  git(memoryDir, ["config", "core.eol", "lf"]);
  writeParentMemoryFile("persona.md", "base\n");
  git(memoryDir, ["add", "persona.md"]);
  git(memoryDir, ["commit", "-m", "init"]);
});

afterEach(() => {
  telemetry.drain = originalTelemetryDrain;
  if (originalDoNotTrack === undefined) {
    delete process.env.DO_NOT_TRACK;
  } else {
    process.env.DO_NOT_TRACK = originalDoNotTrack;
  }
  if (originalLettaCodeTelem === undefined) {
    delete process.env.LETTA_CODE_TELEM;
  } else {
    process.env.LETTA_CODE_TELEM = originalLettaCodeTelem;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("reflection worktree completion messaging", () => {
  test("uncertain explicit integration retains its worktree and the checkout lease", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "partial.md"),
      "partial integration\n",
    );
    const syncIntegratedMemory = mock(async () => ({
      status: "clean" as const,
      summary: "clean",
      memoryDir,
      localOnly: true,
    }));
    const updateIntegrationConversation = mock(async () => {});
    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      syncIntegratedMemory,
      updateIntegrationConversation,
      runExplicitIntegration: async () => ({
        success: false,
        cleanupUnconfirmed: true,
        error: "cleanup unconfirmed",
        conversationId: "integration-conversation",
      }),
    });
    expect(result.completionSuccess).toBe(false);
    expect(result.cleanupUnconfirmed).toBe(true);
    expect(result.integration.status).toBe("failed");
    expect(result.completionMessage).toContain("reconciliation");
    expect(result.integrationConversationId).toBe("integration-conversation");
    expect(readFileSync(join(worktree.worktreeDir, "partial.md"), "utf8")).toBe(
      "partial integration\n",
    );
    expect(syncIntegratedMemory).not.toHaveBeenCalled();
    expect(updateIntegrationConversation).not.toHaveBeenCalled();
    expect(telemetryState.events).toHaveLength(0);
    expect(await claimMemoryOperation(memoryDir)).toBeNull();
  });

  test("uncertain merge repair retains the in-progress merge and attempt marker", async () => {
    const worktree = await conflictingReflection();
    let statusWhileRepairing = "";
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair: (args) => {
        statusWhileRepairing = git(memoryDir, ["status", "--porcelain"]);
        void args.onComplete?.({
          success: false,
          cleanupUnconfirmed: true,
          error: "repair cleanup unconfirmed",
        });
        return { taskId: "fixture-repair" };
      },
    });
    expect(result.completionSuccess).toBe(false);
    expect(result.integration.status).toBe("failed");
    expect(result.completionMessage).toContain("reconciliation");
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(true);
    expect(git(memoryDir, ["status", "--porcelain"])).toBe(
      statusWhileRepairing,
    );
    expect((await claimMemoryConflictRepair(memoryDir)).status).toBe(
      "in_progress",
    );
    expect(telemetryState.events).toHaveLength(0);
    const release = await claimMemoryOperation(memoryDir);
    expect(release).not.toBeNull();
    await release?.();
  });

  test("explicit integration can edit, commit, and merge in its conversation", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const updateIntegrationConversation = mock(async () => {});
    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      updateIntegrationConversation,
      runExplicitIntegration: async () => {
        writeFileSync(
          join(worktree.worktreeDir, "reflection.md"),
          "reviewed\n",
        );
        git(worktree.worktreeDir, ["add", "reflection.md"]);
        git(worktree.worktreeDir, ["commit", "-m", "review reflection"]);
        git(memoryDir, [
          "merge",
          worktree.branchName,
          "-m",
          "merge reflection",
        ]);
        return {
          success: true,
          conversationId: "conv-review",
        };
      },
    });

    expect(result.integration.status).toBe("merged");
    expect(result.integration.commitCount).toBe(2);
    expect(result.integrationConversationId).toBe("conv-review");
    expect(updateIntegrationConversation).toHaveBeenCalledWith("conv-review", {
      summary: "Reflection integration (reflection agent-reflection-test)",
      archived: true,
    });
    expect(existsSync(worktree.worktreeDir)).toBe(false);
  });

  test("explicit integration pushes its merge from the lease holder", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const synced: string[] = [];
    let worktreeGoneAtSync = false;
    let leaseHeldAtSync = false;
    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      runExplicitIntegration: async () => {
        git(memoryDir, [
          "merge",
          "--no-ff",
          worktree.branchName,
          "-m",
          "merge reflection",
        ]);
        return { success: true, conversationId: "conv-review" };
      },
      // The integration child cannot sync while the parent holds the lease.
      // The parent syncs only after finalize verified the merge, so a rebase
      // during sync can no longer make the reflection look unmerged.
      syncIntegratedMemory: async (agentId, options) => {
        synced.push(`${agentId}:${options?.memoryDir}`);
        worktreeGoneAtSync = !existsSync(worktree.worktreeDir);
        // Still under the same lease as the integration and its verification.
        leaseHeldAtSync = (await claimMemoryOperation(memoryDir)) === null;
        return {
          status: "pushed",
          summary: "Pushed",
          memoryDir,
          localOnly: false,
        };
      },
    });

    expect(result.integration.status).toBe("merged");
    expect(synced).toEqual([`agent-test:${memoryDir}`]);
    expect(worktreeGoneAtSync).toBe(true);
    expect(leaseHeldAtSync).toBe(true);
  });

  test("explicit integration failure cleans up for transcript retry", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const updateIntegrationConversation = mock(async () => {});
    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      updateIntegrationConversation,
      runExplicitIntegration: async () => ({
        success: false,
        error: "integration interrupted",
        conversationId: "conv-review",
      }),
    });

    expect(result.integration.status).toBe("failed");
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toContain("integration interrupted");
    expect(result.completionMessage).toContain("transcript can be retried");
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(updateIntegrationConversation).not.toHaveBeenCalled();
    expect(telemetryState.events).toHaveLength(1);
  });

  test("verified agent merge succeeds even if its process reports an error", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      runExplicitIntegration: async () => {
        git(memoryDir, [
          "merge",
          worktree.branchName,
          "-m",
          "merge reflection",
        ]);
        return { success: false, error: "output stream closed" };
      },
    });

    expect(result.integration.status).toBe("merged");
    expect(result.completionSuccess).toBe(true);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
  });

  test("explicit integration cleans up uncommitted edits for retry", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      runExplicitIntegration: async () => {
        writeFileSync(join(worktree.worktreeDir, "reflection.md"), "dirty\n");
        return { success: true };
      },
    });

    expect(result.integration.status).toBe("dirty_uncommitted");
    expect(result.integration.summary).toContain("uncommitted changes");
    expect(result.completionSuccess).toBe(false);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(telemetryState.events).toHaveLength(1);
  });

  test("explicit integration cleans up when the agent did not merge", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "draft\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      runExplicitIntegration: async () => ({ success: true }),
    });

    expect(result.integration.status).toBe("failed");
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toContain("did not merge");
    expect(existsSync(worktree.worktreeDir)).toBe(false);
  });

  test("parent dirty cleans up and leaves the transcript retryable", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "reflection.md"),
      "dream\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
    writeParentMemoryFile("parent-dirty.md", "dirty\n");

    const result = await finalizeLaunch(worktree, true, {
      mergePolicy: "explicit",
      runExplicitIntegration: async () => ({ success: true }),
    });

    expect(result.integration.status).toBe("parent_dirty");
    expect(result.integration.summary).toContain(
      "parent memory repo had uncommitted changes",
    );
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      "Tried to reflect, but parent memory had uncommitted changes; will retry later.",
    );

    const event = telemetryState.events.find(
      (entry) => entry.type === "reflection_worktree_cleanup",
    );
    expect(telemetryState.events).toHaveLength(1);
    expect(event?.data).toMatchObject({
      outcome: "parent_dirty",
      integration_status: "parent_dirty",
      trigger_source: "manual",
      subagent_id: "agent-reflection-test",
      conversation_id: "conv-test",
      reflection_worktree_id: worktree.id,
      commit_count: 1,
      model: "reflection-model",
    });
  });

  test("a conflicted merge waits for its repair worker and consumes the transcript once the merge lands", async () => {
    const worktree = await conflictingReflection();

    // Seed a deferred retry: a landed repair must clear it instead of
    // scheduling another reflection over the same transcript.
    recordReflectionIntegrationRetry(
      "agent-test",
      {
        status: "merge_conflict",
        parentMemoryDir: memoryDir,
        reflectionWorktreeDir: "",
        reflectionBranch: "",
        commitCount: 0,
        summary: "",
      },
      false,
      "step-count",
    );
    expect(isReflectionRetryDeferred("agent-test", "step-count")).toBe(true);

    // What the worker finds when it starts, recorded for assertions below.
    let handedOver:
      | {
          mergeHead: boolean;
          conflicted: string;
          worktreeExists: boolean;
          branch: string;
          attemptToken?: string;
        }
      | undefined;
    const attemptPath = join(memoryDir, ".git", "letta-memory-repair.json");
    const spawnMemoryRepair = repairWorker(async (args) => {
      handedOver = {
        mergeHead: existsSync(join(memoryDir, ".git", "MERGE_HEAD")),
        conflicted: readFileSync(join(memoryDir, "persona.md"), "utf-8"),
        worktreeExists: existsSync(worktree.worktreeDir),
        branch: git(memoryDir, [
          "branch",
          "--list",
          worktree.branchName,
        ]).trim(),
        attemptToken: (
          JSON.parse(readFileSync(attemptPath, "utf-8")) as { token?: string }
        ).token,
      };
      // The worker does what its prompt instructs: resolve keeping both
      // sides, commit the merge, delete the reflection branch.
      writeParentMemoryFile("persona.md", "base\nparent\nreflection\n");
      git(memoryDir, ["add", "persona.md"]);
      git(memoryDir, ["commit", "--no-edit"]);
      git(memoryDir, ["branch", "-D", worktree.branchName]);
      await completeMemoryConflictRepair(
        memoryDir,
        args.memoryRepairToken ?? "",
      );
      return true;
    });
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair,
    });

    // Finalize waited for the worker (it runs after spawn returns), then
    // found the reflection head on main and consumed the transcript.
    expect(result.integration.status).toBe("repair_started");
    expect(result.integration.repairLanded).toBe(true);
    expect(result.completionSuccess).toBe(true);
    expect(isReflectionRetryDeferred("agent-test", "step-count")).toBe(false);
    expect(result.completionMessage).toBe(
      "Reflection's memory updates overlapped newer changes; a repair worker merged them.",
    );
    expect(
      git(memoryDir, [
        "merge-base",
        "--is-ancestor",
        result.integration.head ?? "",
        "HEAD",
      ]),
    ).toBe("");
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "base\nparent\nreflection\n",
    );
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);

    // The claimed token reached the repair spawn exactly once, with a
    // reflection-specific prompt and the parent checkout as its scope.
    expect(spawnMemoryRepair).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnMemoryRepair.mock.calls[0]?.[0];
    expect(spawnArgs?.subagentType).toBe("memory");
    expect(spawnArgs?.memoryRepairToken).toBe(result.integration.repairToken);
    expect(spawnArgs?.parentScope).toEqual({
      agentId: "agent-test",
      conversationId: "conv-test",
    });
    expect(spawnArgs?.memoryScope).toEqual({
      primaryRoot: memoryDir,
      writableRoots: [memoryDir],
    });
    expect(spawnArgs?.prompt).toContain("reflection");
    expect(spawnArgs?.prompt).toContain("both sides");
    expect(spawnArgs?.prompt).toContain(worktree.branchName);
    expect(spawnArgs?.prompt).toContain("already resolved");
    // The prompt tells the worker to drop the merged reflection branch.
    expect(spawnArgs?.prompt).toContain("git branch -D");

    // The worker was handed the merge in progress: conflict markers in the
    // file, MERGE_HEAD recorded, the worktree removed but the reflection
    // branch kept, and the real claim recorded under the parent's git dir.
    expect(handedOver?.mergeHead).toBe(true);
    expect(handedOver?.conflicted).toContain("<<<<<<<");
    expect(handedOver?.conflicted).toContain("reflection");
    expect(handedOver?.conflicted).toContain("parent");
    expect(handedOver?.worktreeExists).toBe(false);
    expect(handedOver?.branch).toBe(worktree.branchName);
    expect(handedOver?.attemptToken).toBe(result.integration.repairToken);

    const event = telemetryState.events.find(
      (entry) => entry.type === "reflection_worktree_cleanup",
    );
    expect(telemetryState.events).toHaveLength(1);
    expect(event?.data).toMatchObject({
      outcome: "merge_repair",
      integration_status: "repair_started",
      trigger_source: "manual",
      subagent_id: "agent-reflection-test",
      conversation_id: "conv-test",
      reflection_worktree_id: worktree.id,
      commit_count: 1,
      model: "reflection-model",
    });
  });

  test("a repair that leaves the merge unresolved keeps the transcript retryable", async () => {
    const worktree = await conflictingReflection();
    // The worker ran but could not resolve: its attempt is marked done.
    const spawnMemoryRepair = repairWorker(async (args) => {
      await completeMemoryConflictRepair(
        memoryDir,
        args.memoryRepairToken ?? "",
      );
      return false;
    });
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair,
    });

    expect(spawnMemoryRepair).toHaveBeenCalledTimes(1);
    expect(result.integration.status).toBe("repair_started");
    expect(result.integration.repairLanded).toBe(false);
    expect(result.completionSuccess).toBe(false);
    expect(isReflectionRetryDeferred("agent-test", "step-count")).toBe(true);
    expect(result.completionMessage).toBe(
      "Reflection's memory updates overlapped newer changes and the repair worker did not merge them; will retry later.",
    );
    // Its own unfinished merge is aborted so the checkout is not stuck mid-merge
    // (update workers would defer forever), but the reflection branch is kept
    // and the transcript stays retryable.
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe(worktree.branchName);
    recordReflectionIntegrationRetry(
      "agent-test",
      result.integration,
      true,
      "manual",
    );
  });

  test("a repair that leaves someone else's merge in progress is not aborted", async () => {
    const worktree = await conflictingReflection();
    // The worker aborts the reflection's merge, then leaves a different merge
    // in progress (MERGE_HEAD is not this reflection's head).
    const spawnMemoryRepair = repairWorker(async (args) => {
      git(memoryDir, ["merge", "--abort"]);
      git(memoryDir, ["checkout", "-b", "other", "HEAD~1"]);
      writeParentMemoryFile("persona.md", "base\nother\n");
      git(memoryDir, ["commit", "-am", "other"]);
      git(memoryDir, ["checkout", "main"]);
      expect(() => git(memoryDir, ["merge", "other"])).toThrow();
      await completeMemoryConflictRepair(
        memoryDir,
        args.memoryRepairToken ?? "",
      );
      return false;
    });
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair,
    });

    expect(result.integration.repairLanded).toBe(false);
    expect(result.completionSuccess).toBe(false);
    const mergeHead = git(memoryDir, ["rev-parse", "MERGE_HEAD"]).trim();
    expect(mergeHead).toBe(git(memoryDir, ["rev-parse", "other"]).trim());
    recordReflectionIntegrationRetry(
      "agent-test",
      result.integration,
      true,
      "manual",
    );
  });

  test("a repair that aborts the merge keeps the transcript retryable", async () => {
    const worktree = await conflictingReflection();
    const spawnMemoryRepair = repairWorker(async (args) => {
      git(memoryDir, ["merge", "--abort"]);
      await completeMemoryConflictRepair(
        memoryDir,
        args.memoryRepairToken ?? "",
      );
      return true;
    });
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair,
    });

    expect(result.integration.status).toBe("repair_started");
    expect(result.integration.repairLanded).toBe(false);
    expect(result.completionSuccess).toBe(false);
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "base\nparent\n",
    );
    // The reflection's commits are still on its branch, not on main.
    expect(git(memoryDir, ["rev-parse", worktree.branchName]).trim()).toBe(
      result.integration.head ?? "",
    );
    recordReflectionIntegrationRetry(
      "agent-test",
      result.integration,
      true,
      "manual",
    );
  });

  test("a clean merge never involves the repair worker", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "reflection.md"),
      "dream\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
    writeParentMemoryFile("parent.md", "awake\n");
    git(memoryDir, ["add", "parent.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const claimConflictRepair = mock(async () => ({
      status: "claimed" as const,
      token: "unused",
    }));
    const spawnMemoryRepair = mock(
      (_args: SpawnBackgroundSubagentTaskArgs) => ({
        taskId: "task-1",
      }),
    );
    const result = await finalizeLaunch(worktree, true, {
      claimConflictRepair,
      spawnMemoryRepair,
    });

    expect(result.integration.status).toBe("merged");
    expect(result.completionSuccess).toBe(true);
    expect(claimConflictRepair).not.toHaveBeenCalled();
    expect(spawnMemoryRepair).not.toHaveBeenCalled();
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
  });

  test("a failed repair launch aborts the merge and reports a retryable conflict", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "reflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
    writeParentMemoryFile("persona.md", "parent\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const spawnMemoryRepair = mock((_args: SpawnBackgroundSubagentTaskArgs) => {
      throw new Error("task capacity reached");
    });
    const result = await finalizeLaunch(worktree, true, {
      spawnMemoryRepair,
    });

    // No worker is running, so the parent repo must not be left mid-merge:
    // the merge is aborted, the branch dropped, the claim forgotten, and the
    // result re-reported as a plain retryable merge conflict.
    expect(spawnMemoryRepair).toHaveBeenCalledTimes(1);
    expect(result.integration.status).toBe("merge_conflict");
    expect(result.integration.repairToken).toBeUndefined();
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      "Tried to reflect, but memory updates conflicted with newer changes; will retry later.",
    );
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "parent\n",
    );
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
    expect(
      existsSync(join(memoryDir, ".git", "letta-memory-repair.json")),
    ).toBe(false);

    const event = telemetryState.events.find(
      (entry) => entry.type === "reflection_worktree_cleanup",
    );
    expect(event?.data).toMatchObject({
      outcome: "merge_conflict",
      integration_status: "merge_conflict",
    });
  });

  test("parent merge conflict cleans up and leaves the transcript retryable when repair is already in progress", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "reflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
    writeParentMemoryFile("persona.md", "parent\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const spawnMemoryRepair = mock(
      (_args: SpawnBackgroundSubagentTaskArgs) => ({
        taskId: "task-1",
      }),
    );
    const result = await finalizeLaunch(worktree, true, {
      claimConflictRepair: async () => ({ status: "in_progress" }),
      spawnMemoryRepair,
    });

    expect(result.integration.status).toBe("merge_conflict");
    expect(result.integration.summary).toContain("conflicted");
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      "Tried to reflect, but memory updates conflicted with newer changes; will retry later.",
    );
    expect(spawnMemoryRepair).not.toHaveBeenCalled();
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");

    const event = telemetryState.events.find(
      (entry) => entry.type === "reflection_worktree_cleanup",
    );
    expect(telemetryState.events).toHaveLength(1);
    expect(event?.data).toMatchObject({
      outcome: "merge_conflict",
      integration_status: "merge_conflict",
      trigger_source: "manual",
      subagent_id: "agent-reflection-test",
      conversation_id: "conv-test",
      reflection_worktree_id: worktree.id,
      commit_count: 1,
      model: "reflection-model",
    });
  });

  test("dirty reflection worktree retries transcript with dirty message", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "scratch.md"), "dirty\n", "utf-8");

    const result = await finalizeLaunch(worktree, true);

    expect(result.integration.status).toBe("dirty_uncommitted");
    expect(result.integration.summary).toContain("uncommitted changes");
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      "Tried to reflect, but memory changes were not committed cleanly; will retry later.",
    );
    expect(telemetryState.events).toHaveLength(1);
    expect(telemetryState.events[0]?.data).toMatchObject({
      outcome: "reflection_worktree_dirty",
      integration_status: "dirty_uncommitted",
      reflection_worktree_id: worktree.id,
      commit_count: 0,
    });
  });

  test("failed reflection retries transcript with failed update message", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    const result = await finalizeLaunch(worktree, false);

    expect(result.integration.status).toBe("failed");
    expect(result.integration.summary).toContain(
      "subagent did not complete successfully",
    );
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      "Tried to reflect, but memory updates were not completed cleanly; will retry later.",
    );
    expect(telemetryState.events).toHaveLength(1);
    expect(telemetryState.events[0]?.data).toMatchObject({
      outcome: "subagent_failed",
      integration_status: "failed",
      reflection_worktree_id: worktree.id,
      commit_count: 0,
    });
  });

  test("failed reflection surfaces a model configuration error", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    const result = await finalizeLaunch(worktree, false, {
      subagentError:
        '400 {"error":"Model handle not found: openai-proxy/deepseek-v4-flash"}',
    });

    expect(result.integration.status).toBe("failed");
    expect(result.completionSuccess).toBe(false);
    expect(result.completionMessage).toBe(
      'Reflection failed: Model handle "openai-proxy/deepseek-v4-flash" was not found. Automatic reflection is paused until the model configuration changes; use /reflect to retry.',
    );
  });

  test("a transient manual retry does not clear model configuration suppression", async () => {
    const configurationWorktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    await finalizeLaunch(configurationWorktree, false, {
      subagentError:
        '400 {"error":"Model handle not found: openai-proxy/deepseek-v4-flash"}',
    });
    expect(isAutomaticReflectionSuppressed("agent-test")).toBe(true);

    const transientWorktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    const result = await finalizeLaunch(transientWorktree, false, {
      subagentError: "Connection error.",
    });

    expect(result.completionMessage).toBe(
      "Tried to reflect, but memory updates were not completed cleanly; will retry later.",
    );
    expect(isAutomaticReflectionSuppressed("agent-test")).toBe(true);
  });

  test("a successful manual retry resumes automatic reflection", async () => {
    const configurationWorktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    await finalizeLaunch(configurationWorktree, false, {
      subagentError:
        '400 {"error":"Model handle not found: openai-proxy/deepseek-v4-flash"}',
    });
    expect(isAutomaticReflectionSuppressed("agent-test")).toBe(true);

    const successfulWorktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    const result = await finalizeLaunch(successfulWorktree, true);

    expect(result.completionSuccess).toBe(true);
    expect(isAutomaticReflectionSuppressed("agent-test")).toBe(false);
  });
});
