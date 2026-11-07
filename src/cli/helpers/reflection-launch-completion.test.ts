import { expect, test } from "bun:test";
import { completeReflectionLaunch } from "./reflection-launch-completion";

test.each([true, false])(
  "confirmed completion %s finalizes transcript then releases",
  async (success) => {
    const calls: string[] = [];
    await completeReflectionLaunch({
      finalize: async () => ({ completionSuccess: success }),
      finalizeTranscript: async (value) => {
        calls.push(`transcript:${value}`);
      },
      notify: () => {
        calls.push("notify");
      },
      release: () => {
        calls.push("release");
      },
    });
    expect(calls).toEqual([`transcript:${success}`, "notify", "release"]);
  },
);

test.each([false, true])(
  "uncertain cleanup retains reservation and transcript even if notification throws: %s",
  async (throwNotification) => {
    const calls: string[] = [];
    const completion = completeReflectionLaunch({
      finalize: async () => ({
        completionSuccess: false,
        cleanupUnconfirmed: true,
      }),
      finalizeTranscript: async () => {
        calls.push("transcript");
      },
      notify: () => {
        calls.push("notify");
        if (throwNotification) throw new Error("notification failed");
      },
      release: () => {
        calls.push("release");
      },
    });
    if (throwNotification)
      await expect(completion).rejects.toThrow("notification failed");
    else await completion;
    expect(calls).toEqual(["notify"]);
  },
);

test("ordinary finalizer failure still releases the reservation", async () => {
  let released = false;
  await expect(
    completeReflectionLaunch({
      finalize: async () => {
        throw new Error("ordinary failure");
      },
      finalizeTranscript: async () => {
        throw new Error("must not finalize");
      },
      notify: () => {
        throw new Error("must not notify");
      },
      release: () => {
        released = true;
      },
    }),
  ).rejects.toThrow("ordinary failure");
  expect(released).toBe(true);
});
