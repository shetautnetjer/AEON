import { getSupportedChannelIds } from "./plugin-registry";
import { readRoutes } from "./routing";

/**
 * Channels with an enabled, outbound-enabled route bound to this conversation
 * on this computer. Reads the persisted route files, so the answer does not
 * depend on which process loaded the route cache. Only device-owned routes
 * live here; Cloud-managed channels do not.
 */
export function getBoundLocalChannelIds(scope: {
  agentId: string;
  conversationId: string;
}): string[] {
  return getSupportedChannelIds().filter((channelId) =>
    readRoutes(channelId).some(
      (route) =>
        route.agentId === scope.agentId &&
        route.conversationId === scope.conversationId &&
        route.enabled !== false &&
        route.outboundEnabled !== false,
    ),
  );
}
