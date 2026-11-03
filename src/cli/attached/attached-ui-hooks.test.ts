import { expect, spyOn, test } from "bun:test";
import { createBuffers, onChunk, toLines } from "@/cli/helpers/accumulator";
import * as hooks from "@/hooks";

test("attached stream accumulation renders tools and compaction without running local hooks", async () => {
  const pre = spyOn(hooks, "runPreToolUseHooks").mockResolvedValue(
    undefined as never,
  );
  const post = spyOn(hooks, "runPostToolUseHooks").mockResolvedValue(
    undefined as never,
  );
  const compact = spyOn(hooks, "runPreCompactHooks").mockResolvedValue(
    undefined as never,
  );
  try {
    const buffers = createBuffers("agent");
    onChunk(
      buffers,
      {
        message_type: "tool_call_message",
        id: "m1",
        tool_call: { tool_call_id: "t1", name: "Bash", arguments: "{}" },
      } as Parameters<typeof onChunk>[1],
      undefined,
      { presentationOnly: true },
    );
    onChunk(
      buffers,
      {
        message_type: "tool_return_message",
        id: "m2",
        tool_call_id: "t1",
        status: "success",
        tool_return: "done",
      } as Parameters<typeof onChunk>[1],
      undefined,
      { presentationOnly: true },
    );
    onChunk(
      buffers,
      {
        message_type: "event_message",
        id: "m3",
        event_type: "compaction",
        event_data: {},
      },
      undefined,
      { presentationOnly: true },
    );
    await Promise.resolve();
    expect(pre).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
    expect(
      toLines(buffers).find((line) => line.kind === "tool_call"),
    ).toMatchObject({
      toolCallId: "t1",
      resultText: "done",
      phase: "finished",
    });
    onChunk(
      buffers,
      {
        message_type: "user_message",
        id: "user-1",
        otid: "client-1",
        content: "visible user input",
      } as Parameters<typeof onChunk>[1],
      undefined,
      { presentationOnly: true },
    );
    expect(toLines(buffers).find((line) => line.kind === "user")).toMatchObject(
      { text: "visible user input", otid: "client-1" },
    );
    const native = createBuffers("agent");
    onChunk(native, {
      message_type: "user_message",
      id: "native-user",
      otid: "native-client",
      content: "not optimistically added",
    } as Parameters<typeof onChunk>[1]);
    expect(toLines(native).some((line) => line.kind === "user")).toBe(false);
    onChunk(native, {
      message_type: "tool_call_message",
      id: "m4",
      tool_call: { tool_call_id: "t2", name: "Bash", arguments: "{}" },
    } as Parameters<typeof onChunk>[1]);
    await Promise.resolve();
    expect(pre).toHaveBeenCalledTimes(1);
  } finally {
    pre.mockRestore();
    post.mockRestore();
    compact.mockRestore();
  }
});
