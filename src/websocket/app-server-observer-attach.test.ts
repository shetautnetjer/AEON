import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { __testSetBackend, type AgentCreateBody } from "@/backend";
import { LocalBackend } from "@/backend/local";
import { resolveWorkspaceSandbox } from "@/permissions/workspace-sandbox";
import type { MessageQueueItem } from "@/queue/queue-runtime";
import { settingsManager } from "@/settings-manager";
import { type AppServerHandle, startAppServer } from "@/websocket/app-server";
import { requestApprovalOverWS } from "@/websocket/listener/approval";
import { getOrCreateScopedRuntime } from "@/websocket/listener/conversation-runtime";
import {
  getConversationWorkingDirectory,
  setConversationWorkingDirectory,
} from "@/websocket/listener/cwd";
import { getActiveRuntime } from "@/websocket/listener/runtime";

const oldMods = process.env.LETTA_DISABLE_MODS;
const oldCron = process.env.LETTA_DISABLE_CRON_SCHEDULER;
afterEach(() => {
  __testSetBackend(null);
  if (oldMods === undefined) delete process.env.LETTA_DISABLE_MODS;
  else process.env.LETTA_DISABLE_MODS = oldMods;
  if (oldCron === undefined) delete process.env.LETTA_DISABLE_CRON_SCHEDULER;
  else process.env.LETTA_DISABLE_CRON_SCHEDULER = oldCron;
});

function open(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function response(
  socket: WebSocket,
  id: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", read);
      reject(new Error(`Timed out waiting for ${id}`));
    }, 10_000);
    function read(raw: WebSocket.RawData) {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.request_id !== id) return;
      clearTimeout(timeout);
      socket.off("message", read);
      resolve(frame);
    }
    socket.on("message", read);
  });
}

test("observer attaches to an active conversation without changing its state", async () => {
  process.env.LETTA_DISABLE_MODS = "1";
  process.env.LETTA_DISABLE_CRON_SCHEDULER = "1";
  const storageDir = await mkdtemp(join(os.tmpdir(), "aeon-attach-"));
  let handle: AppServerHandle | undefined;
  let owner: WebSocket | undefined;
  let observer: WebSocket | undefined;
  try {
    const backend = new LocalBackend({
      storageDir,
      executionMode: "deterministic",
      memfsEnabled: false,
    });
    __testSetBackend(backend);
    const agent = await backend.createAgent({
      name: "Attach fixture",
      model: "anthropic/claude-sonnet-4-6",
    } as AgentCreateBody);
    await settingsManager.initialize();
    settingsManager.setMemfsEnabled(agent.id, false);
    handle = await startAppServer({ listen: "ws://127.0.0.1:0" });
    owner = new WebSocket(handle.controlUrl);
    const observed: Record<string, unknown>[] = [];
    await open(owner);
    const started = response(owner, "start-owner");
    owner.send(
      JSON.stringify({
        type: "runtime_start",
        request_id: "start-owner",
        agent_id: agent.id,
        create_conversation: {
          body: { summary: "Attach fixture", tags: ["fixture-tag"] },
        },
        recover_approvals: false,
        wait_for_replay: true,
      }),
    );
    const start = await started;
    expect(start.success).toBe(true);
    const scope = start.runtime as {
      agent_id: string;
      conversation_id: string;
    };
    const listener = getActiveRuntime();
    if (!listener) throw new Error("Expected active server");
    const runtime = getOrCreateScopedRuntime(
      listener,
      scope.agent_id,
      scope.conversation_id,
    );
    setConversationWorkingDirectory(
      listener,
      scope.agent_id,
      scope.conversation_id,
      storageDir,
    );
    runtime.skillSources = ["agent"];
    runtime.workspaceSandbox = resolveWorkspaceSandbox({
      root: storageDir,
      isolationRoot: os.tmpdir(),
    });
    const sandbox = runtime.workspaceSandbox;
    const queued = runtime.queueRuntime.enqueue({
      kind: "message",
      source: "user",
      content: "queued fixture",
      agentId: scope.agent_id,
      conversationId: scope.conversation_id,
    } as Omit<MessageQueueItem, "id" | "enqueuedAt">);
    expect(queued).not.toBeNull();
    const lease = runtime.turnLifecycle.begin({
      origin: "message",
      workingDirectory: storageDir,
      initialStatus: "WAITING_ON_APPROVAL",
    });
    const ownerConnection = listener.connections.get("app-server-0");
    if (!ownerConnection) throw new Error("Expected owner connection");
    const approval = requestApprovalOverWS(
      runtime,
      ownerConnection.writer,
      lease,
      "fixture-approval",
      {
        type: "control_request",
        request_id: "fixture-approval",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: {},
          tool_call_id: "fixture-call",
          permission_suggestions: [],
          blocked_path: null,
        },
      },
    );
    void approval.catch(() => {});
    const other = await backend.createConversation({ agent_id: agent.id });
    observer = new WebSocket(handle.controlUrl);
    observer.on("message", (raw) =>
      observed.push(JSON.parse(String(raw)) as Record<string, unknown>),
    );
    await open(observer);
    const unrelatedSync = response(observer, "unrelated-sync");
    observer.send(
      JSON.stringify({
        type: "sync",
        request_id: "unrelated-sync",
        runtime: { agent_id: agent.id, conversation_id: other.id },
        recover_approvals: false,
        resume_interrupted_turn: false,
      }),
    );
    expect((await unrelatedSync).success).toBe(true);
    expect(
      observed.some(
        (frame) =>
          frame.type === "control_request" &&
          frame.request_id === "fixture-approval",
      ),
    ).toBe(false);
    expect(runtime.pendingApprovalResolvers.size).toBe(1);
    const retrieval = response(observer, "retrieve-existing");
    observer.send(
      JSON.stringify({
        type: "conversation_retrieve",
        request_id: "retrieve-existing",
        conversation_id: scope.conversation_id,
      }),
    );
    const retrieved = await retrieval;
    expect(retrieved.success).toBe(true);
    expect(retrieved.conversation).toMatchObject({
      id: scope.conversation_id,
      agent_id: scope.agent_id,
    });
    const synced = response(observer, "observer-sync");
    observer.send(
      JSON.stringify({
        type: "sync",
        request_id: "observer-sync",
        runtime: scope,
        recover_approvals: false,
        resume_interrupted_turn: false,
        force_device_status: true,
      }),
    );
    expect((await synced).success).toBe(true);
    expect(
      observed.some(
        (frame) =>
          frame.type === "control_request" &&
          frame.request_id === "fixture-approval",
      ),
    ).toBe(true);
    expect(
      observed.some(
        (frame) =>
          frame.type === "update_queue" &&
          Array.isArray(frame.queue) &&
          frame.queue.length === 1,
      ),
    ).toBe(true);
    expect(
      observed.some(
        (frame) =>
          frame.type === "update_loop_status" &&
          (frame.loop_status as { status?: string })?.status ===
            "WAITING_ON_APPROVAL",
      ),
    ).toBe(true);
    expect(runtime.turnLifecycle.currentLease).toBe(lease);
    expect(runtime.queueRuntime.length).toBe(1);
    expect(runtime.skillSources).toEqual(["agent"]);
    expect(runtime.workspaceSandbox).toBe(sandbox);
    expect(
      getConversationWorkingDirectory(
        listener,
        scope.agent_id,
        scope.conversation_id,
      ),
    ).toBe(storageDir);
    expect(
      (
        (await backend.retrieveConversation(scope.conversation_id)) as {
          tags?: string[];
        }
      ).tags,
    ).toContain("fixture-tag");
    observer.close();
    await new Promise<void>((resolve) =>
      observer?.once("close", () => resolve()),
    );
    for (let i = 0; i < 100 && listener.connections.size !== 1; i++) {
      await Bun.sleep(10);
    }
    expect(listener.connections.size).toBe(1);
    expect(runtime.turnLifecycle.currentLease).toBe(lease);
    expect(runtime.pendingApprovalResolvers.size).toBe(1);
  } finally {
    owner?.terminate();
    observer?.terminate();
    await handle?.close();
    await rm(storageDir, { recursive: true, force: true });
  }
}, 30_000);
