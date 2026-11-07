import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTaskTranscriptResult } from "./task-transcript";

test.each([false, true])(
  "failed transcript retains partial evidence once (already written: %s)",
  (alreadyWritten) => {
    const dir = mkdtempSync(join(tmpdir(), "task-transcript-"));
    const file = join(dir, "output.txt");
    try {
      writeFileSync(file, alreadyWritten ? "partial evidence\n\n" : "");
      writeTaskTranscriptResult(
        file,
        {
          agentId: "fixture-worker",
          success: false,
          report: "partial evidence",
          error: "cancelled",
        },
        "subagent_status=error",
        alreadyWritten,
      );
      const transcript = readFileSync(file, "utf8");
      expect(transcript.match(/partial evidence/g)).toHaveLength(1);
      expect(transcript).toContain("subagent_status=error");
      expect(transcript).toContain("[error] cancelled");
      expect(transcript).toContain("[Task failed]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
