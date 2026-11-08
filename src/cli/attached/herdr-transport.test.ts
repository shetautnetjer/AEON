import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HerdrReport, sendHerdrReport } from "./herdr-transport";

const report: HerdrReport = {
  method: "pane.report_agent",
  params: {
    pane_id: "p",
    source: "aeon:attached",
    agent: "aeon",
    seq: 1,
    state: "idle",
    resume_argv: ["env", "AYA_AGENT_ID=aya", "/node", "/letta.js", "attach"],
  },
};

test("native NDJSON transport requires matching success and handles split responses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-transport-"));
  const path = join(dir, "test.sock");
  let mode = "ok";
  const received: unknown[] = [];
  const server = createServer((socket) => {
    let input = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      input += chunk;
      if (!input.includes("\n")) return;
      const request = JSON.parse(input.trim());
      received.push(request);
      if (mode === "silent") return;
      const response =
        mode === "malformed"
          ? "not json\n"
          : `${JSON.stringify({ id: mode === "wrong-id" ? "wrong" : request.id, ...(mode === "rejected" ? { error: { code: "resume_not_accepted" } } : { result: { type: "ok" } }) })}\n`;
      socket.write(response.slice(0, 7));
      socket.end(response.slice(7));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    expect(await sendHerdrReport(path, report)).toBe(true);
    expect(received[0]).toMatchObject(report);
    for (mode of ["malformed", "wrong-id", "rejected", "silent"])
      expect(await sendHerdrReport(path, report, 30)).toBe(false);
    expect(await sendHerdrReport(join(dir, "absent.sock"), report, 30)).toBe(
      false,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
