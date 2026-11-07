import { afterEach, expect, spyOn, test } from "bun:test";
import type WebSocket from "ws";
import * as cloud from "@/agent/reflection-runs";
import * as multi from "@/cli/helpers/multi-reflection-launch";
import { settingsManager } from "@/settings-manager";
import { __listenClientTestUtils } from "./client";
import { handleExecuteCommand } from "./commands";

const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

test.each([
  [{ launched: false, reason: "already_active" }, "already running"],
  [{ launched: false, reason: "no_payload" }, "No transcript content"],
  [
    {
      launched: true,
      transcriptCount: 2,
      payloadPath: "/fixture/payload.json",
    },
    "over 2 conversation(s)",
  ],
] as const)(
  "listener routes multi-reflection selection and outcome %j",
  async (result, output) => {
    const cloudRun = spyOn(
      cloud,
      "requestCloudReflectionRun",
    ).mockResolvedValue(null);
    const enabled = spyOn(settingsManager, "isMemfsEnabled").mockReturnValue(
      true,
    );
    const launch = spyOn(multi, "launchMultiReflection").mockResolvedValue(
      result,
    );
    restores.push(
      () => cloudRun.mockRestore(),
      () => enabled.mockRestore(),
      () => launch.mockRestore(),
    );
    const listener = __listenClientTestUtils.createListenerRuntime();
    const runtime = __listenClientTestUtils.getOrCreateConversationRuntime(
      listener,
      "agent-fixture",
      "conv-fixture",
    );
    const sent: string[] = [];
    const socket = { readyState: 1, send: (value: string) => sent.push(value) };
    for (const args of [
      "--recent 2",
      "--conversation conv-a --conversation conv-b",
    ]) {
      await handleExecuteCommand(
        {
          type: "execute_command",
          command_id: "dream",
          args,
          request_id: "fixture-request",
          runtime: {
            agent_id: "agent-fixture",
            conversation_id: "conv-fixture",
            acting_user_id: "user-fixture",
          },
        },
        socket as unknown as WebSocket,
        runtime,
        { connectionId: "fixture-connection" },
      );
      expect(JSON.parse(sent.at(-1) ?? "")).toMatchObject({
        success: true,
        output: expect.stringContaining(output),
      });
      expect(launch.mock.calls.at(-1)?.[0]).toMatchObject({
        agentId: "agent-fixture",
        conversationId: "conv-fixture",
        actingUserId: "user-fixture",
        selection: args.startsWith("--recent")
          ? { kind: "recent", limit: 2 }
          : { kind: "conversations", conversationIds: ["conv-a", "conv-b"] },
      });
    }
  },
);
