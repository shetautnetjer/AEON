import { afterEach, expect, test } from "bun:test";
import type { AppServerSocketLike } from "@/app-server-client";
import { listAttachedConversations } from "./attached-list";

type Listener = (event: unknown) => void;
class Socket implements AppServerSocketLike {
  static instances: Socket[] = [];
  static ready = 1;
  static success = true;
  readyState = Socket.ready;
  sent: Array<{ type: string; request_id: string; query: unknown }> = [];
  listeners = new Map<string, Set<Listener>>();
  constructor() {
    Socket.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
  send(data: string) {
    const request = JSON.parse(data) as {
      type: string;
      request_id: string;
      query: unknown;
    };
    this.sent.push(request);
    queueMicrotask(() =>
      this.emit("message", {
        data: JSON.stringify({
          type: "conversation_list_response",
          request_id: request.request_id,
          success: Socket.success,
          error: "",
          conversations: Socket.success
            ? [{ id: "conv", agent_id: "aya" }]
            : [],
        }),
      }),
    );
  }
}
afterEach(() => {
  Socket.instances = [];
  Socket.ready = 1;
  Socket.success = true;
});
const options = {
  url: "ws://127.0.0.1/ws",
  WebSocket: Socket,
  requestTimeoutMs: 10,
};

test("list uses the selected agent and closes the socket", async () => {
  expect(await listAttachedConversations(options, "aya")).toEqual([
    { id: "conv", agent_id: "aya" },
  ]);
  expect(Socket.instances[0]?.sent[0]).toMatchObject({
    type: "conversation_list",
    query: { agent_id: "aya", limit: 50 },
  });
  expect(Socket.instances[0]?.readyState).toBe(3);
});

test("failed list response without an error message does not appear successful", async () => {
  Socket.success = false;
  await expect(listAttachedConversations(options, "aya")).rejects.toThrow(
    "Could not list conversations",
  );
  expect(Socket.instances[0]?.readyState).toBe(3);
});

test("unresponsive and prematurely closed connections are bounded and closed", async () => {
  Socket.ready = 0;
  await expect(listAttachedConversations(options, "aya")).rejects.toThrow(
    "timed out",
  );
  expect(Socket.instances[0]?.readyState).toBe(3);
  const pending = listAttachedConversations(options, "aya");
  Socket.instances[1]?.close();
  await expect(pending).rejects.toThrow("closed during connection");
});
