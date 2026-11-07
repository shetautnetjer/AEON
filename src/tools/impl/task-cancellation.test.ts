import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { clearAllSubagents, updateSubagent } from "@/agent/subagent-state";
import { SubagentProcessCleanupError } from "@/agent/subagents/subagent-process";
import { handleSubagentStopCommand } from "@/websocket/listener/commands/subagent-control";
import { createRuntime } from "@/websocket/listener/lifecycle";
import { createConversationRuntime } from "@/websocket/listener/runtime";
import {
  __resetClaudeSessionsForTests,
  runClaudeTurn,
} from "./claude-stream-session";
import { backgroundTasks } from "./process_manager";
import { spawnBackgroundSubagentTask } from "./task";
import { task_stop } from "./task-stop";

afterEach(() => {
  __resetClaudeSessionsForTests();
  clearAllSubagents();
  for (const task of backgroundTasks.values()) clearTimeout(task.cleanupTimer);
  backgroundTasks.clear();
});

test("later notification failure does not invoke a completion callback twice", async () => {
  let completions = 0;
  let formatted = 0;
  let finished!: () => void;
  const publication = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const launch = spawnBackgroundSubagentTask({
    subagentType: "general-purpose",
    prompt: "fixture",
    description: "fixture",
    parentScope: {
      agentId: "fixture-parent",
      conversationId: "fixture-conversation",
    },
    onComplete: () => {
      completions++;
    },
    deps: {
      copyGitHubPullRequestTagsImpl: async () => {},
      spawnSubagentImpl: async () => ({
        agentId: "fixture-worker",
        success: true,
        report: "evidence",
      }),
      formatTaskNotificationImpl: () => {
        if (++formatted === 1) throw new Error("publication failed");
        return "failure notification";
      },
      addToMessageQueueImpl: () => {},
      runSubagentStopHooksImpl: async () => {
        finished();
        return { blocked: false, errored: false, feedback: [], results: [] };
      },
    },
  });
  await publication;
  expect(completions).toBe(1);
  expect(backgroundTasks.get(launch.taskId)?.status).toBe("failed");
  expect(
    readFileSync(launch.outputFile, "utf8").match(/evidence/g),
  ).toHaveLength(1);
});

test.each(["listener", "tool"] as const)(
  "cleanup failure survives the worker result and task lifecycle into %s stop",
  async (route) => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const nativeId = `claude_${sessionId}`;
    const scope = {
      agentId: "fixture-parent",
      conversationId: "fixture-conversation",
    };
    const parent = createConversationRuntime(
      createRuntime(),
      scope.agentId,
      scope.conversationId,
    );
    const stdout = new PassThrough();
    let failCleanup!: (error: Error) => void;
    const transportCompletion = new Promise<{
      exitCode: number | null;
      exitSignal: NodeJS.Signals | null;
    }>((_, reject) => {
      failCleanup = reject;
    });
    let published!: () => void;
    const publication = new Promise<void>((resolve) => {
      published = resolve;
    });
    const launch = spawnBackgroundSubagentTask({
      subagentType: "claude-code",
      prompt: "fixture",
      description: "fixture cancellation",
      parentScope: scope,
      emitCompletionNotification: false,
      onComplete: () => {
        published();
      },
      deps: {
        copyGitHubPullRequestTagsImpl: async () => {},
        runSubagentStopHooksImpl: async () => ({
          blocked: false,
          errored: false,
          feedback: [],
          results: [],
        }),
        spawnSubagentImpl: async (
          _type,
          _prompt,
          _model,
          subagentId,
          signal,
        ) => {
          updateSubagent(subagentId, { agentId: nativeId, status: "running" });
          return runClaudeTurn(
            {
              prompt: "fixture",
              parentAgentId: scope.agentId,
              cwd: process.cwd(),
              sessionId,
              signal,
            },
            {
              env: {},
              createTransport: ({ signal: transportSignal }) => {
                transportSignal?.addEventListener(
                  "abort",
                  () => {
                    stdout.write(
                      `${JSON.stringify({ type: "result", result: "partial evidence", is_error: false })}\n`,
                    );
                    failCleanup(
                      new SubagentProcessCleanupError(
                        "fixture cleanup unconfirmed",
                      ),
                    );
                  },
                  { once: true },
                );
                return {
                  process: {
                    stdin: new PassThrough(),
                    stdout,
                    stderr: new PassThrough(),
                  } as never,
                  completion: transportCompletion,
                  wasAborted: () => true,
                };
              },
            },
          );
        },
      },
    });
    await Bun.sleep(0);
    if (route === "tool") {
      await expect(
        task_stop({ task_id: launch.taskId }),
      ).rejects.toBeInstanceOf(SubagentProcessCleanupError);
    } else {
      const response = await handleSubagentStopCommand(
        {
          type: "subagent_stop",
          request_id: "fixture-stop",
          runtime: {
            agent_id: scope.agentId,
            conversation_id: scope.conversationId,
          },
          agent_id: nativeId,
        },
        parent,
      );
      expect(response).toMatchObject({
        success: false,
        stopped: false,
        error: "fixture cleanup unconfirmed",
      });
    }
    await publication;
    expect(backgroundTasks.get(launch.taskId)?.status).toBe("failed");
    const transcript = readFileSync(launch.outputFile, "utf8");
    expect(transcript).toContain("partial evidence");
    expect(transcript).toContain(sessionId);
    expect(transcript).toContain("fixture cleanup unconfirmed");
  },
);
