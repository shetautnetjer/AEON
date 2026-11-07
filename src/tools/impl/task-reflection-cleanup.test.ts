import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createReflectionMemoryWorktree,
  finalizeReflectionMemoryWorktree,
} from "@/agent/memory-worktree";
import { clearAllSubagents } from "@/agent/subagent-state";
import { SubagentProcessCleanupError } from "@/agent/subagents/subagent-process";
import {
  releaseReflectionLaunch,
  tryReserveReflectionLaunch,
} from "@/cli/helpers/reflection-launcher";
import { createTempGitRepo } from "@/test-utils/temp-git-repo";
import { backgroundTasks } from "./process_manager";
import { spawnBackgroundSubagentTask } from "./task";

afterEach(() => {
  clearAllSubagents();
  for (const task of backgroundTasks.values()) {
    clearTimeout(task.cleanupTimer);
    rmSync(task.outputFile, { force: true });
  }
  backgroundTasks.clear();
});

test.each(["uncertain", "rejected", "publication", "settled"] as const)(
  "reflection %s cleanup preserves the finalization boundary",
  async (mode) => {
    const repo = createTempGitRepo("reflection-cleanup-");
    writeFileSync(join(repo.dir, "memory.md"), "original\n");
    repo.git("add", "memory.md");
    repo.git("commit", "-m", "initial");
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: repo.dir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "memory.md"),
      "partial worker evidence\n",
    );
    const parentId = `fixture-parent-${mode}`;
    expect(tryReserveReflectionLaunch(parentId)).toBe(true);
    let finalized = false;
    let published!: () => void;
    const publication = new Promise<void>((resolve) => {
      published = resolve;
    });
    try {
      const launch = spawnBackgroundSubagentTask({
        subagentType: "reflection",
        prompt: "fixture",
        description: "reflection fixture",
        parentScope: {
          agentId: parentId,
          conversationId: "fixture-conversation",
        },
        silentCompletion: true,
        onComplete: async () => {
          // The shared auto/manual/arena callback boundary owns finalization.
          await finalizeReflectionMemoryWorktree(worktree, {
            shouldMerge: false,
          });
          finalized = true;
          releaseReflectionLaunch(parentId);
        },
        deps: {
          copyGitHubPullRequestTagsImpl: async () => {
            if (mode === "publication") throw new Error("tag copy failed");
          },
          spawnSubagentImpl: async () => {
            if (mode === "rejected")
              throw new SubagentProcessCleanupError(
                "fixture cleanup unconfirmed",
              );
            return {
              agentId: "fixture-worker",
              success: false,
              error: "fixture cancelled",
              report: "partial report",
              cleanupUnconfirmed:
                mode === "uncertain" || mode === "publication",
            };
          },
          runSubagentStopHooksImpl: async () => {
            published();
            return {
              blocked: false,
              errored: false,
              feedback: [],
              results: [],
            };
          },
        },
      });
      const completion = backgroundTasks.get(launch.taskId)?.completion;
      if (mode === "settled") await completion;
      else
        await expect(completion).rejects.toBeInstanceOf(
          SubagentProcessCleanupError,
        );
      await publication;
      expect(backgroundTasks.get(launch.taskId)?.status).toBe("failed");
      expect(finalized).toBe(mode === "settled");
      expect(existsSync(worktree.worktreeDir)).toBe(mode !== "settled");
      expect(tryReserveReflectionLaunch(parentId)).toBe(mode === "settled");
      if (mode !== "settled") {
        expect(
          readFileSync(join(worktree.worktreeDir, "memory.md"), "utf8"),
        ).toBe("partial worker evidence\n");
        expect(readFileSync(launch.outputFile, "utf8")).toContain(
          "Reflection finalization deferred",
        );
        if (mode === "publication")
          expect(readFileSync(launch.outputFile, "utf8")).toContain(
            "partial report",
          );
      }
    } finally {
      releaseReflectionLaunch(parentId);
      rmSync(worktree.worktreeDir, { recursive: true, force: true });
      repo.cleanup();
    }
  },
);
