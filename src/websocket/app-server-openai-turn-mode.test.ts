import { afterEach, beforeEach, expect, test } from "bun:test";
import { __testOverrideLoadRoutes, clearAllRoutes } from "@/channels/routing";
import type { ChannelRoute } from "@/channels/types";
import { applyBridgePermissionMode } from "@/websocket/app-server-openai-turn";
import { createRuntime } from "@/websocket/listener/lifecycle";
import { getOrCreateConversationPermissionModeStateRef } from "@/websocket/listener/permission-mode";
import type { ListenerRuntime } from "@/websocket/listener/types";

// The OpenAI-compat bridge has no interactive approver, so it runs its
// conversations unrestricted. A conversation bound to a channel route (the
// phone thread) must keep its mode, or its approval cards silently stop.

const PHONE_ROUTE: ChannelRoute = {
  chatId: "7945451305",
  chatType: "direct",
  agentId: "agent-1",
  conversationId: "conv-phone",
  enabled: true,
  createdAt: "2026-11-01T00:00:00.000Z",
};

let routes: ChannelRoute[] = [];

beforeEach(() => {
  routes = [];
  __testOverrideLoadRoutes((channelId) =>
    channelId === "telegram" ? routes : [],
  );
});

afterEach(() => {
  __testOverrideLoadRoutes(null);
  clearAllRoutes();
});

function modeAfterBridgeTurn(
  listener: ListenerRuntime,
  conversationId: string,
): string {
  getOrCreateConversationPermissionModeStateRef(
    listener,
    "agent-1",
    conversationId,
  ).mode = "standard";
  applyBridgePermissionMode(listener, "agent-1", conversationId);
  return getOrCreateConversationPermissionModeStateRef(
    listener,
    "agent-1",
    conversationId,
  ).mode;
}

test("a bridge turn on a channel-routed conversation leaves its mode unchanged", () => {
  routes = [PHONE_ROUTE];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-phone")).toBe("standard");
});

test("a bridge turn on a conversation without a channel route still runs unrestricted", () => {
  routes = [PHONE_ROUTE];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-terminal")).toBe(
    "unrestricted",
  );
});

test("a route that cannot deliver approvals does not count as channel-routed", () => {
  routes = [
    { ...PHONE_ROUTE, enabled: false },
    { ...PHONE_ROUTE, chatId: "7945451306", outboundEnabled: false },
  ];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-phone")).toBe(
    "unrestricted",
  );
});
