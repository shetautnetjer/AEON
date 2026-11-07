import { describe, expect, test } from "bun:test";
import {
  EXTERNAL_CODING_AGENT_TYPES,
  runExternalCodingAgent,
  validateExternalCodingAgentTurnLimit,
} from "./external-coding-agent";
import { backgroundTasks } from "./process_manager";
import { launchRemoteExternalCodingAgent } from "./remote-external-coding-agent";
import { launchSubagent } from "./task";

const parentScope = {
  agentId: "agent-limit-test",
  conversationId: "conv-limit",
};

describe("external worker turn budgets", () => {
  for (const type of EXTERNAL_CODING_AGENT_TYPES) {
    test(`${type} refuses a local or remote bounded launch before task creation`, async () => {
      const existingTasks = [...backgroundTasks.keys()];
      for (const computer of ["local", "remote-fixture", "cloud"]) {
        const result = await launchSubagent({
          subagent_type: type,
          prompt: "Do fixture work",
          description: "Bounded fixture",
          parentScope,
          computer,
          max_turns: 3,
        });
        expect(result).toMatchObject({ success: false });
        expect("error" in result && result.error).toContain(
          "worker was not launched",
        );
      }
      expect([...backgroundTasks.keys()]).toEqual(existingTasks);
    });

    test(`${type} direct execution refuses before reading secrets or spawning`, async () => {
      let sideEffects = 0;
      const unexpected = async (): Promise<never> => {
        sideEffects++;
        throw new Error("Unexpected external operation");
      };
      const result = await runExternalCodingAgent(
        {
          type,
          prompt: "Do fixture work",
          parentAgentId: parentScope.agentId,
          maxTurns: 3,
        },
        {
          resolveSecretEnv: unexpected,
          runPreflight: unexpected,
          runProcess: unexpected,
          runCodexTurn: unexpected,
        },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("enforced max_turns");
      expect(result.report).toBe("");
      expect(result.runtimeSessionId).toBeUndefined();
      expect(sideEffects).toBe(0);
    });

    test(`${type} direct remote execution refuses before connecting`, async () => {
      let sideEffects = 0;
      const unexpected = async (): Promise<never> => {
        sideEffects++;
        throw new Error("Unexpected remote operation");
      };
      const result = await launchRemoteExternalCodingAgent(
        {
          type,
          computer: "remote-fixture",
          prompt: "Do fixture work",
          description: "Bounded fixture",
          parentScope,
          maxTurns: 3,
        },
        {
          resolveComputer: unexpected,
          connect: unexpected,
          spawn: () => {
            sideEffects++;
            throw new Error("Unexpected task creation");
          },
        },
      );
      expect(result.success).toBe(false);
      expect("error" in result && result.error).toContain("enforced max_turns");
      expect(sideEffects).toBe(0);
    });
  }

  test("omitted budget remains supported; malformed budgets fail validation", async () => {
    for (const type of EXTERNAL_CODING_AGENT_TYPES) {
      expect(
        validateExternalCodingAgentTurnLimit(type, undefined),
      ).toBeUndefined();
      for (const max_turns of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(validateExternalCodingAgentTurnLimit(type, max_turns)).toBe(
          "max_turns must be a positive integer",
        );
        const result = await launchSubagent({
          subagent_type: type,
          prompt: "Do fixture work",
          description: "Invalid fixture",
          parentScope,
          max_turns,
        });
        expect(result).toEqual({
          success: false,
          error: "max_turns must be a positive integer",
        });
      }
    }
  });
});
