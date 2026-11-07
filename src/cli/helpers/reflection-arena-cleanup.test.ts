import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommandFinishedEvent,
  createCommandRunner,
} from "@/cli/commands/runner";
import { settingsManager } from "@/settings-manager";
import { createBuffers } from "./accumulator";
import {
  finalizeReflectionArenaChoice,
  type ReflectionArenaRun,
} from "./reflection-arena";
import { completeReflectionArenaChoiceCommand } from "./reflection-arena-command";
import { unconfirmedReflectionCleanup } from "./reflection-cleanup";
import {
  releaseReflectionLaunch,
  tryReserveReflectionLaunch,
} from "./reflection-launcher";

let settings: ReturnType<typeof spyOn>;
let localSettings: ReturnType<typeof spyOn>;
beforeEach(() => {
  settings = spyOn(settingsManager, "getSettings").mockReturnValue(
    {} as ReturnType<typeof settingsManager.getSettings>,
  );
  localSettings = spyOn(
    settingsManager,
    "getLocalProjectSettings",
  ).mockReturnValue({ lastAgent: null });
});
const directories: string[] = [];
const agents: string[] = [];
afterEach(() => {
  settings.mockRestore();
  localSettings.mockRestore();
  for (const agent of agents.splice(0)) releaseReflectionLaunch(agent);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "arena-cleanup-review-"));
  directories.push(root);
  const agentId = `fixture-${root}`;
  agents.push(agentId);
  const run: ReflectionArenaRun = {
    agentId,
    conversationId: "fixture-conversation",
    runId: "fixture-run",
    status: "awaiting_choice",
    createdAt: "2026-11-07T00:00:00Z",
    endSnapshotLine: 7,
    endMessageId: "fixture-frontier",
    payloadPath: join(root, "payload.json"),
    candidates: (["1", "2"] as const).map((label) => {
      const worktreeDir = join(root, label);
      mkdirSync(worktreeDir);
      writeFileSync(join(worktreeDir, "evidence.md"), `candidate ${label}`);
      return {
        label,
        model: "fixture-model",
        subagentId: `fixture-${label}`,
        result: { success: true },
        worktree: {
          id: label,
          parentMemoryDir: root,
          worktreeBaseDir: root,
          worktreeDir,
          branchName: `fixture-${label}`,
          baseHead: "fixture-head",
          gitCommonDir: join(root, ".git"),
        },
      };
    }),
  };
  writeFileSync(run.payloadPath, "retained transcript frontier");
  const options = {
    runId: run.runId,
    choice: "1" as const,
    recompileByConversation: new Map<string, Promise<void>>(),
    recompileQueuedByConversation: new Set<string>(),
  };
  const [first, second] = run.candidates;
  if (!first || !second) throw new Error("fixture requires two candidates");
  return { run, options, first, second };
}

test("unknown integration preserves both candidates, run and frontier, and rejects another choice promptly", async () => {
  const { run, options, first } = fixture();
  const before = JSON.stringify(run);
  const calls: string[] = [];
  const deps = {
    loadRun: async () => run,
    finalize: async () =>
      unconfirmedReflectionCleanup(first.worktree, "fixture unknown cleanup"),
    discard: async () => {
      calls.push("discard");
      throw new Error("must not discard");
    },
    finalizeTranscript: async () => {
      calls.push("transcript");
    },
    saveRun: async () => {
      calls.push("save");
    },
    appendChoice: async () => {
      calls.push("choice");
    },
    uploadChoice: async () => {
      calls.push("upload");
      return "";
    },
  };
  const result = await finalizeReflectionArenaChoice(options, deps);
  expect(result.message).toContain("cleanup is unconfirmed");
  expect(result).toMatchObject({ cleanupUnconfirmed: true });
  expect(result.run.status).toBe("awaiting_choice");
  expect(JSON.stringify(run)).toBe(before);
  expect(readFileSync(run.payloadPath, "utf8")).toBe(
    "retained transcript frontier",
  );
  for (const candidate of run.candidates)
    expect(
      readFileSync(join(candidate.worktree.worktreeDir, "evidence.md"), "utf8"),
    ).toBe(`candidate ${candidate.label}`);
  expect(calls).toEqual([]);
  for (const choice of ["1", "2", "tie"] as const)
    await expect(
      finalizeReflectionArenaChoice({ ...options, choice }, deps),
    ).rejects.toThrow("awaiting cleanup reconciliation");
});

test.each([true, false])(
  "confirmed choice (success=%s) completes and releases its reservation",
  async (success) => {
    const { run, options, first, second } = fixture();
    const calls: string[] = [];
    const result = await finalizeReflectionArenaChoice(options, {
      loadRun: async () => run,
      finalize: async () => ({
        ...unconfirmedReflectionCleanup(first.worktree),
        cleanupUnconfirmed: false,
        completionSuccess: success,
        completionMessage: "confirmed fixture result",
      }),
      discard: async () => {
        calls.push("discard");
        return {
          ...unconfirmedReflectionCleanup(second.worktree).integration,
          status: "no_changes",
        };
      },
      finalizeTranscript: async (_a, _c, _p, _l, _m, success) => {
        calls.push(`transcript:${success}`);
      },
      saveRun: async () => {
        calls.push("save");
      },
      appendChoice: async () => {
        calls.push("choice");
      },
      uploadChoice: async () => {
        calls.push("upload");
        return "";
      },
    });
    expect(result.run.status).toBe("completed");
    expect(calls).toEqual([
      "discard",
      `transcript:${success}`,
      "save",
      "choice",
      "upload",
    ]);
    expect(tryReserveReflectionLaunch(run.agentId)).toBe(true);
  },
);

test("arena choice command reports uncertain cleanup as failure while retaining the reservation", async () => {
  const { run, options, first } = fixture();
  const buffersRef = { current: createBuffers() };
  const events: CommandFinishedEvent[] = [];
  const runner = createCommandRunner({
    buffersRef,
    refreshDerived() {},
    createId: () => "arena-command",
    onCommandFinished: (event) => events.push(event),
  });
  const command = runner.start(
    "/reflect-arena choose fixture-run 1",
    "Preparing reflection arena...",
  );
  await completeReflectionArenaChoiceCommand(command, options, (params) =>
    finalizeReflectionArenaChoice(params, {
      loadRun: async () => run,
      finalize: async () => unconfirmedReflectionCleanup(first.worktree),
    }),
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ success: false });
  expect(events[0]?.output).toContain("cleanup is unconfirmed");
  expect(buffersRef.current.byId.get(command.id)).toMatchObject({
    phase: "finished",
    success: false,
  });
  expect(run.status).toBe("awaiting_choice");
  expect(tryReserveReflectionLaunch(run.agentId)).toBe(false);
});
