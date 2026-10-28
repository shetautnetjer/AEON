import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearChannelAccountStores,
  upsertChannelAccount,
} from "@/channels/accounts";
import { __testOverrideChannelsRoot } from "@/channels/config";
import type { ChannelInboundDelivery } from "@/channels/registry-handlers";
import { createChannelInboundRouter } from "@/channels/registry-inbound";
import { addRoute } from "@/channels/routing";
import type { ChannelAdapter, InboundChannelMessage } from "@/channels/types";

// A user-installed channel plugin (not first-party) must not inherit the process-wide
// "unrestricted" default: its turns use the account's `default_permission_mode`, else "standard",
// so tool approval prompts reach the channel.
let root: string | null = null;

function account(config: Record<string, unknown>) {
  upsertChannelAccount("aya-phone", {
    channel: "aya-phone",
    accountId: "acct",
    displayName: "Aya phone",
    enabled: true,
    dmPolicy: "allowlist",
    allowedUsers: ["khamani"],
    binding: { agentId: "agent-1", conversationId: "conv-1" },
    config,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
  } as never);
  addRoute("aya-phone", {
    accountId: "acct",
    chatId: "phone",
    agentId: "agent-1",
    conversationId: "conv-1",
    enabled: true,
  } as never);
}

async function deliverOnce(): Promise<ChannelInboundDelivery> {
  const delivered: ChannelInboundDelivery[] = [];
  const adapter = {
    id: "aya-phone:acct",
    channelId: "aya-phone",
    accountId: "acct",
    name: "Aya phone",
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    sendMessage: async () => ({ messageId: "m1" }),
    sendDirectReply: async () => {},
  } as unknown as ChannelAdapter;
  const router = createChannelInboundRouter({
    controls: { tryHandleInbound: async () => false } as never,
    commands: { shouldDropUnroutedSlackThreadInput: () => false } as never,
    routes: {} as never,
    getAdapter: () => adapter,
    dispatchTurnLifecycleEvent: async () => {},
    deliver: (d) => delivered.push(d),
    emitEvent: () => {},
  });
  const msg: InboundChannelMessage = {
    channel: "aya-phone",
    accountId: "acct",
    chatId: "phone",
    senderId: "khamani",
    text: "hello",
    timestamp: Date.now(),
  };
  await router.handleInboundMessage(msg);
  expect(delivered).toHaveLength(1);
  return delivered[0] as ChannelInboundDelivery;
}

describe("custom channel permission mode", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aeon-channel-perm-"));
    __testOverrideChannelsRoot(root);
    clearChannelAccountStores();
  });
  afterEach(() => {
    clearChannelAccountStores();
    __testOverrideChannelsRoot(null);
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  test("defaults to standard so approvals are asked", async () => {
    account({});
    expect((await deliverOnce()).defaultPermissionMode).toBe("standard");
  });

  test("honors default_permission_mode from the account config", async () => {
    account({ default_permission_mode: "acceptEdits" });
    expect((await deliverOnce()).defaultPermissionMode).toBe("acceptEdits");
  });

  test("an unknown mode falls back to standard, never unrestricted", async () => {
    account({ default_permission_mode: "yolo" });
    expect((await deliverOnce()).defaultPermissionMode).toBe("standard");
  });
});
