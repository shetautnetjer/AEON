import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ConnectedMcpServer,
  type ConnectMcpServerOptions,
  connectMcpServer,
  type McpServerConfig,
} from "@/mcp-client";
import { runMcpSubcommand } from "./mcp";

const EVERYTHING_SERVER = fileURLToPath(
  new URL(
    "./dist/index.js",
    import.meta.resolve("@modelcontextprotocol/server-everything/package.json"),
  ),
);

// Writes >1 MB to stderr with blocking writes before speaking MCP, like a
// chatty native server. If nobody drains a piped stderr, it never answers:
// under Node (the CLI's runtime) a "pipe" stderr stalls the handshake. Bun's
// stream piping does not apply that backpressure, so under `bun test` the
// stall itself does not reproduce and the stderr-mode assertion guards it.
const CHATTY_SERVER = `
import { writeSync } from "node:fs";
const chunk = Buffer.alloc(64 * 1024, "x");
let left = 24 * chunk.length;
while (left > 0) {
  try {
    left -= writeSync(2, chunk, 0, Math.min(chunk.length, left));
  } catch (error) {
    if (error.code !== "EAGAIN") throw error;
  }
}
const [target] = process.argv.splice(2, 1);
await import(target);
`;

let dir: string | undefined;
const connections: ConnectedMcpServer[] = [];

afterEach(async () => {
  await Promise.all(connections.map((c) => c.close().catch(() => undefined)));
  connections.length = 0;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

test("add --check does not stall on a server that floods stderr", async () => {
  dir = mkdtempSync(join(tmpdir(), "letta-mcp-check-stderr-"));
  const script = join(dir, "chatty.mjs");
  writeFileSync(script, CHATTY_SERVER);
  const stdout: string[] = [];
  const options: ConnectMcpServerOptions[] = [];

  const run = runMcpSubcommand(
    [
      "add",
      "chatty",
      "--command",
      process.execPath,
      "--arg",
      script,
      "--arg",
      pathToFileURL(EVERYTHING_SERVER).href,
      "--check",
    ],
    {
      env: { AGENT_ID: "agent-1" },
      initializeSettings: async () => {},
      isServerMcpAvailable: () => false,
      getLocalServers: () => [],
      updateLocalServers: async (_agentId, update) => update([]),
      cwd: () => dir ?? "/",
      connectLocalServer: async (config: McpServerConfig, opts = {}) => {
        options.push(opts);
        const connection = await connectMcpServer(config, opts);
        connections.push(connection);
        return connection;
      },
      stdout: (message) => stdout.push(message),
      stderr: () => {},
    },
  );
  const timedOut = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 20_000),
  );
  expect(await Promise.race([run, timedOut])).toBe(0);
  expect(options[0]?.stderr).toBe("ignore");
  const check = JSON.parse(stdout[0] ?? "{}").check;
  expect(check.status).toBe("connected");
  expect(check.tools).toBeGreaterThan(0);
}, 30_000);
