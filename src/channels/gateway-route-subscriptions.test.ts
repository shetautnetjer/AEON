import { afterEach, expect, test } from "bun:test";
import type {
  ExternalToolDefinitionPayload,
  RuntimeStartResponseMessage,
  WsProtocolMessage,
} from "@/types/app-server-protocol";
import { ChannelGateway } from "./gateway-core";
import { createRoutedRuntimePublisher } from "./gateway-route-subscriptions";
import {
  FakeClient,
  makeDelivery,
  makeHooks,
  makeSource,
  makeTurnFinished,
  TEST_RUNTIME,
} from "./gateway-test-support";
import { createRoutedRuntimeRegistrationRefresher } from "./routed-runtime-registration";
import { __testOverrideLoadRoutes, clearAllRoutes } from "./routing";
import type { ChannelTurnSource } from "./types";

// The App Server sends a conversation's control requests only to connections
// subscribed to it. runtime_start subscribes; runtime_external_tools_update
// (which names `runtimes`, not `runtime`) does not. After a restart the
// gateway must subscribe to routed conversations itself, or approvals raised
// by turns no channel message started never reach the phone.

afterEach(() => {
  clearAllRoutes();
  __testOverrideLoadRoutes(null);
});

const messageChannel: ExternalToolDefinitionPayload = {
  name: "MessageChannel",
  description: "Send a channel message",
  parameters: { type: "object", properties: {} },
};

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

/** Deliver a TEST_RUNTIME message only if this connection subscribed to it. */
function emitToSubscribers(client: FakeClient, message: WsProtocolMessage) {
  const subscribed = client.startedRuntimes.some(
    (started) =>
      started.agent_id === TEST_RUNTIME.agent_id &&
      started.conversation_id === TEST_RUNTIME.conversation_id,
  );
  if (subscribed) client.emit(message);
}

function setup(
  options: {
    routes?: ChannelTurnSource[];
    client?: FakeClient;
    logger?: (message: string) => void;
  } = {},
) {
  __testOverrideLoadRoutes(() => null);
  const route = makeSource({ channel: "telegram", chatId: "phone" });
  let routes = options.routes ?? [route];
  const client = options.client ?? new FakeClient();
  const collector = makeHooks({
    buildExternalTool: async (_runtime, sources) =>
      sources.length > 0 ? messageChannel : null,
    // The local gateway resolves this from the route store.
    resolveUnroutedControlSource: (runtime) =>
      routes.find(
        (source) =>
          source.agentId === runtime.agent_id &&
          source.conversationId === runtime.conversation_id,
      ) ?? null,
  });
  const gateway = new ChannelGateway(client, collector.hooks);
  const publisher = createRoutedRuntimePublisher({
    gateway,
    logger: options.logger,
  });
  const refresher = createRoutedRuntimeRegistrationRefresher({
    registry: { resolveRoutedTurnSources: () => routes },
    publisher,
    channelNames: ["telegram"],
    buildTool: async (sources) => (sources.length > 0 ? messageChannel : null),
  });
  return {
    ...collector,
    client,
    gateway,
    publisher,
    refresher,
    route,
    setRoutes: (next: ChannelTurnSource[]) => {
      routes = next;
    },
    refresh: async () => {
      await refresher.refresh();
      await publisher.settled();
    },
    close: () => {
      refresher.close();
      gateway.close();
    },
  };
}

test("subscribes a routed conversation at startup so an unrouted approval reaches its channel", async () => {
  const ctx = setup();

  // Gateway startup: no channel message has arrived for this conversation.
  await ctx.refresh();

  expect(ctx.client.startedRuntimes).toHaveLength(1);
  const started = ctx.client.startedRuntimes[0] as Record<string, unknown>;
  expect(started.agent_id).toBe(TEST_RUNTIME.agent_id);
  expect(started.conversation_id).toBe(TEST_RUNTIME.conversation_id);
  expect(started.recover_approvals).toBe(true);
  expect("mode" in started).toBe(false);
  expect(ctx.client.submittedInputs).toEqual([]);

  // A bridge/cron turn (no channel source) asks for approval.
  emitToSubscribers(ctx.client, controlRequest("ctrl-bridge"));
  await Bun.sleep(0);

  expect(
    ctx.controlRequestEvents.map((event) => [event.requestId, event.source]),
  ).toEqual([["ctrl-bridge", ctx.route]]);
  expect(ctx.client.submittedInputs).toEqual([]);

  // Later refreshes do not register the conversation again.
  await ctx.refresh();
  expect(ctx.client.startedRuntimes).toHaveLength(1);
  ctx.close();
});

test("does not register a conversation the gateway already tracks again", async () => {
  const ctx = setup();
  await ctx.gateway.submit(
    makeDelivery({
      sources: [ctx.route],
      clientMessageId: "cm-phone",
      defaultPermissionMode: "acceptEdits",
    }),
  );
  expect(ctx.client.startedRuntimes).toHaveLength(1);
  expect(ctx.client.startedRuntimes[0]?.mode).toBe("acceptEdits");

  await ctx.refresh();
  await ctx.refresh();

  expect(ctx.client.startedRuntimes).toHaveLength(1);
  ctx.close();
});

test("releases a route-subscribed conversation when its route goes away", async () => {
  const ctx = setup();
  await ctx.refresh();
  expect(ctx.gateway.getKnownRuntimes()).toEqual([TEST_RUNTIME]);

  ctx.setRoutes([]);
  await ctx.refresh();

  expect(ctx.gateway.getKnownRuntimes()).toEqual([]);
  expect(ctx.client.runtimeToolUpdates.at(-1)).toEqual({
    runtimes: [TEST_RUNTIME],
    external_tools: [],
  });
  // The App Server keeps the connection subscribed; the gateway ignores it.
  emitToSubscribers(ctx.client, controlRequest("ctrl-unbound"));
  await Bun.sleep(0);
  expect(ctx.controlRequestEvents).toEqual([]);
  expect(ctx.client.submittedInputs).toEqual([]);

  // A returning route subscribes again, which replays pending approvals.
  ctx.setRoutes([ctx.route]);
  await ctx.refresh();
  expect(ctx.client.startedRuntimes).toHaveLength(2);
  expect(ctx.gateway.getKnownRuntimes()).toEqual([TEST_RUNTIME]);
  ctx.close();
});

test("gateway startup does not wait for route subscriptions", async () => {
  let finishStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  const client = new FakeClient();
  const runtimeStart = client.runtimeStart.bind(client);
  client.runtimeStart = async (options) => {
    await startGate;
    return runtimeStart(options);
  };
  const ctx = setup({ client });

  // startLocalChannelGateway awaits this before reporting ready.
  await ctx.refresher.refresh();
  expect(ctx.client.runtimeToolUpdates).toHaveLength(1);
  expect(ctx.client.startedRuntimes).toHaveLength(0);

  finishStart();
  await ctx.publisher.settled();
  expect(ctx.client.startedRuntimes).toHaveLength(1);
  ctx.close();
});

test("a failed subscription is logged and retried on the next refresh", async () => {
  const client = new FakeClient();
  const runtimeStart = client.runtimeStart.bind(client);
  let failNext = true;
  client.runtimeStart = async (options) => {
    const response = await runtimeStart(options);
    if (!failNext) return response;
    failNext = false;
    return {
      ...response,
      success: false,
      error: "conversation not found",
    } satisfies RuntimeStartResponseMessage;
  };
  const logs: string[] = [];
  const ctx = setup({ client, logger: (message) => logs.push(message) });

  await ctx.refresh();
  expect(logs).toEqual([
    expect.stringContaining("conversation not found"),
  ] as string[]);

  await ctx.refresh();
  expect(ctx.client.startedRuntimes).toHaveLength(2);
  emitToSubscribers(ctx.client, controlRequest("ctrl-retry"));
  await Bun.sleep(0);
  expect(ctx.controlRequestEvents.map((event) => event.requestId)).toEqual([
    "ctrl-retry",
  ]);
  ctx.close();
});

test("an approval raised while the phone route is down replays when it returns", async () => {
  const ctx = setup();
  await ctx.gateway.submit(
    makeDelivery({ sources: [ctx.route], clientMessageId: "cm-phone" }),
  );
  ctx.client.emit(makeTurnFinished("end_turn"));
  await Bun.sleep(0);
  await ctx.refresh();
  expect(ctx.client.startedRuntimes).toHaveLength(1);

  // The adapter stops; a bridge turn on the phone conversation asks for
  // approval. No route can deliver it, and the TUI may still answer it.
  ctx.setRoutes([]);
  emitToSubscribers(ctx.client, controlRequest("ctrl-down"));
  await Bun.sleep(0);
  await ctx.refresh();
  expect(ctx.controlRequestEvents).toEqual([]);
  expect(ctx.client.submittedInputs).toHaveLength(1); // the phone message only

  // The adapter is back: the refresh registers again and the App Server
  // replays the still-pending approval to the gateway.
  ctx.setRoutes([ctx.route]);
  await ctx.refresh();
  expect(ctx.client.startedRuntimes).toHaveLength(2);
  emitToSubscribers(ctx.client, controlRequest("ctrl-down"));
  await Bun.sleep(0);
  expect(
    ctx.controlRequestEvents.map((event) => [event.requestId, event.source]),
  ).toEqual([["ctrl-down", ctx.route]]);
  expect(ctx.client.submittedInputs).toHaveLength(1);
  ctx.close();
});
