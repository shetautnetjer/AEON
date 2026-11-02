import type {
  RuntimeExternalToolsUpdateGroup,
  RuntimeScope,
} from "@/types/app-server-protocol";
import type { ChannelGateway } from "./gateway-core";
import type { ChannelStartupLogger, ChannelTurnSource } from "./types";

type RoutedRuntimeSources = Array<{
  runtime: RuntimeScope;
  sources: ChannelTurnSource[];
}>;

type RouteSubscriptionGateway = Pick<
  ChannelGateway,
  | "getKnownRuntimes"
  | "updateRoutedRuntimeTools"
  | "registerRuntime"
  | "releaseRuntimeTools"
>;

function runtimeKey(runtime: RuntimeScope): string {
  return `${runtime.agent_id}:${runtime.conversation_id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publisher for the routed-runtime refresher that also keeps the gateway
 * subscribed to every conversation with a deliverable channel route (enabled,
 * outbound-enabled, on a running adapter).
 *
 * The App Server sends a conversation's control requests (tool approvals) only
 * to connections subscribed to it. Publishing tools with
 * runtime_external_tools_update does not subscribe; runtime_start does. So
 * after a restart, a routed conversation with no channel message yet would
 * never show the gateway the approvals of its turns that no channel message
 * started (bridge, cron, task notifications).
 *
 * After each tool update this registers each routed conversation the gateway
 * has not registered yet, through the same runtime_start a channel message
 * uses (recover_approvals, so pending approvals replay). It passes no
 * permission mode, so subscribing never changes a conversation's mode, and
 * sends no input. When a conversation it subscribed loses its last route it is
 * released through the gateway's idle-runtime cleanup: the gateway stops
 * tracking it and drops its tools. The App Server has no unsubscribe, so the
 * connection stays subscribed until it closes; the gateway ignores control
 * requests for conversations it does not track.
 *
 * Registrations are queued on the gateway in order right after the tool update
 * but not awaited, so gateway startup does not wait for one runtime_start per
 * routed conversation. Failures are logged and retried on the next refresh.
 */
export function createRoutedRuntimePublisher(options: {
  gateway: RouteSubscriptionGateway;
  logger?: ChannelStartupLogger;
}): {
  getKnownRuntimes(): RuntimeScope[];
  publish(
    updates: readonly RuntimeExternalToolsUpdateGroup[],
    routedSources: RoutedRuntimeSources,
  ): Promise<void>;
  /** Resolves once the latest subscriptions and releases have settled. */
  settled(): Promise<void>;
} {
  const { gateway, logger } = options;
  const subscribed = new Set<string>();
  let latest: Promise<void> = Promise.resolve();

  // Every registration and release is queued on the gateway before the first
  // await, so they keep their place right after the tool update.
  const subscribe = async (
    routedSources: RoutedRuntimeSources,
  ): Promise<void> => {
    const tasks: Promise<void>[] = [];
    for (const { runtime, sources } of routedSources) {
      const key = runtimeKey(runtime);
      if (sources.length > 0) {
        const registration = gateway.registerRuntime(
          runtime,
          sources,
          undefined,
          { ifUnregistered: true },
        );
        tasks.push(
          registration.then(
            (registered) => {
              if (registered) subscribed.add(key);
            },
            (error) => {
              logger?.(
                `[ChannelGateway] Failed to subscribe to routed conversation ${key}; retrying on the next route refresh: ${errorMessage(error)}`,
              );
            },
          ),
        );
      } else if (subscribed.has(key)) {
        const release = gateway.releaseRuntimeTools(runtime, [], {
          cleanupIdleRuntime: true,
        });
        tasks.push(
          release.then(
            () => {
              subscribed.delete(key);
            },
            (error) => {
              logger?.(
                `[ChannelGateway] Could not release unrouted conversation ${key} yet; retrying on the next route refresh: ${errorMessage(error)}`,
              );
            },
          ),
        );
      }
    }
    await Promise.all(tasks);
  };

  return {
    getKnownRuntimes: () => gateway.getKnownRuntimes(),
    publish: async (updates, routedSources) => {
      await gateway.updateRoutedRuntimeTools(updates, routedSources);
      latest = subscribe(routedSources);
    },
    settled: () => latest,
  };
}
