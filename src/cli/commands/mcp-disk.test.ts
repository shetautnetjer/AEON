import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuffers } from "@/cli/helpers/accumulator";
import type { McpServerConfig } from "@/mcp-client";
import { replaceClientMcpServers } from "@/mcp-runtime";
import { settingsManager } from "@/settings-manager";
import { setServiceName } from "@/utils/secrets";
import { handleMcpAdd, removeAgentMcpServer } from "./mcp";

const AGENT = "agent-tui-mcp";
const originalHome = process.env.HOME;
let testHome: string;

// Commands that cannot start: the TUI reconnect fails fast, which is fine —
// these tests are about what is written to the settings file.
const missingCommand = (name: string) =>
  join(tmpdir(), `letta-missing-mcp-${name}`);
const server = (name: string): McpServerConfig => ({
  name,
  transport: "stdio",
  command: missingCommand(name),
  args: [],
});

const settingsPath = () => join(testHome, ".letta", "settings.json");

function diskServers(): string[] {
  const settings = JSON.parse(readFileSync(settingsPath(), "utf8"));
  const entry = settings.agents.find(
    (agent: { agentId: string }) => agent.agentId === AGENT,
  );
  return (entry?.mcpServers ?? []).map((s: McpServerConfig) => s.name);
}

/** Simulate another process changing this agent's servers on disk. */
function writeDiskServers(servers: McpServerConfig[]): void {
  const settings = JSON.parse(readFileSync(settingsPath(), "utf8"));
  settings.agents = settings.agents.map((agent: { agentId: string }) =>
    agent.agentId === AGENT ? { ...agent, mcpServers: servers } : agent,
  );
  writeFileSync(settingsPath(), JSON.stringify(settings));
}

function tuiContext() {
  const buffersRef = { current: createBuffers(AGENT) };
  return {
    buffersRef,
    ctx: {
      agentId: AGENT,
      buffersRef,
      refreshDerived: () => {},
      setCommandRunning: () => {},
    },
    output: () =>
      [...buffersRef.current.byId.values()]
        .map((line) => ("output" in line ? String(line.output) : ""))
        .join("\n"),
  };
}

beforeEach(async () => {
  await settingsManager.reset();
  testHome = await mkdtemp(join(tmpdir(), "letta-tui-mcp-disk-"));
  process.env.HOME = testHome;
  setServiceName("letta-code-tui-mcp-disk-test");
  await settingsManager.initialize();
  settingsManager.setMcpServers(AGENT, [server("a")]);
  await settingsManager.flush();
});

afterEach(async () => {
  await replaceClientMcpServers(AGENT, []);
  await settingsManager.reset();
  process.env.HOME = originalHome;
  setServiceName("letta-code");
  await rm(testHome, { recursive: true, force: true });
});

describe("TUI /mcp add and remove write by name against disk", () => {
  test("/mcp add keeps a server another process added", async () => {
    writeDiskServers([server("a"), server("b")]);
    const { ctx } = tuiContext();
    await handleMcpAdd(
      ctx,
      "/mcp add",
      `--transport stdio c ${missingCommand("c")}`,
    );
    expect(diskServers()).toEqual(["a", "b", "c"]);
    expect(settingsManager.getMcpServers(AGENT).map((s) => s.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("/mcp add refuses a name that exists on disk only", async () => {
    writeDiskServers([server("a"), server("c")]);
    const { ctx, output } = tuiContext();
    await handleMcpAdd(
      ctx,
      "/mcp add",
      `--transport stdio c ${missingCommand("c")}`,
    );
    expect(output()).toContain('MCP server "c" already exists');
    expect(diskServers()).toEqual(["a", "c"]);
  });

  test("selector remove keeps a server another process added", async () => {
    writeDiskServers([server("a"), server("b")]);
    const configs = await removeAgentMcpServer(AGENT, "a");
    expect(configs.map((s) => s.name)).toEqual(["b"]);
    expect(diskServers()).toEqual(["b"]);
    expect(settingsManager.getMcpServers(AGENT).map((s) => s.name)).toEqual([
      "b",
    ]);
  });
});
