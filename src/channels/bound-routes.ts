import {
  isChannelAccountEnabledOnDisk,
  LEGACY_CHANNEL_ACCOUNT_ID,
} from "./accounts";
import { getSupportedChannelIds } from "./plugin-registry";
import { readRoutes } from "./routing";
import type { ChannelRoute } from "./types";

type ConversationScope = { agentId: string; conversationId: string };

function isBoundRoute(route: ChannelRoute, scope: ConversationScope): boolean {
  return (
    route.agentId === scope.agentId &&
    route.conversationId === scope.conversationId &&
    route.enabled !== false &&
    route.outboundEnabled !== false
  );
}

/**
 * Channels with an enabled, outbound-enabled route bound to this conversation
 * on this computer. Reads the persisted route files, so the answer does not
 * depend on which process loaded the route cache. Only device-owned routes
 * live here; Cloud-managed channels do not.
 */
export function getBoundLocalChannelIds(scope: ConversationScope): string[] {
  return getSupportedChannelIds().filter((channelId) =>
    readRoutes(channelId).some((route) => isBoundRoute(route, scope)),
  );
}

/**
 * Like `getBoundLocalChannelIds`, but only routes whose channel account is
 * enabled in accounts.json: a channel gateway starts only enabled accounts, so
 * a route on a disabled one can never show an approval. Whether the gateway
 * and the account's adapter are running is not visible from here; an approval
 * they cannot show is denied by the gateway's time limit
 * (gateway-approval-timeouts.ts). Teleport keeps the plain route check.
 */
export function getServedLocalChannelIds(scope: ConversationScope): string[] {
  return getSupportedChannelIds().filter((channelId) =>
    readRoutes(channelId).some(
      (route) =>
        isBoundRoute(route, scope) &&
        isChannelAccountEnabledOnDisk(
          channelId,
          route.accountId ?? LEGACY_CHANNEL_ACCOUNT_ID,
        ),
    ),
  );
}
