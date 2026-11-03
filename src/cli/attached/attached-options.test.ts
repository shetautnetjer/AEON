import { describe, expect, test } from "bun:test";
import {
  attachedStateDirectory,
  parseAttachedOptions,
} from "@/cli/attached/attached-options";

describe("attached terminal options", () => {
  test("keeps the existing Aya selection path and isolates another agent", () => {
    expect(attachedStateDirectory("/state", "aya", "aya")).toBe("/state");
    expect(attachedStateDirectory("/state", "other", "aya")).not.toBe("/state");
    expect(attachedStateDirectory("/state", "../../other", "aya")).toMatch(
      /^\/state\/agent-[a-f0-9]{64}$/,
    );
  });
  test("parses old chat and native conversation aliases without dropping values", () => {
    expect(
      parseAttachedOptions(["--agent", "aya", "--conv", "conv", "--no-color"]),
    ).toMatchObject({ agentId: "aya", conversationId: "conv", color: false });
    expect(parseAttachedOptions(["--conversation", "conv"])).toMatchObject({
      conversationId: "conv",
    });
    expect(parseAttachedOptions(["--new", "Personal session"])).toMatchObject({
      create: "Personal session",
    });
    expect(parseAttachedOptions(["--new"])).toMatchObject({
      create: "Terminal",
    });
  });
  test("rejects missing values, conflicting destinations and unknown options", () => {
    for (const args of [
      ["--agent"],
      ["--conv", "--new"],
      ["--new", "--conv", "conv"],
      ["--list", "--new"],
      ["--list", "--phone"],
      ["--unknown"],
    ]) {
      expect(() => parseAttachedOptions(args)).toThrow();
    }
  });
});
