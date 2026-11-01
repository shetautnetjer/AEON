import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "./mcp-client";
import {
  agentEntryKey,
  mergeAgentsWithDisk,
  updateAgentMcpServersOnDisk,
} from "./settings-agent-mcp-disk";

const server = (name: string): McpServerConfig => ({
  name,
  transport: "stdio",
  command: name,
});
let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

test("disk servers win unless this process changed that agent", () => {
  const memory = [
    { agentId: "a", pinned: true, mcpServers: [server("stale")] },
    { agentId: "b", mcpServers: [server("mine")] },
    { agentId: "c", baseUrl: "http://x", pinned: true },
  ];
  const disk = [
    { agentId: "a", mcpServers: [server("external")] },
    { agentId: "b", mcpServers: [server("external-b")] },
    { agentId: "c", baseUrl: "http://x", mcpServers: [server("c1")] },
    { agentId: "d", mcpServers: [server("disk-only")] },
  ];
  expect(
    mergeAgentsWithDisk(memory, disk, new Set([agentEntryKey("b")])),
  ).toEqual([
    { agentId: "a", pinned: true, mcpServers: [server("external")] },
    { agentId: "b", mcpServers: [server("mine")] },
    {
      agentId: "c",
      baseUrl: "http://x",
      pinned: true,
      mcpServers: [server("c1")],
    },
    { agentId: "d", mcpServers: [server("disk-only")] },
  ]);
});

test("an agent missing on disk stays deleted unless this process changed it", () => {
  const memory = [
    { agentId: "gone", pinned: true, mcpServers: [server("stale")] },
    { agentId: "touched", pinned: true, mcpServers: [server("stale-t")] },
    { agentId: "own", mcpServers: [server("mine")] },
  ];
  const own = new Set([agentEntryKey("own")]);
  const touched = new Set([agentEntryKey("touched"), agentEntryKey("own")]);
  const expected = [
    { agentId: "touched", pinned: true },
    { agentId: "own", mcpServers: [server("mine")] },
  ];
  // Entry deleted externally, and the whole agents array deleted externally.
  expect(mergeAgentsWithDisk(memory, [], own, touched)).toEqual(expected);
  expect(mergeAgentsWithDisk(memory, undefined, own, touched)).toEqual(
    expected,
  );
  expect(mergeAgentsWithDisk(memory, undefined, new Set())).toEqual([]);
});

test("update changes only the target agent, atomically, mode 0600", () => {
  dir = mkdtempSync(join(tmpdir(), "agent-mcp-disk-"));
  const path = join(dir, "settings.json");
  writeFileSync(
    path,
    JSON.stringify({
      theme: "dark",
      agents: [{ agentId: "other", mcpServers: [server("keep")] }],
    }),
    { mode: 0o644 },
  );
  updateAgentMcpServersOnDisk(path, "a", undefined, (current) => [
    ...current,
    server("new"),
  ]);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    theme: "dark",
    agents: [
      { agentId: "other", mcpServers: [server("keep")] },
      { agentId: "a", mcpServers: [server("new")] },
    ],
  });
  expect(statSync(path).mode & 0o777).toBe(0o600);

  const before = readFileSync(path, "utf8");
  expect(() =>
    updateAgentMcpServersOnDisk(path, "a", undefined, () => {
      throw new Error("abort");
    }),
  ).toThrow("abort");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(readdirSync(dir).sort()).toEqual(["settings.json"]);

  writeFileSync(path, "{ corrupt");
  expect(() =>
    updateAgentMcpServersOnDisk(path, "a", undefined, (c) => c),
  ).toThrow();
  expect(readFileSync(path, "utf8")).toBe("{ corrupt");
});

test("update never chmods an existing settings directory", () => {
  if (process.platform === "win32") return;
  dir = mkdtempSync(join(tmpdir(), "agent-mcp-disk-"));
  const letta = join(dir, ".letta");
  mkdirSync(letta, { mode: 0o755 });
  const before = statSync(letta).mode & 0o777;
  expect(before & 0o055).not.toBe(0);
  updateAgentMcpServersOnDisk(
    join(letta, "settings.json"),
    "a",
    undefined,
    () => [server("one")],
  );
  expect(statSync(letta).mode & 0o777).toBe(before);
});
