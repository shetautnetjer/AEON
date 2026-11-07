import { expect, test } from "bun:test";
import type { ReflectionMemoryWorktree } from "@/agent/memory-worktree";
import { unconfirmedReflectionCleanup } from "./reflection-cleanup";
import { completeManualReflectionLaunch } from "./reflection-manual-completion";
import type { MultiReflectionManifest } from "./reflection-transcript";

const worktree: ReflectionMemoryWorktree = {
  id: "fixture",
  parentMemoryDir: "/fixture",
  worktreeBaseDir: "/fixture",
  worktreeDir: "/fixture/worktree",
  branchName: "fixture",
  baseHead: "fixture-head",
  gitCommonDir: "/fixture/.git",
};

test.each(["auto-selected", "explicit-conversations"] as const)(
  "manual %s completion retains ownership and manifest on unknown cleanup",
  async (mode) => {
    const manifest: MultiReflectionManifest = {
      schema_version: 1,
      type: "multi_transcript_reflection_payload",
      agent_id: "fixture",
      created_at: "2026-11-07T00:00:00Z",
      transcripts: [],
      selection_policy:
        mode === "auto-selected"
          ? { mode, selected_conversations: [] }
          : { mode, conversation_ids: ["fixture-conversation"] },
    };
    const before = JSON.stringify(manifest);
    const calls: string[] = [];
    await completeManualReflectionLaunch(
      {
        finalization: {
          worktree,
          subagentSuccess: true,
          agentId: "fixture",
          conversationId: "fixture-conversation",
          recompileByConversation: new Map(),
          recompileQueuedByConversation: new Set(),
        },
        telemetryConversationId: "fixture-conversation",
        manifest,
        notify: (messages) => {
          expect(messages[0]).toContain("cleanup is unconfirmed");
          calls.push("notify");
        },
        release: () => {
          calls.push("release");
        },
      },
      {
        finalize: async () => unconfirmedReflectionCleanup(worktree),
        finalizeTranscript: async () => {
          calls.push("transcript");
        },
      },
    );
    expect(calls).toEqual(["notify"]);
    expect(JSON.stringify(manifest)).toBe(before);
  },
);
