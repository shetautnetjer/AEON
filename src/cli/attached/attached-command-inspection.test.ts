import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import stripAnsi from "strip-ansi";
import {
  AttachedCommandInspection,
  buildInspectionLines,
  inspectionText,
} from "./attached-command-inspection";
import type { AttachedSession, AttachedSnapshot } from "./attached-session";

const snapshot = {
  scope: { agentId: "aya", conversationId: "conv" },
  generation: 1,
  agent: { id: "aya", name: "Aya", model: "example/model" },
  lastUsage: { prompt_tokens: 10, completion_tokens: 3, context_tokens: 9 },
  subagents: [
    {
      subagent_id: "sub-1",
      subagent_type: "research",
      status: "running",
      description: "working",
    },
  ],
  deviceStatus: {
    device_status: {
      supported_commands: ["attached:search", "attached:mcp"],
      background_processes: [
        {
          kind: "monitor",
          process_id: "p",
          status: "running",
          description: "watch",
        },
      ],
    },
  },
} as unknown as AttachedSnapshot;

test("inspection panels report observed state and distinguish last turn from totals", () => {
  expect(buildInspectionLines("usage", snapshot).join("\n")).toContain(
    "Last observed completed turn",
  );
  expect(buildInspectionLines("context", snapshot).join("\n")).toContain(
    "Last observed context estimate: 9",
  );
  expect(buildInspectionLines("subagents", snapshot).join("\n")).toContain(
    "research sub-1 — running",
  );
  expect(buildInspectionLines("bg", snapshot).join("\n")).toContain(
    "monitor p — running",
  );
  expect(inspectionText("a\x1b[31m\u202eb")).toBe("a\\u001b[31m\\u202eb");
});

class Output extends Writable {
  columns = 90;
  rows = 30;
  isTTY = true;
  text = "";
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.text += String(chunk);
    callback();
  }
}
class Input extends PassThrough {
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

test("search panel asks the server with native agent scope and shows returned results", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const fake = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    client: {
      nextRequestId: () => "request-1",
      request: async (command: Record<string, unknown>) => {
        commands.push(command);
        return {
          type: "execute_command_response",
          success: true,
          output: "Search: fts, agent; 1 result\nolder conversation result",
        };
      },
    },
  } as unknown as AttachedSession;
  const out = new Output();
  const input = new Input();
  const app = render(
    createElement(AttachedCommandInspection, {
      session: fake,
      selector: "search",
      args: "older",
      onClose: () => {},
      onNotice: () => {},
    }),
    {
      stdout: out as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: "execute_command",
    command_id: "attached:search",
    runtime: { agent_id: "aya", conversation_id: "conv" },
    args: JSON.stringify({ query: "older", range: "agent" }),
  });
  expect(stripAnsi(out.text)).toContain("older conversation result");
  app.unmount();
});

test("inspection never invokes an unprefixed mod when private control is unavailable", async () => {
  const commands: unknown[] = [];
  const overridden = {
    ...snapshot,
    deviceStatus: {
      device_status: {
        supported_commands: ["search"],
        mod_commands: [{ id: "search" }],
      },
    },
  } as unknown as AttachedSnapshot;
  const fake = {
    getSnapshot: () => overridden,
    subscribe: () => () => {},
    client: {
      nextRequestId: () => "x",
      request: async (command: unknown) => {
        commands.push(command);
        return { success: true, output: "" };
      },
    },
  } as unknown as AttachedSession;
  const out = new Output();
  const input = new Input();
  const app = render(
    createElement(AttachedCommandInspection, {
      session: fake,
      selector: "search",
      args: "needle",
      onClose: () => {},
      onNotice: () => {},
    }),
    {
      stdout: out as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(commands).toEqual([]);
  expect(stripAnsi(out.text)).toContain("does not advertise");
  app.unmount();
});
