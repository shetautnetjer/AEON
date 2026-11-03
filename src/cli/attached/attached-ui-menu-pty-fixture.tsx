/** Fake-protocol process for attached-ui-menu-pty.test.ts. */
import { render } from "ink";
import { settingsManager } from "@/settings-manager";
import { AttachedApp } from "./AttachedApp";
import type { AttachedSession, AttachedSnapshot } from "./attached-session";

await settingsManager.initialize();
const snapshot = {
  scope: { agentId: "agent-pty", conversationId: "conversation-pty" },
  agent: null,
  history: [],
  generation: 1,
  loopStatus: {
    status: "WAITING_ON_INPUT",
    active_run_ids: [],
    executing_tool_call_ids: [],
  },
  deviceStatus: {
    device_status: {
      current_permission_mode: "standard",
      supported_commands: [],
    },
  },
  queue: [],
  pendingApprovals: [],
  pendingOwn: [],
  uncertainOwn: [],
  inputDisplayById: {},
  activeOwn: [],
  connection: "connected",
} as unknown as AttachedSnapshot;
const listeners = new Set<(frame: unknown) => void>();
const client = {
  onMessage: (listener: (frame: unknown) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  nextRequestId: () => "memory-1",
  conversationList: async () => ({
    success: true,
    conversations: [
      {
        id: "conversation-result",
        agent_id: "agent-pty",
        summary: "Session result",
      },
    ],
  }),
  request: async (request: unknown) => {
    if (request === "list_models")
      return {
        success: true,
        entries: [
          { id: "model-result", label: "Model result", handle: "fake/model" },
        ],
      };
    if (
      request &&
      typeof request === "object" &&
      "type" in request &&
      request.type === "list_memory"
    ) {
      const response = {
        type: "list_memory_response",
        request_id: "memory-1",
        success: true,
        done: true,
        entries: [
          {
            relative_path: "memory-result.md",
            content: "Memory result",
            description: "Memory file",
          },
        ],
        memfs_enabled: true,
      };
      for (const listener of listeners) listener(response);
      return response;
    }
    throw new Error("Unexpected fake-protocol request");
  },
};
const session = {
  client,
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  onFrame: () => () => {},
  close() {},
  interrupt: async () => false,
} as unknown as AttachedSession;
const instance = render(<AttachedApp session={session} />, {
  exitOnCtrlC: false,
});
setTimeout(() => {
  instance.unmount();
  instance.cleanup();
}, 1600);
await instance.waitUntilExit();
