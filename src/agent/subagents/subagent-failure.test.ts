import { expect, test } from "bun:test";
import { failedSubagentExecution } from "./subagent-failure";
import { SubagentProcessCleanupError } from "./subagent-process";
import { type ExecutionState, processStreamEvent } from "./subagent-stream";

test("cleanup failure preserves the parsed native identity, partial result and usage", () => {
  const state: ExecutionState = {
    agentId: null,
    conversationId: null,
    finalResult: null,
    finalError: null,
    enqueueReceipt: null,
    resultStats: null,
    displayedToolCalls: new Set(),
    toolCallStatuses: new Map(),
  };
  for (const event of [
    {
      type: "init",
      agent_id: "fixture-agent",
      conversation_id: "fixture-conversation",
    },
    {
      type: "result",
      result: "partial evidence",
      duration_ms: 10,
      usage: { total_tokens: 12, step_count: 2 },
    },
  ])
    processStreamEvent(JSON.stringify(event), state, "fixture-worker");
  expect(
    failedSubagentExecution(
      new SubagentProcessCleanupError("cleanup unconfirmed"),
      state,
    ),
  ).toEqual({
    agentId: "fixture-agent",
    conversationId: "fixture-conversation",
    report: "partial evidence",
    success: false,
    error: "cleanup unconfirmed",
    cleanupUnconfirmed: true,
    totalTokens: 12,
    stepCount: 2,
    durationMs: 10,
  });
  expect(
    failedSubagentExecution(new Error("other failure"), state)
      .cleanupUnconfirmed,
  ).toBeUndefined();
});
