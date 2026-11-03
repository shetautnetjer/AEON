import { describe, expect, test } from "bun:test";
import {
  memoryFiles,
  runAttachedCommand,
  selectAttachedModel,
} from "./attached-command-operations";
import type { AttachedCommandAction } from "./attached-command-types";
import type { AttachedSession } from "./attached-session";

function fixture() {
  const calls: unknown[][] = [];
  const snapshot = {
    scope: { agentId: "agent-a", conversationId: "conv-a" },
    deviceStatus: {
      device_status: {
        supported_commands: ["attached:skills"],
        mod_commands: [] as Array<{ id: string }>,
      },
    },
    connection: "connected",
    loopStatus: { status: "WAITING_ON_INPUT" },
    queue: [],
    pendingApprovals: [],
    pendingOwn: [],
    activeOwn: [],
  };
  const responses: Record<string, unknown> = {};
  const session = {
    getSnapshot: () => snapshot,
    refreshAgent: async () => {},
    client: {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return responses[String(args[0])];
      },
    },
    newConversation: async (title: string) => {
      calls.push(["new", title]);
    },
    switchConversation: async (agent: string, conversation: string) => {
      calls.push(["switch", agent, conversation]);
    },
  } as unknown as AttachedSession;
  return { calls, snapshot, responses, session };
}
function action(
  operation: Extract<AttachedCommandAction, { kind: "server" }>["operation"],
  args = "",
) {
  return { kind: "server" as const, operation, input: "/test", args };
}

describe("attached command operations", () => {
  test("sends model selection to the attached runtime", async () => {
    const f = fixture();
    f.responses.update_model = { success: true };
    await selectAttachedModel(f.session, "model-1");
    expect(f.calls[0]?.slice(0, 2)).toEqual([
      "update_model",
      {
        runtime: { agent_id: "agent-a", conversation_id: "conv-a" },
        payload: { model_id: "model-1" },
      },
    ]);
  });
  test("forks via server and attaches the returned conversation", async () => {
    const f = fixture();
    f.responses.conversation_fork = {
      success: true,
      conversation: { id: "conv-b" },
    };
    expect(await runAttachedCommand(f.session, action("fork"))).toBe(
      "Conversation forked.",
    );
    expect(f.calls[0]?.slice(0, 2)).toEqual([
      "conversation_fork",
      { conversation_id: "conv-a" },
    ]);
    expect(f.calls[1]).toEqual(["switch", "agent-a", "conv-b"]);
  });
  test("refuses a fork before creating it while a turn is active", async () => {
    const f = fixture();
    f.snapshot.loopStatus.status = "RUNNING";
    await expect(runAttachedCommand(f.session, action("fork"))).rejects.toThrow(
      "Finish the current turn",
    );
    expect(f.calls).toEqual([]);
  });
  test("server failure is reported, not presented as success", async () => {
    const f = fixture();
    f.responses.agent_update = { success: false, error: "rename denied" };
    await expect(
      runAttachedCommand(f.session, action("rename-agent", "new name")),
    ).rejects.toThrow("rename denied");
    expect(f.calls[0]?.slice(0, 2)).toEqual([
      "agent_update",
      { agent_id: "agent-a", body: { name: "new name" } },
    ]);
  });
  test("secret list displays names only and unset sends an atomic remove", async () => {
    const f = fixture();
    f.responses.secret_list = {
      success: true,
      secrets: [{ key: "TOKEN", value: "do-not-display" }],
    };
    const result = await runAttachedCommand(f.session, action("secret-list"));
    expect(result).toContain("$TOKEN");
    expect(result).not.toContain("do-not-display");
    f.responses.secret_apply = { success: true, names: [] };
    await runAttachedCommand(f.session, action("secret-unset", "TOKEN"));
    expect(f.calls[1]?.slice(0, 2)).toEqual([
      "secret_apply",
      { agent_id: "agent-a", set: {}, unset: ["TOKEN"] },
    ]);
  });
  test("private workflow prompt is submitted as an owned turn and not returned as a notice", async () => {
    const f = fixture();
    f.responses.execute_command = {
      success: true,
      output: "wrapped skill instructions",
    };
    f.session.submit = async (text, options) => {
      f.calls.push(["submit", text, options]);
      return "client-id";
    };
    expect(
      await runAttachedCommand(f.session, {
        ...action("execute-prompt", "{}"),
        commandId: "skills",
      }),
    ).toBe("");
    expect(f.calls[1]).toEqual([
      "submit",
      "wrapped skill instructions",
      { displayText: "/test" },
    ]);
  });
  test("private workflow prompt is not sent after scope changes", async () => {
    const f = fixture();
    f.session.client.request = (async () => {
      f.snapshot.scope.conversationId = "conv-b";
      return { success: true, output: "prompt" };
    }) as typeof f.session.client.request;
    f.session.submit = async () => {
      throw new Error("must not submit");
    };
    await expect(
      runAttachedCommand(f.session, {
        ...action("execute-prompt", "{}"),
        commandId: "skills",
      }),
    ).rejects.toThrow("Conversation changed");
  });
  test("a colliding mod cannot receive a reserved private skill request", async () => {
    const f = fixture();
    f.snapshot.deviceStatus.device_status.mod_commands.push({ id: "skills" });
    f.responses.execute_command = { success: true, output: "prompt" };
    f.session.submit = async () => "client-id";
    await runAttachedCommand(f.session, {
      ...action("execute-prompt", "{}"),
      commandId: "skills",
    });
    expect(f.calls[0]?.[1]).toMatchObject({ command_id: "attached:skills" });
  });
  test("memory listing accumulates all response chunks for the request", async () => {
    let listener:
      | ((frame: {
          type: string;
          request_id: string;
          entries: { relative_path: string }[];
          done?: boolean;
          success?: boolean;
          memfs_enabled?: boolean;
        }) => void)
      | undefined;
    let unsubscribed = false;
    const session = {
      getSnapshot: () => ({ scope: { agentId: "agent-a" } }),
      client: {
        nextRequestId: () => "r1",
        onMessage: (cb: typeof listener) => {
          listener = cb;
          return () => {
            unsubscribed = true;
          };
        },
        request: async () => {
          listener?.({
            type: "list_memory_response",
            request_id: "other",
            entries: [{ relative_path: "ignored" }],
          });
          listener?.({
            type: "list_memory_response",
            request_id: "r1",
            entries: [{ relative_path: "one" }],
            done: false,
          });
          const final = {
            type: "list_memory_response",
            request_id: "r1",
            entries: [{ relative_path: "two" }],
            done: true,
            success: true,
            memfs_enabled: true,
          };
          listener?.(final);
          return final;
        },
      },
    } as unknown as AttachedSession;
    const result = await memoryFiles(session);
    expect(result.files.map((f) => f.relative_path)).toEqual(["one", "two"]);
    expect(result.enabled).toBe(true);
    expect(unsubscribed).toBe(true);
  });
});
