import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { render } from "ink";
import stripAnsi from "strip-ansi";
import { permissionMode } from "@/permissions/mode";
import { settingsManager } from "@/settings-manager";
import type { WsProtocolMessage } from "@/types/protocol_v2";
import { AttachedApp } from "./AttachedApp";
import {
  type AttachedSession,
  type AttachedSnapshot,
  UncertainInputError,
} from "./attached-session";

class Capture extends Writable {
  columns = 90;
  rows = 30;
  isTTY = true;
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(String(chunk));
    callback();
  }
}
class InputStream extends PassThrough {
  isTTY = true;
  setRawMode() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

test("attached approval shows complete input and sends only the exact decision identity", async () => {
  const home = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "attached-ui-test-"));
  process.env.HOME = tempHome;
  await settingsManager.reset();
  await settingsManager.initialize();
  const authRead = spyOn(
    settingsManager,
    "getSettingsWithSecureTokens",
  ).mockImplementation(async () => {
    throw new Error("attached UI must not read local auth");
  });
  const memfsRead = spyOn(settingsManager, "isMemfsEnabled").mockImplementation(
    () => {
      throw new Error("attached UI must not infer local Memfs");
    },
  );
  const output = new Capture();
  const input = new InputStream();
  const calls: unknown[] = [];
  const commands: unknown[] = [];
  const skillListRequests: string[] = [];
  const submitted: string[] = [];
  let onFrame: ((frame: WsProtocolMessage) => void) | undefined;
  let snapshot = {
    scope: { agentId: "agent-test", conversationId: "conversation-test" },
    agent: null,
    history: [],
    generation: 1,
    loopStatus: { status: "WAITING_ON_INPUT" },
    deviceStatus: null,
    queue: [],
    pendingApprovals: [
      {
        identity: { requestId: "r1", generation: 9 },
        frame: {
          type: "control_request",
          request_id: "r1",
          request: {
            subtype: "can_use_tool",
            tool_name: "Bash",
            tool_call_id: "t1",
            input: { command: "echo all fields", extra: "visible" },
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
  const listeners = new Set<() => void>();
  const fake = {
    client: {
      send: (command: unknown) => commands.push(command),
      request: async (_type: string, payload: { command_id: string }) => {
        skillListRequests.push(payload.command_id);
        return {
          success: true,
          output: JSON.stringify({
            skills: [
              {
                id: "safe-skill",
                name: "Safe Skill",
                description: "Remote skill listing",
              },
            ],
            omitted: 0,
          }),
        };
      },
    },
    submit: async (text: string) => {
      submitted.push(text);
      throw new UncertainInputError("input-test", true, "synthetic timeout");
    },
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onFrame: (fn: (frame: WsProtocolMessage) => void) => {
      onFrame = fn;
      return () => {
        onFrame = undefined;
      };
    },
    close() {},
    answerApproval: async (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as AttachedSession;
  const original = process.env.LETTA_BASE_URL;
  process.env.LETTA_BASE_URL = "http://example.invalid";
  const savedRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
  const savedCols = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "rows", {
    configurable: true,
    value: 30,
  });
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: 90,
  });
  const instance = render(<AttachedApp session={fake} />, {
    stdout: output as unknown as NodeJS.WriteStream,
    stdin: input as unknown as NodeJS.ReadStream,
    debug: false,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  try {
    await pause();
    const rendered = stripAnsi(output.chunks.join(""));
    expect(rendered).toContain("Attached service");
    expect(rendered).not.toContain("example.invalid");
    expect(rendered).toContain("Working directory not advertised");
    expect(authRead).not.toHaveBeenCalled();
    expect(memfsRead).not.toHaveBeenCalled();
    expect(rendered).toContain("complete input");
    expect(rendered).toContain("echo\\u0020all\\u0020fields");
    expect(rendered.replace(/\n/g, "")).toContain("visible");
    expect(rendered).not.toContain("always allow");
    input.write("1");
    await pause();
    expect(calls).toEqual([
      [{ requestId: "r1", generation: 9 }, { behavior: "allow" }],
    ]);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "assistant_message",
        id: "assistant-1",
        content: "Held during approval",
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "turn_finished",
      stop_reason: "end_turn",
      turn_id: "turn-1",
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "loop_error",
        is_terminal: true,
        message: "FAILURE-NEEDS-ATTENTION",
        stop_reason: "error",
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "status",
        message: "status-after-failure",
        level: "info",
      },
    } as unknown as WsProtocolMessage);
    await pause();
    expect(stripAnsi(output.chunks.join(""))).not.toContain(
      "Held during approval",
    );
    const previousApproval = snapshot.pendingApprovals[0];
    if (!previousApproval) throw new Error("Expected the first approval");
    snapshot = {
      ...snapshot,
      pendingApprovals: [
        {
          identity: { requestId: "r2", generation: 10 },
          frame: {
            ...previousApproval.frame,
            request_id: "r2",
            request: {
              ...previousApproval.frame.request,
              input: { command: "x".repeat(6000) },
            },
          },
        },
      ],
    };
    for (const listener of listeners) listener();
    await pause();
    expect(stripAnsi(output.chunks.join(""))).toContain(
      "Full input cannot fit",
    );
    input.write("1");
    await pause();
    expect(calls).toHaveLength(1);
    const localMode = permissionMode.getMode();
    snapshot = {
      ...snapshot,
      pendingApprovals: [],
      subagents: [
        {
          subagent_id: "child-1",
          subagent_type: "research",
          description: "Inspect test source",
          status: "running",
          agent_url: null,
          start_time: 1,
          tool_calls: [],
          total_tokens: 0,
          duration_ms: 10,
        },
      ],
      deviceStatus: {
        device_status: { current_permission_mode: "standard" },
      } as AttachedSnapshot["deviceStatus"],
    };
    for (const listener of listeners) listener();
    await pause();
    expect(stripAnsi(output.chunks.join(""))).toContain("Held during approval");
    expect(stripAnsi(output.chunks.join(""))).toContain(
      "FAILURE-NEEDS-ATTENTION",
    );
    input.write("UNACKNOWLEDGED-DRAFT");
    await pause();
    input.write("\r");
    await pause();
    expect(submitted).toEqual(["UNACKNOWLEDGED-DRAFT"]);
    const latest = stripAnsi(output.chunks.at(-1) ?? "");
    expect(latest).toContain("delivery is uncertain");
    expect(latest).not.toContain("UNACKNOWLEDGED-DRAFT");
    expect(stripAnsi(output.chunks.join(""))).toContain("Inspect test source");
    input.write("\u001b[Z");
    await pause();
    expect(commands).toEqual([
      {
        type: "change_device_state",
        runtime: {
          agent_id: "agent-test",
          conversation_id: "conversation-test",
        },
        payload: { mode: "unrestricted" },
      },
    ]);
    expect(permissionMode.getMode()).toBe(localMode);
    input.write(
      "\u001b[200~/secret set TEST_TOKEN do-not-display-example\u001b[201~",
    );
    await pause();
    expect(stripAnsi(output.chunks.join(""))).not.toContain(
      "do-not-display-example",
    );
    expect(stripAnsi(output.chunks.join(""))).toContain(
      "Use /secret for masked entry",
    );
    input.write("\u001b");
    await pause();
    input.write(
      `\u001b[200~/secret set KEY ${"q".repeat(900)}-large-private-example\u001b[201~`,
    );
    await pause();
    expect(stripAnsi(output.chunks.join(""))).not.toContain(
      "large-private-example",
    );
    input.write("\u001b");
    await pause();
    input.write(
      "\u001b[200~/memory-repository set https://private-user:private-password@example.invalid/repo\u001b[201~",
    );
    await pause();
    expect(stripAnsi(output.chunks.join(""))).not.toContain("private-password");
    input.write("\u001b");
    await pause();
    input.write("/secret set ");
    await pause();
    input.write("split-private-marker");
    await pause();
    expect(stripAnsi(output.chunks.join(""))).not.toContain(
      "split-private-marker",
    );
    input.write("\u001b");
    await pause();
    snapshot = {
      ...snapshot,
      deviceStatus: {
        device_status: {
          current_permission_mode: "standard",
          supported_commands: ["skills"],
          mod_commands: [{ id: "skills", description: "Legacy mod" }],
        },
      } as unknown as AttachedSnapshot["deviceStatus"],
    };
    for (const listener of listeners) listener();
    await pause();
    expect(skillListRequests).toEqual([]);
    snapshot = {
      ...snapshot,
      deviceStatus: {
        device_status: {
          current_permission_mode: "standard",
          supported_commands: ["attached:skills"],
          mod_commands: [
            { id: "remote-demo", description: "Remote capability" },
          ],
        },
      } as unknown as AttachedSnapshot["deviceStatus"],
    };
    for (const listener of listeners) listener();
    await pause();
    input.write("/remote-demo");
    await pause();
    expect(stripAnsi(output.chunks.join(""))).toContain("Remote capability");
    input.write("\u001b");
    await pause();
    input.write("\u001b");
    await pause();
    input.write("/safe-skill");
    await pause();
    expect(stripAnsi(output.chunks.join(""))).toContain("Remote skill listing");
    const beforeCollision = skillListRequests.length;
    snapshot = {
      ...snapshot,
      deviceStatus: {
        device_status: {
          current_permission_mode: "standard",
          supported_commands: ["attached:skills"],
          mod_commands: [{ id: "skills", description: "Conflicting mod" }],
        },
      } as unknown as AttachedSnapshot["deviceStatus"],
    };
    for (const listener of listeners) listener();
    await pause();
    snapshot = {
      ...snapshot,
      scope: { agentId: "agent-two", conversationId: "conversation-two" },
      generation: 2,
      inputDisplayById: { "skill-send-id": "/safe-skill user request" },
      history: [
        {
          id: "history-tool",
          message_type: "tool_call_message",
          tool_call: {
            tool_call_id: "tool-overlap",
            name: "example_tool",
            arguments: '{"value":"once"}',
          },
        },
      ] as unknown as AttachedSnapshot["history"],
    };
    // A switched transport may replay its first frame synchronously before React renders the new scope.
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "user_message",
        id: "user-other",
        otid: "other-client",
        content: "OTHER-USER-TEXT",
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "user_message",
        id: "user-skill",
        otid: "skill-send-id",
        content:
          '<skill_content name="sample">PRIVATE-SKILL-CONTENT</skill_content>\n\nuser request',
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "assistant_message",
        id: "assistant-2",
        content: "New scope first frame",
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "tool_call_message",
        id: "history-tool",
        tool_call: {
          tool_call_id: "tool-overlap",
          name: "example_tool",
          arguments: '{"value":"once"}',
        },
      },
    } as unknown as WsProtocolMessage);
    onFrame?.({
      type: "stream_delta",
      delta: {
        type: "message",
        message_type: "tool_return_message",
        id: "new-tool-return",
        tool_call_id: "tool-overlap",
        status: "success",
        tool_return: "VISIBLE-TOOL-RESULT",
      },
    } as unknown as WsProtocolMessage);
    for (const listener of listeners) listener();
    await pause();
    expect(stripAnsi(output.chunks.join(""))).toContain(
      "New scope first frame",
    );
    expect(stripAnsi(output.chunks.join(""))).toContain("VISIBLE-TOOL-RESULT");
    expect(skillListRequests.length).toBe(beforeCollision + 1);
    expect(skillListRequests.every((id) => id === "attached:skills")).toBe(
      true,
    );
    expect(stripAnsi(output.chunks.join(""))).toContain("OTHER-USER-TEXT");
    expect(stripAnsi(output.chunks.join(""))).toContain(
      "/safe-skill user request",
    );
    expect(stripAnsi(output.chunks.join(""))).not.toContain(
      "PRIVATE-SKILL-CONTENT",
    );
  } finally {
    instance.unmount();
    instance.cleanup();
    if (original === undefined) delete process.env.LETTA_BASE_URL;
    else process.env.LETTA_BASE_URL = original;
    if (savedRows) Object.defineProperty(process.stdout, "rows", savedRows);
    else delete (process.stdout as { rows?: number }).rows;
    if (savedCols) Object.defineProperty(process.stdout, "columns", savedCols);
    else delete (process.stdout as { columns?: number }).columns;
    process.stdout.emit("resize");
    authRead.mockRestore();
    memfsRead.mockRestore();
    await settingsManager.reset();
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
