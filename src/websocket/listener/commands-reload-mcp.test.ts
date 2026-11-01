import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMcpSubcommand } from "@/cli/subcommands/mcp";
import type { McpServerConfig } from "@/mcp-client";
import { closeClientMcpServers, getClientMcpServerStates } from "@/mcp-runtime";
import { settingsManager } from "@/settings-manager";
import { refreshClientMcpServers } from "./commands";

const EVERYTHING_SERVER = fileURLToPath(
  new URL(
    "./dist/index.js",
    import.meta.resolve("@modelcontextprotocol/server-everything/package.json"),
  ),
);
const AGENT = "agent-reload-mcp";
const priorHome = process.env.HOME;
let tempDir: string | undefined;

afterEach(async () => {
  await closeClientMcpServers();
  await settingsManager.reset();
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function startDaemonSettings(): Promise<string> {
  tempDir = mkdtempSync(join(tmpdir(), "reload-mcp-"));
  process.env.HOME = tempDir;
  await settingsManager.reset();
  await settingsManager.initialize();
  // The daemon owns (and has dirtied) this agent's entry with no servers.
  settingsManager.setMcpServers(AGENT, []);
  await settingsManager.flush();
  return join(tempDir, ".letta", "settings.json");
}

/** Simulate another process (`letta mcp add`) editing settings on disk. */
function writeServersFromOtherProcess(
  path: string,
  servers: McpServerConfig[],
) {
  const disk = JSON.parse(readFileSync(path, "utf8"));
  const entry = disk.agents.find(
    (a: { agentId: string }) => a.agentId === AGENT,
  );
  entry.mcpServers = servers;
  writeFileSync(path, JSON.stringify(disk, null, 2));
}

test("reload adopts servers added by another process and connects them", async () => {
  const path = await startDaemonSettings();
  writeServersFromOtherProcess(path, [
    {
      name: "everything",
      transport: "stdio",
      command: process.execPath,
      args: [EVERYTHING_SERVER],
    },
    {
      name: "broken",
      transport: "stdio",
      command: join(tempDir ?? "", "missing-binary"),
    },
  ]);
  expect(settingsManager.getMcpServers(AGENT)).toEqual([]);

  const summary = await refreshClientMcpServers(AGENT);

  expect(summary).toMatch(
    /^MCP: 1\/2 servers connected \(\d+ tools\)\n {2}broken: /,
  );
  expect(settingsManager.getMcpServers(AGENT).map((s) => s.name)).toEqual([
    "everything",
    "broken",
  ]);
  const states = getClientMcpServerStates(AGENT);
  expect(states.find((s) => s.config.name === "everything")?.status).toBe(
    "connected",
  );

  // A later daemon write of the agents array must keep the adopted servers.
  settingsManager.setMcpServers(AGENT, settingsManager.getMcpServers(AGENT));
  await settingsManager.flush();
  const disk = JSON.parse(readFileSync(path, "utf8"));
  expect(
    disk.agents.find((a: { agentId: string }) => a.agentId === AGENT)
      .mcpServers,
  ).toHaveLength(2);
}, 30_000);

test("reload reports removals and never throws on a timeout", async () => {
  const path = await startDaemonSettings();
  writeServersFromOtherProcess(path, []);
  expect(await refreshClientMcpServers(AGENT)).toBe(
    "MCP: 0/0 servers connected (0 tools)",
  );

  writeServersFromOtherProcess(path, [
    // Starts but never speaks MCP, so the connection never completes.
    { name: "silent", transport: "stdio", command: "sleep", args: ["2"] },
  ]);
  expect(await refreshClientMcpServers(AGENT, 100)).toBe(
    "MCP: refresh timed out after 0s",
  );
  expect(getClientMcpServerStates(AGENT)).toEqual([]);
}, 30_000);

test("letta mcp add writes settings that a fresh `tools` call can use", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-add-e2e-"));
  process.env.HOME = tempDir;
  await settingsManager.reset();
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    env: { AGENT_ID: AGENT },
    isServerMcpAvailable: () => false,
    stdout: (m: string) => out.push(m),
    stderr: (m: string) => err.push(m),
  };
  expect(
    await runMcpSubcommand(
      [
        "add",
        "everything",
        "--command",
        process.execPath,
        `--arg=${EVERYTHING_SERVER}`,
        "--check",
      ],
      io,
    ),
  ).toBe(0);
  expect(err).toEqual([]);
  expect(JSON.parse(out[0] ?? "{}").check.status).toBe("connected");

  out.length = 0;
  expect(await runMcpSubcommand(["tools", "everything"], io)).toBe(0);
  expect(JSON.parse(out[0] ?? "[]").length).toBeGreaterThan(0);

  out.length = 0;
  expect(await runMcpSubcommand(["remove", "everything"], io)).toBe(0);
  expect(await runMcpSubcommand(["list"], io)).toBe(0);
  expect(JSON.parse(out[1] ?? "null")).toEqual([]);
}, 30_000);
