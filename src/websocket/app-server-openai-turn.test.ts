import { afterEach, expect, test } from "bun:test";
import WebSocket from "ws";
import { createBridgeIncomingMessage } from "@/websocket/app-server-openai-turn";
import {
  getOrCreateProcessTransport,
  markListenerConnectionInitialized,
  openListenerConnection,
  subscribeListenerConnection,
} from "@/websocket/listener/connection";
import { handleAbortMessageInput } from "@/websocket/listener/control-inputs";
import { getOrCreateScopedRuntime } from "@/websocket/listener/conversation-runtime";
import { dispatchInboundMessageWhenReady } from "@/websocket/listener/inbound-dispatch";
import { createRuntime } from "@/websocket/listener/lifecycle";
import { scheduleQueuePump } from "@/websocket/listener/queue";
import { setActiveRuntime } from "@/websocket/listener/runtime";
import { finishListenerTurn } from "@/websocket/listener/turn-terminal";
import type {
  ConversationRuntime,
  IncomingMessage,
  ListenerRuntime,
  StartListenerOptions,
} from "@/websocket/listener/types";

class MockSocket {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  send(_payload: string): void {}
}

const OPTIONS = {
  connectionId: "openai-api",
  wsUrl: "",
  deviceId: "device-test",
  connectionName: "openai-api",
  onConnected: () => {},
  onDisconnected: () => {},
  onError: () => {},
} satisfies StartListenerOptions;

async function waitFor(predicate: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return true;
    await Bun.sleep(1);
  }
  return predicate();
}

function textOf(turn: IncomingMessage): string {
  return JSON.stringify(turn.messages);
}

/**
 * The daemon's shape: an app-server runtime whose only client (the channel
 * gateway) is subscribed to other conversations, not to the bridge's.
 */
function startDaemonLikeListener(): {
  listener: ListenerRuntime;
  runtime: ConversationRuntime;
} {
  const listener = createRuntime();
  setActiveRuntime(listener);
  openListenerConnection({
    runtime: listener,
    connectionId: "app-server-0",
    writer: new MockSocket() as unknown as WebSocket,
    options: { ...OPTIONS, connectionId: "app-server-0" },
  });
  markListenerConnectionInitialized(listener, "app-server-0");
  subscribeListenerConnection(listener, "app-server-0", {
    agent_id: "agent-1",
    conversation_id: "conv-other",
  });
  return {
    listener,
    runtime: getOrCreateScopedRuntime(listener, "agent-1", "conv-1"),
  };
}

function dispatchBridgeInput(
  listener: ListenerRuntime,
  runtime: ConversationRuntime,
  text: string,
  processed: IncomingMessage[],
): void {
  const processTurn = async (turn: IncomingMessage) => {
    processed.push(turn);
  };
  dispatchInboundMessageWhenReady({
    listener,
    runtime,
    incoming: createBridgeIncomingMessage({
      agentId: "agent-1",
      conversationId: "conv-1",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text }],
          otid: `otid-${text}`,
        },
      ],
    }),
    // Same transport the bridge passes: the process transport, not a client.
    socket: getOrCreateProcessTransport(listener),
    options: OPTIONS,
    processQueuedTurn: processTurn,
    processIncomingMessage: processTurn as never,
    trackListenerError: (_type, error) => {
      throw error;
    },
  });
}

afterEach(() => setActiveRuntime(null));

test("an OpenAI-compat input after an abort resumes the parked queue and runs", async () => {
  const { listener, runtime } = startDaemonLikeListener();
  const processed: IncomingMessage[] = [];

  // A turn is stuck (e.g. on an approval) while the phone sends a message.
  const lease = runtime.turnLifecycle.begin({
    origin: "message",
    workingDirectory: process.cwd(),
  });
  runtime.turnLifecycle.setRunId(lease, "run-stuck");
  dispatchBridgeInput(listener, runtime, "phone message", processed);
  expect(await waitFor(() => runtime.queueRuntime.length === 1)).toBe(true);

  // The user aborts it: the queued phone message parks.
  const socket = getOrCreateProcessTransport(listener);
  expect(
    await handleAbortMessageInput(
      listener,
      {
        command: {
          type: "abort_message",
          runtime: { agent_id: "agent-1", conversation_id: "conv-1" },
          run_id: "run-stuck",
        },
        socket,
        opts: OPTIONS,
        processQueuedTurn: async () => {},
      },
      { cancelRun: async () => {}, cancelConversation: async () => {} },
    ),
  ).toBe(true);
  finishListenerTurn(runtime, lease, {
    stopReason: "cancelled",
    socket,
    runId: "run-stuck",
    agentId: "agent-1",
    conversationId: "conv-1",
  });
  expect(await waitFor(() => runtime.turnLifecycle.kind === "idle")).toBe(true);
  expect(runtime.queueRuntime.pausedCount).toBe(1);
  expect(processed).toEqual([]);

  // `aeon say` sends a terminal message through the OpenAI-compat API.
  dispatchBridgeInput(listener, runtime, "terminal message", processed);

  expect(await waitFor(() => processed.length === 2)).toBe(true);
  expect(textOf(processed[0] as IncomingMessage)).toContain("phone message");
  expect(textOf(processed[1] as IncomingMessage)).toContain("terminal message");
  expect(runtime.queueRuntime.length).toBe(0);
  expect(runtime.queueRuntime.pausedCount).toBe(0);
});

test("a queued WebSocket client message still waits for a subscribed client", async () => {
  const { listener, runtime } = startDaemonLikeListener();
  const processed: IncomingMessage[] = [];
  const processQueuedTurn = async (turn: IncomingMessage) => {
    processed.push(turn);
  };
  const lease = runtime.turnLifecycle.begin({
    origin: "message",
    workingDirectory: process.cwd(),
  });
  dispatchInboundMessageWhenReady({
    listener,
    runtime,
    incoming: {
      type: "message",
      agentId: "agent-1",
      conversationId: "conv-1",
      messages: [{ role: "user", content: "client message" }],
    },
    socket: getOrCreateProcessTransport(listener),
    options: OPTIONS,
    processQueuedTurn,
    processIncomingMessage: (async () => {}) as never,
    trackListenerError: (_type, error) => {
      throw error;
    },
  });
  expect(await waitFor(() => runtime.queueRuntime.length === 1)).toBe(true);

  finishListenerTurn(runtime, lease, {
    stopReason: "end_turn",
    socket: getOrCreateProcessTransport(listener),
    agentId: "agent-1",
    conversationId: "conv-1",
  });
  expect(await waitFor(() => runtime.turnLifecycle.kind === "idle")).toBe(true);
  // The turn owner pumps the queue once the turn ends.
  scheduleQueuePump(
    runtime,
    getOrCreateProcessTransport(listener),
    OPTIONS,
    processQueuedTurn,
  );
  await waitFor(() => processed.length > 0);

  // Its echo and status need a live recipient, so it stays queued.
  expect(processed).toEqual([]);
  expect(runtime.queueRuntime.length).toBe(1);
});
