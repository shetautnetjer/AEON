/** Offline child used only by attached-ui-pty.test.ts. */
import { render } from "ink";
import { settingsManager } from "@/settings-manager";
import type { WsProtocolMessage } from "@/types/protocol_v2";
import { AttachedApp } from "./AttachedApp";
import type { AttachedSession, AttachedSnapshot } from "./attached-session";

await settingsManager.initialize();
let snapshot = {
  scope: { agentId: "agent-pty", conversationId: "conversation-pty" },
  agent: null,
  history: [],
  generation: 1,
  loopStatus: { status: "WAITING_ON_INPUT", executing_tool_call_ids: [] },
  deviceStatus: null,
  queue: [],
  pendingApprovals: [
    {
      identity: { requestId: "pty-request", generation: 1 },
      frame: {
        type: "control_request",
        request_id: "pty-request",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          tool_call_id: "pty-tool",
          input: { command: "echo PTY-APPROVAL", flag: true },
          permission_suggestions: [],
          blocked_path: null,
        },
      },
    },
  ],
  pendingOwn: [],
  activeOwn: [],
  connection: "connected",
} as unknown as AttachedSnapshot;
const subscribers = new Set<() => void>();
let onFrame: ((frame: WsProtocolMessage) => void) | undefined;
const session = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
  onFrame: (listener: (frame: WsProtocolMessage) => void) => {
    onFrame = listener;
    return () => {
      onFrame = undefined;
    };
  },
  close() {},
  answerApproval: async () => {},
} as unknown as AttachedSession;
const instance = render(<AttachedApp session={session} />, {
  exitOnCtrlC: false,
});
setTimeout(() => {
  snapshot = { ...snapshot, pendingApprovals: [] };
  for (const listener of subscribers) listener();
  onFrame?.({
    type: "stream_delta",
    delta: {
      type: "message",
      message_type: "reasoning_message",
      id: "pty-reason",
      reasoning: "PTY-THINKING",
    },
  } as unknown as WsProtocolMessage);
}, 350);
setTimeout(() => {
  onFrame?.({
    type: "stream_delta",
    delta: {
      type: "message",
      message_type: "assistant_message",
      id: "pty-assistant",
      content: "PTY-RESPONSE",
    },
  } as unknown as WsProtocolMessage);
}, 650);
setTimeout(() => {
  instance.unmount();
  instance.cleanup();
}, 1000);
await instance.waitUntilExit();
