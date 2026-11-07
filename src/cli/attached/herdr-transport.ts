import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

/** Herdr's existing local NDJSON protocol; no agent control or transcript data. */
export interface HerdrReport {
  method: "pane.report_agent" | "pane.release_agent";
  params: {
    pane_id: string;
    source: string;
    agent: string;
    seq: number;
    state?: "idle" | "working" | "blocked";
    message?: string;
    resume_argv?: string[];
  };
}

/** A failed optional report must never hold the native terminal open. */
export function sendHerdrReport(
  path: string,
  report: HerdrReport,
  timeoutMs = 250,
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = randomUUID();
    const socket = createConnection(path);
    let output = "";
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, ...report })}\n`);
    });
    socket.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 16_384) return finish(false);
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(output.slice(0, newline));
        finish(response?.id === id && response?.result?.type === "ok");
      } catch {
        finish(false);
      }
    });
  });
}
