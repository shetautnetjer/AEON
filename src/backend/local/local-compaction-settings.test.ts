import { describe, expect, test } from "bun:test";
import type { ConversationMessageCompactBody } from "@/backend/backend";
import {
  LOCAL_DEFAULT_COMPACTION_MODE,
  LOCAL_DEFAULT_SLIDING_WINDOW_PERCENTAGE,
} from "./compaction";
import {
  localCompactionSettingsForStorage,
  localSummaryModelHandle,
  resolveLocalCompactionSettings,
  validateLocalCompactionSettingsRecord,
} from "./local-compaction-settings";

describe("localSummaryModelHandle", () => {
  test("accepts a local model handle, trimmed", () => {
    expect(localSummaryModelHandle("  anthropic/claude-haiku-5-5 ")).toBe(
      "anthropic/claude-haiku-5-5",
    );
  });

  test("ignores cloud-only and unselected handles", () => {
    for (const value of ["letta/auto", "auto", "", "   ", null, 7, undefined]) {
      expect(localSummaryModelHandle(value)).toBeUndefined();
    }
  });
});

describe("localCompactionSettingsForStorage", () => {
  test("stores a settings object that names a local summary model", () => {
    expect(
      localCompactionSettingsForStorage({
        model: "anthropic/claude-haiku-5-5",
      }),
    ).toEqual({ model: "anthropic/claude-haiku-5-5" });
  });

  test("does not store Letta Code's default cloud summary model alone", () => {
    expect(
      localCompactionSettingsForStorage({ model: "letta/auto" }),
    ).toBeUndefined();
  });

  test("keeps the existing local keys and null", () => {
    expect(localCompactionSettingsForStorage({ mode: "all" })).toEqual({
      mode: "all",
    });
    expect(localCompactionSettingsForStorage(null)).toBeNull();
    expect(localCompactionSettingsForStorage(undefined)).toBeUndefined();
  });
});

describe("resolveLocalCompactionSettings", () => {
  test("defaults with no settings: no summary model", () => {
    expect(resolveLocalCompactionSettings(undefined)).toEqual({
      mode: LOCAL_DEFAULT_COMPACTION_MODE,
      prompt: undefined,
      clipChars: undefined,
      slidingWindowPercentage: LOCAL_DEFAULT_SLIDING_WINDOW_PERCENTAGE,
    });
  });

  test("takes the summary model from the agent's settings", () => {
    expect(
      resolveLocalCompactionSettings({ model: "anthropic/claude-haiku-5-5" })
        .model,
    ).toBe("anthropic/claude-haiku-5-5");
  });

  test("a compact request's model overrides the agent's", () => {
    const resolved = resolveLocalCompactionSettings(
      { model: "anthropic/claude-haiku-5-5" },
      {
        compaction_settings: { model: "anthropic/claude-sonnet-4-6" },
      } satisfies ConversationMessageCompactBody,
    );
    expect(resolved.model).toBe("anthropic/claude-sonnet-4-6");
  });

  test("ignores letta/auto, so existing agents keep their own model", () => {
    expect(
      resolveLocalCompactionSettings({ model: "letta/auto" }).model,
    ).toBeUndefined();
  });

  test("changing the mode in a request drops the stored prompt", () => {
    const resolved = resolveLocalCompactionSettings(
      { mode: "all", prompt: "summarize everything" },
      {
        compaction_settings: { mode: "sliding_window" },
      } as ConversationMessageCompactBody,
    );
    expect(resolved.mode).toBe("sliding_window");
    expect(resolved.prompt).toBeUndefined();
  });

  test("rejects an unknown mode", () => {
    expect(() =>
      validateLocalCompactionSettingsRecord({ mode: "self_compact_all" }),
    ).toThrow(/only modes/);
  });
});
