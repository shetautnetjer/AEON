import { afterEach, describe, expect, test } from "bun:test";
import type { AppServerSocketLike } from "@/app-server-client";
import { AttachedSession } from "./attached-session";

type Frame = Record<string, unknown> & {
  type: string;
  request_id: string;
  agent_id: string;
  conversation_id: string;
  runtime: { agent_id: string; conversation_id: string };
  terminal_consumer_id: string;
  payload: { messages: Array<{ client_message_id: string }> };
};
type Listener = (event: unknown) => void;

class FakeSocket implements AppServerSocketLike {
  static instances: FakeSocket[] = [];
  static hook?: (socket: FakeSocket, frame: Frame) => boolean;
  readyState = 1;
  sent: Frame[] = [];
  listeners = new Map<string, Set<Listener>>();
  constructor() {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, value: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
  receive(frame: unknown) {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
  send(data: string) {
    const frame = JSON.parse(data) as Frame;
    this.sent.push(frame);
    if (FakeSocket.hook?.(this, frame)) return;
    queueMicrotask(() => {
      const base = { request_id: frame.request_id, success: true };
      switch (frame.type) {
        case "conversation_retrieve":
          this.receive({
            ...base,
            type: "conversation_retrieve_response",
            conversation: { id: frame.conversation_id, agent_id: "aya" },
          });
          break;
        case "agent_retrieve":
          this.receive({
            ...base,
            type: "agent_retrieve_response",
            agent: { id: frame.agent_id },
          });
          break;
        case "sync":
          this.receive({
            ...base,
            type: "sync_response",
            runtime: frame.runtime,
          });
          break;
        case "conversation_messages_list":
          this.receive({
            ...base,
            type: "conversation_messages_list_response",
            messages: [],
            next_before: null,
            has_more: false,
          });
          break;
        case "input":
          this.receive({
            type: "input_accepted",
            request_id: frame.request_id,
            runtime: frame.runtime,
            accepted: true,
            disposition: "started",
          });
          break;
        case "abort_message":
          this.receive({
            ...base,
            type: "abort_message_response",
            runtime: frame.runtime,
            aborted: true,
          });
          break;
        case "runtime_start":
          this.receive({
            ...base,
            type: "runtime_start_response",
            runtime: { agent_id: frame.agent_id, conversation_id: "new" },
            agent: { id: frame.agent_id },
          });
          break;
        default:
          break;
      }
    });
  }
}

const runtime = { agent_id: "aya", conversation_id: "conv" };
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value");
  return value;
}
const envelope = {
  runtime,
  event_seq: 1,
  emitted_at: "2026-01-01T00:00:00Z",
  idempotency_key: "receipt",
};
const connect = () =>
  AttachedSession.connect({
    url: "ws://127.0.0.1/ws",
    agentId: "aya",
    conversationId: "conv",
    WebSocket: FakeSocket,
    requestTimeoutMs: 50,
    newId: () => "test-id",
  });

afterEach(() => {
  FakeSocket.instances = [];
  FakeSocket.hook = undefined;
});

describe("attached session", () => {
  test("an unresponsive or prematurely closed socket fails within a bound and is closed", async () => {
    class NeverOpenSocket extends FakeSocket {
      override readyState = 0;
    }
    await expect(
      AttachedSession.connect({
        url: "ws://127.0.0.1/ws",
        agentId: "aya",
        conversationId: "conv",
        WebSocket: NeverOpenSocket,
        requestTimeoutMs: 10,
      }),
    ).rejects.toThrow("timed out");
    expect(required(FakeSocket.instances[0]).readyState).toBe(3);
    const closing = AttachedSession.connect({
      url: "ws://127.0.0.1/ws",
      agentId: "aya",
      conversationId: "conv",
      WebSocket: NeverOpenSocket,
      requestTimeoutMs: 100,
    });
    required(FakeSocket.instances[1]).close();
    await expect(closing).rejects.toThrow("closed during connection");
  });
  test("first use starts a new agent conversation and replays early stream frames", async () => {
    FakeSocket.hook = (socket, frame) => {
      if (frame.type !== "runtime_start") return false;
      queueMicrotask(() => {
        const createdRuntime = { agent_id: "aya", conversation_id: "new" };
        socket.receive({
          ...envelope,
          runtime: createdRuntime,
          type: "stream_delta",
          delta: {
            type: "message",
            message_type: "assistant_message",
            content: "early",
          },
        });
        socket.receive({
          type: "runtime_start_response",
          request_id: frame.request_id,
          success: true,
          runtime: createdRuntime,
          agent: { id: "aya" },
        });
      });
      return true;
    };
    const session = await AttachedSession.connect({
      url: "ws://127.0.0.1/ws",
      agentId: "aya",
      title: "First",
      WebSocket: FakeSocket,
      requestTimeoutMs: 50,
    });
    const socket = required(FakeSocket.instances[0]);
    expect(session.getSnapshot().scope).toEqual({
      agentId: "aya",
      conversationId: "new",
    });
    expect(socket.sent[0]).toMatchObject({
      type: "runtime_start",
      agent_id: "aya",
      create_conversation: { body: { summary: "First" } },
      recover_approvals: false,
    });
    expect(socket.sent.some((f) => f.type === "conversation_retrieve")).toBe(
      false,
    );
    const seen: string[] = [];
    const diagnostics: string[] = [];
    session.onFrame((frame) => diagnostics.push(frame.type), {
      replayPending: false,
    });
    expect(diagnostics).toEqual([]);
    socket.receive({
      ...envelope,
      runtime: { agent_id: "aya", conversation_id: "new" },
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "assistant_message",
        content: "after diagnostics",
      },
    });
    expect(diagnostics).toEqual(["stream_delta"]);
    session.onFrame((frame) => seen.push(frame.type));
    expect(seen).toEqual(["stream_delta", "stream_delta"]);
    session.close();
  });
  test("attaches as an observer, validates identity, preserves stable snapshots, and closes only the socket", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    expect(socket.sent.map((f) => f.type)).toEqual([
      "conversation_retrieve",
      "agent_retrieve",
      "sync",
      "conversation_messages_list",
    ]);
    expect(socket.sent.find((f) => f.type === "sync")).toMatchObject({
      runtime,
      recover_approvals: false,
      resume_interrupted_turn: false,
    });
    expect(session.getSnapshot()).toBe(session.getSnapshot());
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    expect(Object.isFrozen(session.getSnapshot().scope)).toBe(true);
    const snapshot = session.getSnapshot();
    socket.receive({
      ...envelope,
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "assistant_message",
        content: "hello",
      },
    });
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.getSnapshot().scope).toEqual({
      agentId: "aya",
      conversationId: "conv",
    });
    session.close();
    expect(socket.readyState).toBe(3);
    expect(socket.sent.some((f) => f.type === "abort_message")).toBe(false);
  });

  test("tracks exact owner IDs, ignores foreign receipts, ACKs owned runless completions, and targets own run when interrupting", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    const id = await session.submit("hello");
    const input = required(socket.sent.find((f) => f.type === "input"));
    expect(input.terminal_consumer_id).toBe(id);
    expect(input.payload.messages[0]?.client_message_id).toBe(id);
    expect(await session.interrupt()).toBe(false);
    socket.receive({
      ...envelope,
      type: "update_loop_status",
      loop_status: {
        status: "WAITING_FOR_API_RESPONSE",
        active_run_ids: ["run"],
        client_message_ids_by_run_id: { run: [id] },
        executing_tool_call_ids: [],
      },
    });
    expect(await session.interrupt()).toBe(true);
    expect(socket.sent.find((f) => f.type === "abort_message")?.run_id).toBe(
      "run",
    );
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "foreign",
      stop_reason: "end_turn",
      terminal_consumer_ids: ["someone-else"],
    });
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "own",
      stop_reason: "end_turn",
      terminal_consumer_ids: ["someone-else", id],
    });
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    expect(
      socket.sent
        .filter((f) => f.type === "turn_finished_ack")
        .map((f) => f.consumer_id),
    ).toEqual([id]);
    session.close();
  });

  test("display text for an expanded prompt is registered before send and never put on the wire", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    let observed: string | undefined;
    FakeSocket.hook = (_s, frame) => {
      if (frame.type === "input")
        observed =
          session.getSnapshot().inputDisplayById[frame.terminal_consumer_id];
      return false;
    };
    const id = await session.submit("private expanded prompt", {
      displayText: "/skill task",
    });
    expect(observed).toBe("/skill task");
    expect(session.getSnapshot().inputDisplayById[id]).toBe("/skill task");
    const sent = required(socket.sent.find((frame) => frame.type === "input"));
    expect(JSON.stringify(sent)).not.toContain("/skill task");
    session.close();
  });

  test("an unacknowledged submission blocks later sends until exact terminal evidence", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    FakeSocket.hook = (_socket, frame) => frame.type === "input";
    await expect(session.submit("do work")).rejects.toThrow(
      "delivery is uncertain",
    );
    const id = required(session.getSnapshot().pendingOwn[0]);
    expect(session.getSnapshot().uncertainOwn).toEqual([id]);
    const count = socket.sent.filter((frame) => frame.type === "input").length;
    await expect(session.submit("retry")).rejects.toThrow("uncertain");
    expect(socket.sent.filter((frame) => frame.type === "input")).toHaveLength(
      count,
    );
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "foreign",
      stop_reason: "end_turn",
      terminal_consumer_ids: ["other"],
    });
    expect(session.getSnapshot().uncertainOwn).toEqual([id]);
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "own",
      stop_reason: "end_turn",
      terminal_consumer_ids: [id],
    });
    expect(session.getSnapshot().uncertainOwn).toEqual([]);
    FakeSocket.hook = undefined;
    expect(await session.submit("next")).toBe(id);
    session.close();
  });

  test("a malformed acknowledgement never turns an uncertain send into a retryable failure", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    FakeSocket.hook = (s, f) => {
      if (f.type !== "input") return false;
      queueMicrotask(() =>
        s.receive({
          type: "input_accepted",
          request_id: f.request_id,
          accepted: true,
        }),
      );
      return true;
    };
    await expect(session.submit("ambiguous")).rejects.toThrow(
      "delivery is uncertain",
    );
    expect(session.getSnapshot().uncertainOwn).toEqual(
      session.getSnapshot().pendingOwn,
    );
    expect(socket.sent.filter((frame) => frame.type === "input")).toHaveLength(
      1,
    );
    session.close();
  });

  test("a run-correlated completion clears uncertainty; explicit rejection is not uncertain", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    FakeSocket.hook = (_socket, frame) => frame.type === "input";
    await expect(session.submit("first")).rejects.toThrow("uncertain");
    const id = required(session.getSnapshot().uncertainOwn[0]);
    socket.receive({
      ...envelope,
      type: "update_loop_status",
      loop_status: {
        status: "WAITING_FOR_API_RESPONSE",
        active_run_ids: ["owned-run"],
        client_message_ids_by_run_id: { "owned-run": [id] },
        executing_tool_call_ids: [],
      },
    });
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "done",
      run_id: "owned-run",
      stop_reason: "end_turn",
    });
    expect(session.getSnapshot().uncertainOwn).toEqual([]);
    FakeSocket.hook = (s, f) => {
      if (f.type !== "input") return false;
      queueMicrotask(() =>
        s.receive({
          type: "input_accepted",
          request_id: f.request_id,
          runtime,
          accepted: false,
          error: "queue full",
        }),
      );
      return true;
    };
    await expect(session.submit("rejected")).rejects.toThrow("queue full");
    expect(session.getSnapshot().uncertainOwn).toEqual([]);
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    session.close();
  });

  test("a terminal pre-run error settles only matching own inputs and later terminal is acknowledged", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    const id = await session.submit("hello");
    const errorFrame = (ids: string[], terminal: boolean) => ({
      ...envelope,
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "loop_error",
        message: "failed before run",
        stop_reason: "error",
        is_terminal: terminal,
        client_message_ids: ids,
      },
    });
    socket.receive(errorFrame([id], false));
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive(errorFrame(["foreign"], true));
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive({
      ...errorFrame([id], true),
      runtime: { ...runtime, conversation_id: "other" },
    });
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive(errorFrame(["foreign", id], true));
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    expect(
      socket.sent.filter((frame) => frame.type === "turn_finished_ack"),
    ).toHaveLength(0);
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "failed",
      stop_reason: "error",
      terminal_consumer_ids: [id, "foreign"],
    });
    expect(
      socket.sent
        .filter((frame) => frame.type === "turn_finished_ack")
        .map((frame) => frame.consumer_id),
    ).toEqual([id]);
    session.close();
  });

  test("late run correlation resolves own completion and foreign scope never changes it", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    const id = await session.submit("hello");
    socket.receive({
      ...envelope,
      runtime: { ...runtime, conversation_id: "other" },
      type: "turn_finished",
      turn_id: "x",
      stop_reason: "end_turn",
      terminal_consumer_ids: [id],
    });
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "ours",
      stop_reason: "end_turn",
      run_id: "late",
    });
    expect(session.getSnapshot().pendingOwn).toEqual([id]);
    socket.receive({
      ...envelope,
      type: "update_loop_status",
      loop_status: {
        status: "WAITING_ON_INPUT",
        active_run_ids: [],
        executing_tool_call_ids: [],
        client_message_ids_by_run_id: { late: [id] },
      },
    });
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    session.close();
  });

  test("a terminal before input acceptance does not resurrect the completed message", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    FakeSocket.hook = (s, f) => {
      if (f.type !== "input") return false;
      const id = f.terminal_consumer_id;
      queueMicrotask(() => {
        s.receive({
          ...envelope,
          type: "turn_finished",
          turn_id: "fast",
          stop_reason: "end_turn",
          terminal_consumer_ids: [id],
        });
        s.receive({
          type: "input_accepted",
          request_id: f.request_id,
          runtime,
          accepted: true,
          disposition: "started",
        });
      });
      return true;
    };
    const id = await session.submit("hello");
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    expect(session.getSnapshot().activeOwn).toEqual([]);
    expect(
      socket.sent
        .filter((f) => f.type === "turn_finished_ack")
        .map((f) => f.consumer_id),
    ).toEqual([id]);
    session.close();
  });

  test("a runless batch of 33 own inputs is settled and acknowledged by exact consumer ID", async () => {
    let nextId = 0;
    const session = await AttachedSession.connect({
      url: "ws://127.0.0.1/ws",
      agentId: "aya",
      conversationId: "conv",
      WebSocket: FakeSocket,
      requestTimeoutMs: 50,
      newId: () => String(++nextId),
    });
    const socket = required(FakeSocket.instances[0]);
    const ids: string[] = [];
    for (let i = 0; i < 33; i++) ids.push(await session.submit(`message ${i}`));
    socket.receive({
      ...envelope,
      type: "turn_finished",
      turn_id: "batch",
      stop_reason: "end_turn",
      terminal_consumer_ids: [...ids, "foreign"],
    });
    expect(session.getSnapshot().pendingOwn).toEqual([]);
    expect(
      socket.sent
        .filter((f) => f.type === "turn_finished_ack")
        .map((f) => f.consumer_id),
    ).toEqual(ids);
    session.close();
  });

  test("approval identity is invalidated on rejection and stale approval cannot be retried", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    socket.receive({
      type: "control_request",
      request_id: "approval",
      agent_id: "aya",
      conversation_id: "conv",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "true" },
        tool_call_id: "tool",
        permission_suggestions: [],
        blocked_path: null,
      },
    });
    const old = required(session.getSnapshot().pendingApprovals[0]).identity;
    FakeSocket.hook = (s, f) => {
      if (f.type !== "input") return false;
      queueMicrotask(() =>
        s.receive({
          type: "input_accepted",
          request_id: f.request_id,
          runtime,
          accepted: false,
          error: "try again",
        }),
      );
      return true;
    };
    await expect(
      session.answerApproval(old, { behavior: "allow" }),
    ).rejects.toThrow("try again");
    const fresh = required(session.getSnapshot().pendingApprovals[0]).identity;
    expect(fresh.generation).not.toBe(old.generation);
    await expect(
      session.answerApproval(old, { behavior: "allow" }),
    ).rejects.toThrow("stale");
    FakeSocket.hook = undefined;
    await session.answerApproval(fresh, { behavior: "deny", message: "no" });
    expect(session.getSnapshot().pendingApprovals).toEqual([]);
    session.close();
  });

  test("an old terminal replay after an approval does not hide that approval", async () => {
    FakeSocket.hook = (socket, frame) => {
      if (frame.type !== "sync") return false;
      queueMicrotask(() => {
        socket.receive({
          type: "control_request",
          request_id: "live-approval",
          agent_id: "aya",
          conversation_id: "conv",
          request: {
            subtype: "can_use_tool",
            tool_name: "Bash",
            input: {},
            tool_call_id: "tool",
            permission_suggestions: [],
            blocked_path: null,
          },
        });
        socket.receive({
          ...envelope,
          type: "turn_finished",
          turn_id: "older",
          run_id: "older-run",
          terminal_consumer_ids: ["foreign"],
          stop_reason: "end_turn",
        });
        socket.receive({
          type: "sync_response",
          request_id: frame.request_id,
          success: true,
          runtime,
        });
      });
      return true;
    };
    const session = await connect();
    expect(
      session
        .getSnapshot()
        .pendingApprovals.map((approval) => approval.identity.requestId),
    ).toEqual(["live-approval"]);
    session.close();
  });

  test("a failed or raced switch closes the candidate and retains the old socket", async () => {
    const session = await connect();
    const old = required(FakeSocket.instances[0]);
    FakeSocket.hook = (s, f) => {
      if (f.type !== "conversation_retrieve" || f.conversation_id !== "other")
        return false;
      queueMicrotask(() =>
        s.receive({
          type: "conversation_retrieve_response",
          request_id: f.request_id,
          success: true,
          conversation: { id: "other", agent_id: "wrong" },
        }),
      );
      return true;
    };
    await expect(session.switchConversation("aya", "other")).rejects.toThrow(
      "belong",
    );
    expect(old.readyState).toBe(1);
    expect(required(FakeSocket.instances[1]).readyState).toBe(3);
    expect(session.getSnapshot().scope.conversationId).toBe("conv");
    FakeSocket.hook = (s, f) => {
      if (f.type !== "sync" || f.runtime.conversation_id !== "next")
        return false;
      old.receive({
        type: "control_request",
        request_id: "arrived",
        agent_id: "aya",
        conversation_id: "conv",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: {},
          tool_call_id: "t",
          permission_suggestions: [],
          blocked_path: null,
        },
      });
      queueMicrotask(() =>
        s.receive({
          type: "sync_response",
          request_id: f.request_id,
          success: true,
          runtime: f.runtime,
        }),
      );
      return true;
    };
    await expect(session.switchConversation("aya", "next")).rejects.toThrow(
      "became busy",
    );
    expect(old.readyState).toBe(1);
    expect(required(FakeSocket.instances[2]).readyState).toBe(3);
    expect(session.getSnapshot().scope.conversationId).toBe("conv");
    session.close();
  });

  test("successful switches replace the socket and increment the scope generation", async () => {
    const session = await connect();
    const first = required(FakeSocket.instances[0]);
    const initialGeneration = session.getSnapshot().generation;
    await session.switchConversation("aya", "next");
    const second = required(FakeSocket.instances[1]);
    expect(first.readyState).toBe(3);
    expect(second.readyState).toBe(1);
    expect(session.getSnapshot().scope.conversationId).toBe("next");
    expect(session.getSnapshot().generation).toBe(initialGeneration + 1);
    expect(second.sent.some((frame) => frame.type === "runtime_start")).toBe(
      false,
    );
    await session.newConversation("Another");
    const third = required(FakeSocket.instances[2]);
    expect(second.readyState).toBe(3);
    expect(session.getSnapshot().scope.conversationId).toBe("new");
    expect(third.sent[0]).toMatchObject({
      type: "runtime_start",
      create_conversation: { body: { summary: "Another" } },
    });
    session.close();
  });

  test("agent refresh applies the same-scope result and discards a late result after a switch", async () => {
    const session = await connect();
    const socket = required(FakeSocket.instances[0]);
    FakeSocket.hook = (s, f) => {
      if (
        f.type !== "agent_retrieve" ||
        !f.request_id.startsWith("agent-refresh")
      )
        return false;
      queueMicrotask(() =>
        s.receive({
          type: "agent_retrieve_response",
          request_id: f.request_id,
          success: true,
          agent: { id: "aya", name: "updated" },
        }),
      );
      return true;
    };
    await session.refreshAgent();
    expect(session.getSnapshot().agent?.name).toBe("updated");
    let staleRequest = "";
    FakeSocket.hook = (_s, f) => {
      if (
        f.type !== "agent_retrieve" ||
        !f.request_id.startsWith("agent-refresh")
      )
        return false;
      staleRequest = f.request_id;
      return true;
    };
    const refresh = session.refreshAgent();
    await session.switchConversation("aya", "next");
    socket.receive({
      type: "agent_retrieve_response",
      request_id: staleRequest,
      success: true,
      agent: { id: "aya", name: "stale" },
    });
    await refresh;
    expect(session.getSnapshot().scope.conversationId).toBe("next");
    expect(session.getSnapshot().agent?.name).not.toBe("stale");
    session.close();
  });
});
