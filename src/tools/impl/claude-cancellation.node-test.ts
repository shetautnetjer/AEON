// Offline Node-target qualification: no Claude executable, credentials or model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  type RunningSubagentProcess,
  spawnSubagentProcess,
} from "@/agent/subagents/subagent-process";
import {
  __resetClaudeSessionsForTests,
  runClaudeTurn,
} from "./claude-stream-session";

test(
  "Node keeps cancellation connected after a result until the child exits",
  { timeout: 5_000 },
  async () => {
    const controller = new AbortController();
    let transport: RunningSubagentProcess | undefined;
    let resultWritten!: () => void;
    const wroteResult = new Promise<void>((resolve) => {
      resultWritten = resolve;
    });
    const sessionId = "11111111-1111-4111-8111-111111111111";
    let settled = false;
    const running = runClaudeTurn(
      {
        prompt: "fixture",
        parentAgentId: "fixture-parent",
        cwd: process.cwd(),
        sessionId,
        signal: controller.signal,
      },
      {
        env: {},
        createTransport: (options) => {
          transport = spawnSubagentProcess(
            process.execPath,
            [
              "-e",
              [
                'process.stdin.once("data", () => {',
                'process.stdout.write(JSON.stringify({type:"result",is_error:false,result:"partial fixture evidence"}) + "\\n");',
                "setInterval(() => {}, 1000);",
                "});",
              ].join("\n"),
            ],
            { ...options, forceKillGraceMs: 100 },
          );
          transport.process.stdout.once("data", resultWritten);
          return transport;
        },
      },
    ).then((result) => {
      settled = true;
      return result;
    });
    try {
      await wroteResult;
      await setImmediate();
      assert.equal(
        settled,
        false,
        "native result must not disconnect cancellation",
      );
      controller.abort(new Error("fixture cancellation"));
      const result = await running;
      assert.equal(result.success, false);
      assert.equal(result.error, "fixture cancellation");
      assert.equal(result.runtimeSessionId, sessionId);
      assert.equal(result.report, "partial fixture evidence");
      assert.ok(transport?.wasAborted());
      const pid = transport?.process.pid;
      assert.ok(pid);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      await transport?.completion.catch(() => undefined);
      __resetClaudeSessionsForTests();
    }
  },
);
