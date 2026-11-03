import type {
  ApprovalResponseBody,
  RuntimeScope,
} from "@/types/app-server-protocol";
import type { ChannelGatewayHooks } from "./gateway-core";
import type {
  ChannelControlRequestEvent,
  ChannelStartupLogger,
  ChannelTurnSource,
} from "./types";

const TIMEOUT_ENV = "LETTA_CHANNELS_UNDELIVERED_APPROVAL_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** 10 minutes, or LETTA_CHANNELS_UNDELIVERED_APPROVAL_TIMEOUT_MS when > 0. */
export function resolveUndeliveredApprovalTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env[TIMEOUT_ENV]);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

function describeDuration(ms: number): string {
  const [amount, unit] =
    ms % 60_000 === 0
      ? [ms / 60_000, "minute"]
      : ms % 1000 === 0
        ? [ms / 1000, "second"]
        : [ms, "ms"];
  return unit === "ms" || amount === 1
    ? `${amount} ${unit}`
    : `${amount} ${unit}s`;
}

/** The reason the agent sees when an unseen approval times out. */
export function undeliveredApprovalDenialMessage(timeoutMs: number): string {
  return `Approval could not be shown on any channel for ${describeDuration(timeoutMs)}; denied so the turn can continue.`;
}

/** The registry members the local approval hooks use. */
interface ApprovalRegistry {
  registerPendingControlRequest(
    event: ChannelControlRequestEvent,
  ): Promise<boolean>;
  resolveControlRequestSourceForScope(
    agentId: string,
    conversationId: string,
  ): ChannelTurnSource | null;
  clearPendingControlRequest(requestId: string): void;
}

/**
 * Control-request hooks for the local channel gateway, with a time limit on
 * approvals nobody can see: one no channel route can show
 * (`onUndeliverableControlRequest`) or whose card failed to deliver. If such
 * an approval is neither delivered nor answered through the gateway within the
 * limit, it is denied through the normal approval-response path so the turn
 * can continue.
 *
 * The gateway cannot see answers from other clients (TUI, aya-chat). If one
 * answers first, the late deny names a request that is no longer pending; the
 * App Server rejects it and nothing changes.
 */
export function createLocalApprovalRouting(options: {
  registry: ApprovalRegistry;
  submitApprovalResponse(
    runtime: RuntimeScope,
    response: ApprovalResponseBody,
  ): Promise<boolean>;
  logger?: ChannelStartupLogger;
  timeoutMs?: number;
}): {
  hooks: Pick<
    ChannelGatewayHooks,
    | "onControlRequest"
    | "resolveUnroutedControlSource"
    | "onUndeliverableControlRequest"
  >;
  /** Submit a channel answer; it stops the request's clock. */
  submitAnswer(
    runtime: RuntimeScope,
    response: ApprovalResponseBody,
  ): Promise<boolean>;
  close(): void;
} {
  const { registry, logger } = options;
  const timeoutMs = options.timeoutMs ?? resolveUndeliveredApprovalTimeoutMs();
  const limit = describeDuration(timeoutMs);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancel = (requestId: string): void => {
    clearTimeout(timers.get(requestId));
    timers.delete(requestId);
  };

  const expire = async (
    requestId: string,
    runtime: RuntimeScope,
    where: string,
  ): Promise<void> => {
    timers.delete(requestId);
    try {
      const denied = await options.submitApprovalResponse(runtime, {
        request_id: requestId,
        decision: {
          behavior: "deny",
          message: undeliveredApprovalDenialMessage(timeoutMs),
        },
      });
      logger?.(
        denied
          ? `[ChannelGateway] Warning: denied approval ${where}; no channel showed it for ${limit}`
          : `[ChannelGateway] Approval ${where} was no longer pending after ${limit}; nothing denied`,
      );
    } catch (error) {
      logger?.(
        `[ChannelGateway] Warning: could not deny unseen approval ${where}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    registry.clearPendingControlRequest(requestId);
  };

  /** A request already on the clock keeps its first deadline. */
  const start = (
    requestId: string,
    runtime: RuntimeScope,
    reason: string,
  ): void => {
    if (timers.has(requestId)) return;
    const where = `${requestId} (${runtime.agent_id}:${runtime.conversation_id})`;
    logger?.(
      `[ChannelGateway] Warning: ${reason} for approval ${where}; denying it in ${limit} unless it is delivered or answered`,
    );
    timers.set(
      requestId,
      setTimeout(() => void expire(requestId, runtime, where), timeoutMs),
    );
  };

  return {
    hooks: {
      resolveUnroutedControlSource: (runtime) =>
        registry.resolveControlRequestSourceForScope(
          runtime.agent_id,
          runtime.conversation_id,
        ),
      onUndeliverableControlRequest: (requestId, runtime) =>
        start(requestId, runtime, "no channel route can show it"),
      onControlRequest: async (event) => {
        cancel(event.requestId);
        if (await registry.registerPendingControlRequest(event)) return;
        start(
          event.requestId,
          {
            agent_id: event.source.agentId,
            conversation_id: event.source.conversationId,
          },
          `the ${event.source.channel} approval card failed to deliver`,
        );
      },
    },
    submitAnswer: async (runtime, response) => {
      const accepted = await options.submitApprovalResponse(runtime, response);
      cancel(response.request_id);
      return accepted;
    },
    close: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
