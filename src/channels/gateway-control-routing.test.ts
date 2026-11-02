import { expect, test } from "bun:test";
import type { WsProtocolMessage } from "@/types/app-server-protocol";
import { ChannelGateway } from "./gateway-core";
import {
  FakeClient,
  makeDelivery,
  makeHooks,
  makeSource,
  TEST_RUNTIME,
} from "./gateway-test-support";

// Control requests raised by turns that no channel message started (task
// notifications, cron, mod continuations, OpenAI-compat bridge turns) carry no
// active routing source. They must reach the conversation's bound route. With
// no deliverable route the gateway must not deny them: it cannot see whether
// another client (TUI, aya-chat) is subscribed and can answer, so it leaves
// them pending and replays them once a route can deliver them.

function controlRequest(requestId: string): WsProtocolMessage {
  return {
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: { command: "ls" },
      tool_call_id: `call-${requestId}`,
      permission_suggestions: [],
      blocked_path: null,
    },
    agent_id: TEST_RUNTIME.agent_id,
    conversation_id: TEST_RUNTIME.conversation_id,
  } as unknown as WsProtocolMessage;
}

function approvalResponses(client: FakeClient): unknown[] {
  return client.submittedInputs
    .map((input) => input.payload)
    .filter(
      (payload) =>
        (payload as { kind?: string } | undefined)?.kind ===
        "approval_response",
    );
}

test("control request from a turn without a channel source goes to the conversation's route", async () => {
  const client = new FakeClient();
  const { hooks, controlRequestEvents } = makeHooks();
  const gateway = new ChannelGateway(client, hooks);
  const routeSource = makeSource({ channel: "telegram", chatId: "phone" });

  // Routed but idle: no channel message is active (e.g. a task-notification turn).
  await gateway.registerRuntime(TEST_RUNTIME, [routeSource]);
  client.emit(controlRequest("ctrl-unrouted"));
  await Bun.sleep(0);

  expect(controlRequestEvents).toHaveLength(1);
  expect(controlRequestEvents[0]?.requestId).toBe("ctrl-unrouted");
  expect(controlRequestEvents[0]?.source).toEqual(routeSource);
  expect(approvalResponses(client)).toEqual([]);
  gateway.close();
});

test("the host's route choice wins for a control request without a channel source", async () => {
  const client = new FakeClient();
  const older = makeSource({ channel: "telegram", chatId: "older" });
  const newest = makeSource({ channel: "telegram", chatId: "newest" });
  const seen: unknown[] = [];
  const { hooks, controlRequestEvents } = makeHooks({
    resolveUnroutedControlSource: (runtime, routedSources) => {
      seen.push({ runtime, routedSources });
      return newest;
    },
  });
  const gateway = new ChannelGateway(client, hooks);

  await gateway.registerRuntime(TEST_RUNTIME, [older, newest]);
  client.emit(controlRequest("ctrl-host-choice"));
  await Bun.sleep(0);

  expect(seen).toEqual([
    { runtime: TEST_RUNTIME, routedSources: [older, newest] },
  ]);
  expect(controlRequestEvents.map((event) => event.source)).toEqual([newest]);
  gateway.close();
});

test("control request without any deliverable route is left pending, not denied", async () => {
  const client = new FakeClient();
  const logs: string[] = [];
  const { hooks, controlRequestEvents } = makeHooks({
    debugLog: (message) => logs.push(message),
  });
  const gateway = new ChannelGateway(client, hooks);

  // The gateway tracks the runtime, but no route can deliver an approval.
  // Another client (TUI, aya-chat) may be subscribed and answer it.
  await gateway.registerRuntime(TEST_RUNTIME, []);
  client.emit(controlRequest("ctrl-nowhere"));
  await Bun.sleep(0);

  expect(controlRequestEvents).toEqual([]);
  expect(client.submittedInputs).toEqual([]);
  expect(
    logs.filter(
      (line) => line.includes("ctrl-nowhere") && line.includes("pending"),
    ),
  ).toHaveLength(1);
  gateway.close();
});

test("an approval left pending replays to a route that becomes deliverable", async () => {
  const client = new FakeClient();
  const phone = makeSource({ channel: "telegram", chatId: "phone" });
  let deliverable: typeof phone | null = phone;
  const { hooks, controlRequestEvents } = makeHooks({
    resolveUnroutedControlSource: () => deliverable,
  });
  const gateway = new ChannelGateway(client, hooks);
  await gateway.registerRuntime(TEST_RUNTIME, [phone]);
  expect(client.startedRuntimes).toHaveLength(1);

  // The phone adapter is down when a bridge turn asks for approval.
  deliverable = null;
  client.emit(controlRequest("ctrl-while-down"));
  await Bun.sleep(0);
  expect(controlRequestEvents).toEqual([]);
  expect(approvalResponses(client)).toEqual([]);

  // The adapter is back; the route refresh registers the conversation again
  // (an unchanged route would otherwise be skipped), which makes the App
  // Server replay the pending approval.
  deliverable = phone;
  const registered = await gateway.registerRuntime(
    TEST_RUNTIME,
    [phone],
    undefined,
    { ifUnregistered: true },
  );
  expect(registered).toBe(true);
  expect(client.startedRuntimes).toHaveLength(2);
  expect(
    (client.startedRuntimes[1] as Record<string, unknown>).recover_approvals,
  ).toBe(true);
  expect(client.startedRuntimes[1]?.mode).toBeUndefined();
  client.emit(controlRequest("ctrl-while-down"));
  await Bun.sleep(0);

  expect(
    controlRequestEvents.map((event) => [event.requestId, event.source]),
  ).toEqual([["ctrl-while-down", phone]]);
  expect(approvalResponses(client)).toEqual([]);
  gateway.close();
});

test("a channel-started turn still routes its approval to the turn's own source", async () => {
  const client = new FakeClient();
  const { hooks, controlRequestEvents } = makeHooks({
    resolveUnroutedControlSource: () => {
      throw new Error("must not be consulted for a channel-started turn");
    },
  });
  const gateway = new ChannelGateway(client, hooks);
  const turnSource = makeSource({ chatId: "turn-chat", messageId: "m-1" });

  await gateway.registerRuntime(TEST_RUNTIME, [makeSource({ chatId: "x" })]);
  await gateway.submit(makeDelivery({ sources: [turnSource] }));
  client.emit(controlRequest("ctrl-turn"));
  await Bun.sleep(0);

  expect(controlRequestEvents.map((event) => event.source)).toEqual([
    turnSource,
  ]);
  expect(approvalResponses(client)).toEqual([]);
  gateway.close();
});

test("control requests for runtimes the gateway does not track are ignored", async () => {
  const client = new FakeClient();
  const { hooks, controlRequestEvents } = makeHooks();
  const gateway = new ChannelGateway(client, hooks);

  client.emit(controlRequest("ctrl-foreign"));
  await Bun.sleep(0);

  expect(controlRequestEvents).toEqual([]);
  expect(client.submittedInputs).toEqual([]);
  gateway.close();
});
