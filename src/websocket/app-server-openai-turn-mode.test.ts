import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  __testOverrideLoadChannelAccounts,
  clearChannelAccountStores,
  LEGACY_CHANNEL_ACCOUNT_ID,
} from "@/channels/accounts";
import { __testOverrideLoadRoutes, clearAllRoutes } from "@/channels/routing";
import { getLocalChannelTeleportError } from "@/channels/teleport-guard";
import type { ChannelAccount, ChannelRoute } from "@/channels/types";
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

const PHONE_ACCOUNT = {
  channel: "telegram",
  accountId: LEGACY_CHANNEL_ACCOUNT_ID,
  enabled: true,
  token: "test-token",
  binding: { agentId: "agent-1", conversationId: null },
  dmPolicy: "pairing",
  allowedUsers: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
} satisfies ChannelAccount;

let routes: ChannelRoute[] = [];
let accounts: ChannelAccount[] = [];

beforeEach(() => {
  routes = [];
  accounts = [PHONE_ACCOUNT];
  __testOverrideLoadRoutes((channelId) =>
    channelId === "telegram" ? routes : [],
  );
  __testOverrideLoadChannelAccounts((channelId) =>
    channelId === "telegram" ? accounts : [],
  );
});

afterEach(() => {
  __testOverrideLoadRoutes(null);
  __testOverrideLoadChannelAccounts(null);
  clearAllRoutes();
  clearChannelAccountStores();
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

test("a route whose channel account is disabled or missing does not count as channel-routed", () => {
  // No gateway serves a disabled account, so its approvals could never be
  // shown; the bridge must behave as for an unrouted conversation.
  routes = [PHONE_ROUTE];
  accounts = [{ ...PHONE_ACCOUNT, enabled: false }];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-phone")).toBe(
    "unrestricted",
  );
  accounts = [];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-phone")).toBe(
    "unrestricted",
  );
  // Teleport still refuses to move the channel-bound conversation.
  expect(
    getLocalChannelTeleportError({
      agentId: "agent-1",
      conversationId: "conv-phone",
    }),
  ).toContain("bound to telegram");

  accounts = [
    { ...PHONE_ACCOUNT, enabled: false },
    { ...PHONE_ACCOUNT, accountId: "acct-phone" },
  ];
  routes = [{ ...PHONE_ROUTE, accountId: "acct-phone" }];
  expect(modeAfterBridgeTurn(createRuntime(), "conv-phone")).toBe("standard");
});
