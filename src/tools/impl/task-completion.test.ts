import { describe, expect, test } from "bun:test";
import type { SubagentResult } from "@/agent/subagents";
import { SubagentProcessCleanupError } from "@/agent/subagents/subagent-process";
import { backgroundTaskCompletion } from "./task-completion";

const result: SubagentResult = {
  agentId: "fixture",
  success: false,
  report: "partial",
};

describe("background task completion", () => {
  test("keeps cleanup uncertainty observable even when no caller initially waits", async () => {
    const completion = backgroundTaskCompletion(
      Promise.resolve({ ...result, cleanupUnconfirmed: true }),
      Promise.resolve(),
      false,
    );
    await Bun.sleep(0);
    await expect(completion).rejects.toBeInstanceOf(
      SubagentProcessCleanupError,
    );
  });

  test("memory completion still waits for the whole integration lifecycle", async () => {
    let finish!: () => void;
    const lifecycle = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let settled = false;
    const completion = backgroundTaskCompletion(
      Promise.resolve(result),
      lifecycle,
      true,
    ).then(() => {
      settled = true;
    });
    await Bun.sleep(0);
    expect(settled).toBe(false);
    finish();
    await completion;
    expect(settled).toBe(true);
  });

  test.each(["cleanup", "execution"])(
    "memory %s failure still waits for lifecycle finalization",
    async (failure) => {
      let finish!: () => void;
      const lifecycle = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const error = new Error("execution failed");
      const execution =
        failure === "execution"
          ? Promise.reject(error)
          : Promise.resolve({ ...result, cleanupUnconfirmed: true });
      let settled = false;
      const completion = backgroundTaskCompletion(execution, lifecycle, true);
      void completion.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Bun.sleep(0);
      expect(settled).toBe(false);
      finish();
      if (failure === "execution") await expect(completion).rejects.toBe(error);
      else
        await expect(completion).rejects.toBeInstanceOf(
          SubagentProcessCleanupError,
        );
    },
  );
});
