import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { render } from "ink";
import { AttachedCommandRepository } from "./AttachedCommandRepository";
import { AttachedCommandSecrets } from "./AttachedCommandSecrets";
import { AttachedCommandView } from "./AttachedCommandView";
import type { AttachedSession } from "./attached-session";

class Capture extends Writable {
  isTTY = true;
  columns = 80;
  rows = 24;
  output = "";
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.output += String(chunk);
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
const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

test("masked secret entry sends value to secret_apply without rendering it", async () => {
  const output = new Capture();
  const input = new Input();
  const calls: unknown[][] = [];
  const notices: string[] = [];
  const snapshot = {
    scope: { agentId: "agent-a", conversationId: "conv-a" },
    generation: 1,
    connection: "connected",
    pendingApprovals: [],
  };
  const session = {
    getSnapshot: () => snapshot,
    client: {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return { success: true, names: ["EXAMPLE"] };
      },
    },
  } as unknown as AttachedSession;
  const ui = render(
    <AttachedCommandSecrets
      session={session}
      initialName="EXAMPLE"
      onClose={() => {}}
      onNotice={(s) => notices.push(s)}
      onFailure={() => {
        throw new Error("unexpected failure");
      }}
    />,
    {
      stdout: output as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      stderr: output as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  );
  try {
    await pause();
    input.write("sample-private-value");
    await pause();
    expect(output.output).not.toContain("sample-private-value");
    input.write("\r");
    await pause();
    expect(calls[0]?.slice(0, 2)).toEqual([
      "secret_apply",
      {
        agent_id: "agent-a",
        set: { EXAMPLE: "sample-private-value" },
        unset: [],
      },
    ]);
    expect(notices).toEqual(["Secret $EXAMPLE set."]);
    expect(output.output).not.toContain("sample-private-value");
  } finally {
    ui.unmount();
    input.destroy();
  }
});

test("masked repository form refuses embedded URL credentials before sending", async () => {
  const output = new Capture();
  const input = new Input();
  const calls: unknown[][] = [];
  const snapshot = {
    scope: { agentId: "agent-a", conversationId: "conv-a" },
    generation: 1,
    connection: "connected",
    pendingApprovals: [],
  };
  const session = {
    getSnapshot: () => snapshot,
    client: {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return { success: true, output: "done" };
      },
    },
  } as unknown as AttachedSession;
  const ui = render(
    <AttachedCommandRepository
      session={session}
      onClose={() => {}}
      onNotice={() => {}}
      onFailure={() => {}}
    />,
    {
      stdout: output as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      stderr: output as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  );
  try {
    await pause();
    input.write("\u001b[B");
    await pause();
    input.write("\r");
    await pause();
    input.write("https://token@example.test/private.git");
    await pause();
    input.write("\r");
    await pause();
    expect(calls).toEqual([]);
    expect(output.output).not.toContain("token@example.test");
    expect(output.output).toContain("without URL credentials");
  } finally {
    ui.unmount();
    input.destroy();
  }
});

test("private prompt submission failure reaches the persistent failure callback intact", async () => {
  const output = new Capture();
  const input = new Input();
  const failure = Object.assign(new Error("Input outcome unknown"), {
    code: "uncertain",
  });
  const failures: unknown[] = [];
  const snapshot = {
    scope: { agentId: "agent-a", conversationId: "conv-a" },
    generation: 1,
    deviceStatus: {
      device_status: {
        supported_commands: ["attached:skills"],
        mod_commands: [],
      },
    },
    connection: "connected",
    pendingApprovals: [],
  };
  const session = {
    getSnapshot: () => snapshot,
    client: {
      request: async () => ({ success: true, output: "private prompt" }),
    },
    submit: async () => {
      throw failure;
    },
  } as unknown as AttachedSession;
  const ui = render(
    <AttachedCommandView
      session={session}
      action={{
        kind: "server",
        operation: "execute-prompt",
        commandId: "skills",
        input: "/skills",
        args: "{}",
      }}
      onClose={() => {}}
      onNotice={() => {}}
      onFailure={(e) => failures.push(e)}
    />,
    {
      stdout: output as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      stderr: output as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  );
  try {
    await pause();
    expect(failures).toEqual([failure]);
    expect(output.output).not.toContain("private prompt");
  } finally {
    ui.unmount();
    input.destroy();
  }
});
