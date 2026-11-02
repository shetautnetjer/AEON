import type { RuntimeScope } from "@/types/app-server-protocol";
import { sourceRouteKey } from "./gateway-sources";
import type { ChannelTurnSource } from "./types";

export type ControlRequestRouting =
  | { kind: "deliver"; source: ChannelTurnSource }
  /** The active turn spans several chats; the gateway does not pick one. */
  | { kind: "ambiguous" }
  /** No route can deliver the request; the gateway leaves it pending. */
  | { kind: "undeliverable" };

function singleChat(
  sources: readonly ChannelTurnSource[],
): ChannelTurnSource | null | "several" {
  const scopes = new Map(
    sources.map((source) => [sourceRouteKey(source), source]),
  );
  if (scopes.size > 1) return "several";
  return [...scopes.values()][0] ?? null;
}

/**
 * Decide where a channel gateway sends a control request (tool approval).
 *
 * - A turn a channel message started routes to that message's chat. If the
 *   turn spans several chats it stays undelivered, as before.
 * - A turn no channel message started (task notification, cron, mod
 *   continuation, OpenAI-compat bridge turn) has no routing source, so it
 *   falls back to the conversation's bound route: the host's choice when the
 *   host resolves one (the local gateway picks the most recently created
 *   enabled route), otherwise the runtime's routed sources when they name a
 *   single chat.
 * - With no deliverable route the result is `undeliverable`. The gateway
 *   leaves the request pending; see `routeControlRequest`.
 */
export function resolveControlRequestRouting(options: {
  activeSources: readonly ChannelTurnSource[];
  routedSources: readonly ChannelTurnSource[];
  resolveFallback?: (
    routedSources: ChannelTurnSource[],
  ) => ChannelTurnSource | null;
}): ControlRequestRouting {
  const active = singleChat(options.activeSources);
  if (active === "several") return { kind: "ambiguous" };
  if (active) return { kind: "deliver", source: active };

  if (options.resolveFallback) {
    const source = options.resolveFallback([...options.routedSources]);
    return source ? { kind: "deliver", source } : { kind: "undeliverable" };
  }
  const routed = singleChat(options.routedSources);
  if (routed === "several") return { kind: "ambiguous" };
  return routed
    ? { kind: "deliver", source: routed }
    : { kind: "undeliverable" };
}

/** The `ChannelGatewayHooks` members control-request routing consults. */
interface ControlRequestRoutingHooks {
  resolveUnroutedControlSource?(
    runtime: RuntimeScope,
    routedSources: ChannelTurnSource[],
  ): ChannelTurnSource | null;
  debugLog?(message: string): void;
}

/**
 * Resolve a control request's channel source for the gateway. Returns the
 * source to deliver to, or null after logging a request it cannot deliver.
 *
 * An undeliverable request is not denied: the gateway is a separate App Server
 * client and cannot see whether another client (the TUI, aya-chat) is
 * subscribed to the conversation and can answer it. The App Server keeps the
 * request pending, and every runtime_start with recover_approvals replays it.
 * Clearing the conversation's registration signature makes the gateway's next
 * registration (route refresh, channel message) run runtime_start again, so a
 * route that becomes deliverable later receives the request.
 */
export function routeControlRequest(options: {
  requestId: string;
  runtime: RuntimeScope;
  activeSources: readonly ChannelTurnSource[];
  routedSources: readonly ChannelTurnSource[];
  hooks: ControlRequestRoutingHooks;
  registration: { registrationSignature: string | null };
}): ChannelTurnSource | null {
  const { hooks, requestId, runtime } = options;
  const routing = resolveControlRequestRouting({
    activeSources: options.activeSources,
    routedSources: options.routedSources,
    ...(hooks.resolveUnroutedControlSource
      ? {
          resolveFallback: (routed: ChannelTurnSource[]) =>
            hooks.resolveUnroutedControlSource?.(runtime, routed) ?? null,
        }
      : {}),
  });
  if (routing.kind === "deliver") return routing.source;

  const where = `${requestId} (${runtime.agent_id}:${runtime.conversation_id})`;
  if (routing.kind === "ambiguous") {
    hooks.debugLog?.(`Control request ${where} spans several chats`);
    return null;
  }
  hooks.debugLog?.(
    `No channel route for control request ${where}; leaving it pending for other clients`,
  );
  options.registration.registrationSignature = null;
  return null;
}
