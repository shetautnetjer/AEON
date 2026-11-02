import type {
  ApprovalResponseBody,
  RuntimeScope,
} from "@/types/app-server-protocol";
import { sourceRouteKey } from "./gateway-sources";
import type { ChannelTurnSource } from "./types";

/**
 * Denial sent for a control request that no channel route can deliver. Without
 * it the listener turn would wait on an approval nobody can see.
 */
export const UNDELIVERABLE_CONTROL_REQUEST_MESSAGE =
  "Denied automatically: approval could not be delivered to any channel bound to this conversation, so nobody could answer it. Tell the user what you wanted to do instead.";

export type ControlRequestRouting =
  | { kind: "deliver"; source: ChannelTurnSource }
  /** The active turn spans several chats; the gateway does not pick one. */
  | { kind: "ambiguous" }
  /** No route can deliver the request; the gateway denies it. */
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
 * - With no deliverable route the result is `undeliverable` and the gateway
 *   denies the request rather than leave the turn waiting forever.
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
 * source to deliver to, or null after logging an ambiguous request or denying
 * an undeliverable one through `deny`.
 */
export function routeControlRequest(options: {
  requestId: string;
  runtime: RuntimeScope;
  activeSources: readonly ChannelTurnSource[];
  routedSources: readonly ChannelTurnSource[];
  hooks: ControlRequestRoutingHooks;
  deny: (response: ApprovalResponseBody) => Promise<boolean>;
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
  hooks.debugLog?.(`No channel route for control request ${where}; denying`);
  void options
    .deny({
      request_id: requestId,
      decision: {
        behavior: "deny",
        message: UNDELIVERABLE_CONTROL_REQUEST_MESSAGE,
      },
    })
    .then(
      (accepted) => {
        if (!accepted) hooks.debugLog?.(`Denial of ${where} was not accepted`);
      },
      (error: unknown) => {
        hooks.debugLog?.(`Denying ${where} failed: ${String(error)}`);
      },
    );
  return null;
}
