import { afterEach, beforeEach, expect, test } from "bun:test";
import type { WsProtocolMessage } from "@/types/app-server-protocol";
import {
  createLocalApprovalRouting,
  resolveUndeliveredApprovalTimeoutMs,
  undeliveredApprovalDenialMessage,
} from "./gateway-approval-timeouts";
import { ChannelGateway } from "./gateway-core";
import {
  FakeClient,
  makeHooks,
  makeSource,
  TEST_RUNTIME,
} from "./gateway-test-support";
import {
  __testOverrideLoadPendingControlRequestStore,
  __testOverrideSavePendingControlRequestStore,
  clearPendingControlRequestStore,
} from "./pending-control-requests";
import { ChannelRegistry } from "./registry";
import {
  __testOverrideLoadRoutes,
  __testOverrideSaveRoutes,
  addRoute,
  clearAllRoutes,
} from "./routing";
import type { ChannelControlRequestEvent, ChannelTurnSource } from "./types";

// An approval nobody can see on a channel must not hold its turn forever
// (2026-11-02 outage). The local gateway denies it after a time limit unless
// it is delivered or answered first. A deny that loses the race to a real
// answer is rejected by the App Server and must be harmless.

const TIMEOUT_MS = 30;

beforeEach(() => {
  __testOverrideLoadPendingControlRequestStore(() => ({ requests: [] }));
  __testOverrideSavePendingControlRequestStore(() => {});
  clearPendingControlRequestStore();
  __testOverrideLoadRoutes(() => null);
  __testOverrideSaveRoutes(() => {});
});

afterEach(() => {
  __testOverrideLoadPendingControlRequestStore(null);
  __testOverrideSavePendingControlRequestStore(null);
  clearPendingControlRequestStore();
  clearAllRoutes();
  __testOverrideLoadRoutes(null);
  __testOverrideSaveRoutes(null);
});

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

function approvalResponses(client: FakeClient) {
  return client.submittedInputs
    .map(
      (input) =>
        input.payload as {
          kind?: string;
          request_id?: string;
          decision?: { behavior?: string; message?: string };
        },
    )
    .filter((payload) => payload.kind === "approval_response");
}

type Registry = Parameters<typeof createLocalApprovalRouting>[0]["registry"];

function setup(
  options: {
    registry?: Partial<Registry>;
    route?: () => ChannelTurnSource | null;
    timeoutMs?: number;
  } = {},
) {
  const client = new FakeClient();
  const logs: string[] = [];
  const cleared: string[] = [];
  const delivered: ChannelControlRequestEvent[] = [];
  const registry: Registry = {
    registerPendingControlRequest: async (event) => {
      delivered.push(event);
      return true;
    },
    resolveControlRequestSourceForScope: () => options.route?.() ?? null,
    clearPendingControlRequest: (requestId) => {
      cleared.push(requestId);
    },
    ...options.registry,
  };
  let gateway: ChannelGateway | null = null;
  const approvals = createLocalApprovalRouting({
    registry,
    submitApprovalResponse: (runtime, response) => {
      if (!gateway) throw new Error("gateway not started");
      return gateway.submitApprovalResponse(runtime, response);
    },
    logger: (message) => logs.push(message),
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
  });
  const { hooks } = makeHooks(approvals.hooks);
  gateway = new ChannelGateway(client, hooks);
  return {
    client,
    logs,
    cleared,
    delivered,
    approvals,
    gateway,
    close: () => {
      approvals.close();
      gateway?.close();
    },
  };
}

test("an approval no channel route can show is denied after the time limit", async () => {
  const ctx = setup();
  await ctx.gateway.registerRuntime(TEST_RUNTIME, []);
  ctx.client.emit(controlRequest("ctrl-nowhere"));
  await Bun.sleep(0);

  expect(approvalResponses(ctx.client)).toEqual([]);
  expect(
    ctx.logs.filter(
      (line) => line.includes("Warning") && line.includes("ctrl-nowhere"),
    ),
  ).toHaveLength(1);

  await Bun.sleep(TIMEOUT_MS * 3);
  const responses = approvalResponses(ctx.client);
  expect(responses).toHaveLength(1);
  expect(responses[0]?.request_id).toBe("ctrl-nowhere");
  expect(responses[0]?.decision?.behavior).toBe("deny");
  expect(responses[0]?.decision?.message).toContain(
    "could not be shown on any channel",
  );
  expect(ctx.client.submittedInputs[0]?.runtime).toEqual(TEST_RUNTIME);
  expect(ctx.cleared).toEqual(["ctrl-nowhere"]);
  ctx.close();
});

test("a replay of an approval still unseen keeps its first deadline", async () => {
  // Each re-registration replays the pending approval; that must neither push
  // the deadline out nor start a second clock.
  const ctx = setup({ timeoutMs: 100 });
  await ctx.gateway.registerRuntime(TEST_RUNTIME, []);
  ctx.client.emit(controlRequest("ctrl-replayed"));
  await Bun.sleep(60);
  ctx.client.emit(controlRequest("ctrl-replayed"));
  await Bun.sleep(70);
  expect(approvalResponses(ctx.client)).toHaveLength(1);
  await Bun.sleep(120);
  expect(approvalResponses(ctx.client)).toHaveLength(1);
  expect(
    ctx.logs.filter((line) => line.includes("denying it in")),
  ).toHaveLength(1);
  ctx.close();
});

test("a delivered approval is not denied, even one delivered after the route returns", async () => {
  const phone = makeSource({ chatId: "phone", chatType: "direct" });
  let route: ChannelTurnSource | null = phone;
  const ctx = setup({ route: () => route });
  await ctx.gateway.registerRuntime(TEST_RUNTIME, [phone]);

  ctx.client.emit(controlRequest("ctrl-shown"));
  route = null;
  ctx.client.emit(controlRequest("ctrl-later"));
  await Bun.sleep(0);
  // The route is back and the App Server replays the pending approval.
  route = phone;
  ctx.client.emit(controlRequest("ctrl-later"));
  await Bun.sleep(TIMEOUT_MS * 3);

  expect(ctx.delivered.map((event) => event.requestId)).toEqual([
    "ctrl-shown",
    "ctrl-later",
  ]);
  expect(approvalResponses(ctx.client)).toEqual([]);
  ctx.close();
});

test("an answered approval is not denied; a deny that loses the race is harmless", async () => {
  const ctx = setup();
  await ctx.gateway.registerRuntime(TEST_RUNTIME, []);
  ctx.client.emit(controlRequest("ctrl-answered"));
  await Bun.sleep(0);
  // Answered through the channel (a text reply in the DM, say).
  expect(
    await ctx.approvals.submitAnswer(TEST_RUNTIME, {
      request_id: "ctrl-answered",
      decision: { behavior: "allow" },
    }),
  ).toBe(true);
  await Bun.sleep(TIMEOUT_MS * 3);
  expect(
    approvalResponses(ctx.client).map((payload) => payload.decision?.behavior),
  ).toEqual(["allow"]);

  // Answered in another client the gateway cannot see: the deny still goes
  // out, the App Server rejects it, and nothing breaks.
  ctx.client.emit(controlRequest("ctrl-elsewhere"));
  await Bun.sleep(0);
  ctx.client.inputResponse = { accepted: false, disposition: "started" };
  await Bun.sleep(TIMEOUT_MS * 3);
  expect(
    approvalResponses(ctx.client).map((payload) => payload.request_id),
  ).toEqual(["ctrl-answered", "ctrl-elsewhere"]);
  expect(ctx.cleared).toEqual(["ctrl-elsewhere"]);
  expect(
    ctx.logs.some(
      (line) =>
        line.includes("ctrl-elsewhere") && line.includes("no longer pending"),
    ),
  ).toBe(true);
  ctx.close();
});

test("an approval card that fails to deliver is denied after the time limit", async () => {
  const registry = new ChannelRegistry();
  registry.registerAdapter({
    id: "telegram:acct-tg",
    channelId: "telegram",
    accountId: "acct-tg",
    name: "Telegram",
    start: async () => {},
    stop: async () => {},
    isRunning: () => true,
    sendMessage: async () => ({ messageId: "msg-1" }),
    sendDirectReply: async () => {},
    handleControlRequestEvent: async () => {
      throw new Error("Telegram API unreachable");
    },
  });
  addRoute("telegram", {
    accountId: "acct-tg",
    chatId: "7945451305",
    chatType: "direct",
    agentId: TEST_RUNTIME.agent_id,
    conversationId: TEST_RUNTIME.conversation_id,
    enabled: true,
    createdAt: "2026-11-01T00:00:00.000Z",
  });
  const ctx = setup({
    registry: {
      registerPendingControlRequest: (event) =>
        registry.registerPendingControlRequest(event),
      resolveControlRequestSourceForScope: (agentId, conversationId) =>
        registry.resolveControlRequestSourceForScope(agentId, conversationId),
      clearPendingControlRequest: (requestId) =>
        registry.clearPendingControlRequest(requestId),
    },
  });
  await ctx.gateway.registerRuntime(TEST_RUNTIME, []);
  ctx.client.emit(controlRequest("ctrl-card-failed"));
  await Bun.sleep(0);
  await Bun.sleep(0);

  expect(registry.hasPendingControlRequest("ctrl-card-failed")).toBe(true);
  expect(
    ctx.logs.filter(
      (line) => line.includes("Warning") && line.includes("ctrl-card-failed"),
    ),
  ).toHaveLength(1);
  expect(approvalResponses(ctx.client)).toEqual([]);

  await Bun.sleep(TIMEOUT_MS * 3);
  const responses = approvalResponses(ctx.client);
  expect(responses.map((payload) => payload.request_id)).toEqual([
    "ctrl-card-failed",
  ]);
  expect(responses[0]?.decision?.behavior).toBe("deny");
  expect(registry.hasPendingControlRequest("ctrl-card-failed")).toBe(false);
  ctx.close();
  await registry.stopAll();
});

test("the time limit defaults to 10 minutes and reads an env override", () => {
  expect(resolveUndeliveredApprovalTimeoutMs({})).toBe(10 * 60_000);
  expect(
    resolveUndeliveredApprovalTimeoutMs({
      LETTA_CHANNELS_UNDELIVERED_APPROVAL_TIMEOUT_MS: "90000",
    }),
  ).toBe(90_000);
  for (const bad of ["", "0", "-5", "soon"]) {
    expect(
      resolveUndeliveredApprovalTimeoutMs({
        LETTA_CHANNELS_UNDELIVERED_APPROVAL_TIMEOUT_MS: bad,
      }),
    ).toBe(10 * 60_000);
  }
});

test("the denial says how long the approval went unseen", () => {
  expect(undeliveredApprovalDenialMessage(10 * 60_000)).toBe(
    "Approval could not be shown on any channel for 10 minutes; denied so the turn can continue.",
  );
  expect(undeliveredApprovalDenialMessage(60_000)).toContain("for 1 minute;");
  expect(undeliveredApprovalDenialMessage(30)).toContain("for 30 ms;");
});
