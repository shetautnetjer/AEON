import { afterEach, expect, test } from "bun:test";
import type WebSocket from "ws";
import { __testSetBackend } from "@/backend";
import { FakeHeadlessBackend } from "@/backend/dev/fake-headless-backend";
import { settingsManager } from "@/settings-manager";
import { attachedControlId } from "@/types/attached-control-commands";
import { attachedAgentIsBusy } from "./attached-control-commands";
import { handleExecuteCommand } from "./commands";
import { getOrCreateScopedRuntime } from "./conversation-runtime";
import { createRuntime } from "./lifecycle";
import {
  ATTACHED_CONTROL_COMMANDS,
  SUPPORTED_REMOTE_COMMANDS,
} from "./listener-constants";
import { summarizeV2Command } from "./protocol-logging";

afterEach(async () => {
  __testSetBackend(null);
  await settingsManager.reset();
});

test("private command responses do not enter shared transcript streams or start turns", async () => {
  await settingsManager.initialize({ readOnly: true });
  __testSetBackend(new FakeHeadlessBackend("aya"));
  const listener = createRuntime();
  // Even a newly registered colliding mod cannot intercept a private request.
  listener.modAdapter = {
    getSnapshot: () => {
      throw new Error("Private controls must not consult mod dispatch");
    },
  } as unknown as typeof listener.modAdapter;
  const runtime = getOrCreateScopedRuntime(listener, "aya", "conv-one");
  const observed: unknown[] = [];
  listener.streamObservers = new Set([(frame) => observed.push(frame)]);
  const sent: Array<{ type: string; success: boolean; output: string }> = [];
  const socket = {
    readyState: 1,
    send: (value: string) => sent.push(JSON.parse(value)),
  };
  for (const [id, args] of [
    ["skill-creator", ""],
    ["search", ""],
  ] as const) {
    await handleExecuteCommand(
      {
        type: "execute_command",
        command_id: attachedControlId(id),
        args,
        request_id: id,
        runtime: { agent_id: "aya", conversation_id: "conv-one" },
      },
      socket as unknown as WebSocket,
      runtime,
      {},
    );
  }
  expect(sent.map((frame) => frame.type)).toEqual([
    "execute_command_response",
    "execute_command_response",
  ]);
  expect(sent[0]?.success).toBe(true);
  expect(sent[0]?.output).toContain("system-reminder");
  expect(sent[1]?.success).toBe(false);
  expect(observed).toEqual([]);
  expect(runtime.turnLifecycle.kind).toBe("idle");
  expect(runtime.pendingTurns).toBe(0);
});

test("shared agent configuration checks pending inputs and approvals in every resident conversation", () => {
  const listener = createRuntime();
  const selected = getOrCreateScopedRuntime(listener, "aya", "selected");
  const sibling = getOrCreateScopedRuntime(listener, "aya", "sibling");
  const other = getOrCreateScopedRuntime(listener, "other", "other");
  expect(attachedAgentIsBusy(selected)).toBe(false);
  other.pendingTurns = 1;
  expect(attachedAgentIsBusy(selected)).toBe(false);
  sibling.pendingInboundDispatches = 1;
  expect(attachedAgentIsBusy(selected)).toBe(true);
  sibling.pendingInboundDispatches = 0;
  sibling.pendingApprovalBatchByToolCallId.set("tool", "request");
  expect(attachedAgentIsBusy(selected)).toBe(true);
});

test("advertised private control commands log metadata without command arguments", () => {
  for (const id of ATTACHED_CONTROL_COMMANDS) {
    expect(SUPPORTED_REMOTE_COMMANDS).toContain(id);
    const summary = summarizeV2Command({
      type: "execute_command",
      command_id: id,
      args: "private-query-fixture",
    });
    expect(summary).toContain(id);
    expect(summary).toContain("args_bytes=");
    expect(summary).not.toContain("private-query-fixture");
  }
});
