import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMcpSubcommand } from "@/cli/subcommands/mcp";
import type { McpServerConfig } from "@/mcp-client";
import { getClientMcpServerStates } from "@/mcp-runtime";
import { settingsManager } from "@/settings-manager";
import { reloadClientMcpServerList } from "./commands";

const EVERYTHING_SERVER = fileURLToPath(
  new URL(
    "./dist/index.js",
    import.meta.resolve("@modelcontextprotocol/server-everything/package.json"),
  ),
);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const AGENT = "agent-reload-mcp";
const OTHER_AGENT = "agent-reload-mcp-other";
const priorHome = process.env.HOME;
// Ambient agent/backend context would change the settings server key.
const CONTEXT_ENV = [
  "LETTA_LOCAL_BACKEND_EXPERIMENTAL",
  "LETTA_BASE_URL",
  "LETTA_AGENT_ID",
  "AGENT_ID",
  "LETTA_CODE_AGENT_ROLE",
  "LETTA_PARENT_AGENT_ID",
] as const;
const priorContext = CONTEXT_ENV.map((key) => [key, process.env[key]]);
let tempDir: string | undefined;

beforeEach(() => {
  for (const key of CONTEXT_ENV) delete process.env[key];
});

afterEach(async () => {
  await settingsManager.reset();
  for (const [key, value] of priorContext) {
    if (value === undefined) delete process.env[key as string];
    else process.env[key as string] = value;
  }
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

function diskServers(path: string, agentId: string): string[] | undefined {
  const disk = JSON.parse(readFileSync(path, "utf8"));
  return disk.agents
    .find((a: { agentId: string }) => a.agentId === agentId)
    ?.mcpServers?.map((s: McpServerConfig) => s.name);
}

/** Run `letta mcp <argv>` in a separate process sharing this HOME. */
function runCliInChildProcess(argv: string[]): Promise<number> {
  const script = `
    const { runMcpSubcommand } = await import(${JSON.stringify(
      join(REPO_ROOT, "src/cli/subcommands/mcp.ts"),
    )});
    const code = await runMcpSubcommand(${JSON.stringify(argv)}, {
      stdout: () => {},
      stderr: (m) => process.stderr.write(m),
    });
    process.exit(code);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: tempDir },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

test("reload re-reads the list from disk without connecting anything", async () => {
  const path = await startDaemonSettings();
  const disk = JSON.parse(readFileSync(path, "utf8"));
  disk.agents.find((a: { agentId: string }) => a.agentId === AGENT).mcpServers =
    [
      { name: "a", transport: "stdio", command: "never-run-a" },
      { name: "b", transport: "stdio", command: "never-run-b" },
    ];
  writeFileSync(path, JSON.stringify(disk));
  expect(settingsManager.getMcpServers(AGENT)).toEqual([]);

  expect(await reloadClientMcpServerList(AGENT)).toBe(
    "MCP: 2 servers configured",
  );
  expect(settingsManager.getMcpServers(AGENT).map((s) => s.name)).toEqual([
    "a",
    "b",
  ]);
  expect(getClientMcpServerStates(AGENT)).toEqual([]);

  writeFileSync(path, "{ not json sk-secret");
  expect(await reloadClientMcpServerList(AGENT)).toBe(
    "MCP: could not read the MCP server list from settings",
  );
});

test("a daemon flush keeps servers another process added, for every agent", async () => {
  const path = await startDaemonSettings();
  settingsManager.setMcpServers(AGENT, [
    { name: "own", transport: "stdio", command: "own" },
  ]);
  await settingsManager.flush();

  // Another process adds to this agent and creates a second agent's entry.
  for (const [agent, name] of [
    [AGENT, "added"],
    [OTHER_AGENT, "other"],
  ]) {
    expect(
      await runCliInChildProcess([
        "add",
        name as string,
        "--command",
        "srv",
        "--agent",
        agent as string,
      ]),
    ).toBe(0);
  }
  expect(statSync(path).mode & 0o777).toBe(0o600);

  // An unrelated daemon write of the whole agents array (stale snapshot).
  settingsManager.pinAgent(AGENT);
  await settingsManager.flush();
  expect(diskServers(path, AGENT)).toEqual(["own", "added"]);
  expect(diskServers(path, OTHER_AGENT)).toEqual(["other"]);

  // A change this process makes itself still wins for its own agent.
  settingsManager.setMcpServers(AGENT, []);
  await settingsManager.flush();
  expect(diskServers(path, AGENT) ?? []).toEqual([]);
  expect(diskServers(path, OTHER_AGENT)).toEqual(["other"]);
}, 30_000);

test("concurrent adds from separate processes are all kept", async () => {
  const path = await startDaemonSettings();
  const names = ["p1", "p2", "p3", "p4"];
  const codes = await Promise.all(
    names.map((name) =>
      runCliInChildProcess(["add", name, "--command", "srv", "--agent", AGENT]),
    ),
  );
  expect(codes).toEqual([0, 0, 0, 0]);
  expect(diskServers(path, AGENT)?.sort()).toEqual(names);
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
  expect(statSync(join(tempDir, ".letta", "settings.json")).mode & 0o777).toBe(
    0o600,
  );

  out.length = 0;
  expect(await runMcpSubcommand(["tools", "everything"], io)).toBe(0);
  expect(JSON.parse(out[0] ?? "[]").length).toBeGreaterThan(0);

  out.length = 0;
  expect(await runMcpSubcommand(["remove", "everything"], io)).toBe(0);
  expect(await runMcpSubcommand(["list"], io)).toBe(0);
  expect(JSON.parse(out[1] ?? "null")).toEqual([]);
}, 30_000);
