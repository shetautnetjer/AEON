// Cross-process-safe handling of per-agent `mcpServers` in the global
// settings file (~/.letta/settings.json). The settings manager writes the
// whole `agents` array from memory; these helpers keep one process's stale
// snapshot from reverting another process's MCP server change.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentSettings } from "./agent-settings";
import type { McpServerConfig } from "./mcp-client";
import { isRecord } from "./utils/type-guards";
import {
  acquireDurableFileLock,
  fsyncDirectory,
} from "./websocket/listener/durable-file-lock";

const LOCK_WAIT_MS = 5_000;

/** Identity of one agent entry: agent ID plus server (baseUrl). */
export function agentEntryKey(agentId: string, baseUrl?: string): string {
  return `${agentId}\u0000${baseUrl ?? ""}`;
}

function entryKey(entry: unknown): string | undefined {
  if (!isRecord(entry) || typeof entry.agentId !== "string") return undefined;
  return agentEntryKey(
    entry.agentId,
    typeof entry.baseUrl === "string" ? entry.baseUrl : undefined,
  );
}

/**
 * Build the `agents` array to persist from this process's copy. For agents
 * whose MCP servers this process did not change (`ownMcpKeys`), the value on
 * disk wins; agent entries that exist only on disk are kept.
 */
export function mergeAgentsWithDisk(
  memory: AgentSettings[],
  disk: unknown,
  ownMcpKeys: ReadonlySet<string>,
): AgentSettings[] {
  if (!Array.isArray(disk)) return memory;
  const diskByKey = new Map<string, Record<string, unknown>>();
  for (const entry of disk) {
    const key = entryKey(entry);
    if (key && isRecord(entry)) diskByKey.set(key, entry);
  }
  const merged = memory.map((agent) => {
    const key = agentEntryKey(agent.agentId, agent.baseUrl);
    const onDisk = diskByKey.get(key);
    diskByKey.delete(key);
    if (!onDisk || ownMcpKeys.has(key)) return agent;
    const { mcpServers: _ignored, ...rest } = agent;
    return Array.isArray(onDisk.mcpServers)
      ? { ...rest, mcpServers: onDisk.mcpServers as McpServerConfig[] }
      : rest;
  });
  return [...merged, ...(diskByKey.values() as Iterable<AgentSettings>)];
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Settings file is not a JSON object");
  return parsed;
}

/** Atomic replace: unique 0600 temp file, fsync, rename, fsync directory. */
function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, contents, { mode: 0o600, flag: "wx" });
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

/** One agent's MCP servers as currently stored on disk. */
export function readAgentMcpServersFromDisk(
  path: string,
  agentId: string,
  baseUrl: string | undefined,
): McpServerConfig[] | undefined {
  const agents = readSettingsFile(path).agents;
  if (!Array.isArray(agents)) return undefined;
  const key = agentEntryKey(agentId, baseUrl);
  const entry = agents.find((candidate) => entryKey(candidate) === key);
  return isRecord(entry) && Array.isArray(entry.mcpServers)
    ? (entry.mcpServers as McpServerConfig[])
    : undefined;
}

/**
 * Under the settings file lock: read the file, replace only this agent's
 * `mcpServers` with `update(current)`, and atomically rewrite it (0600).
 * `update` may throw to abort without writing. Throws on any failure.
 */
export function updateAgentMcpServersOnDisk(
  path: string,
  agentId: string,
  baseUrl: string | undefined,
  update: (current: McpServerConfig[]) => McpServerConfig[],
): McpServerConfig[] {
  const release = acquireDurableFileLock(path, {
    waitMs: LOCK_WAIT_MS,
    preserveExistingParentMode: true,
  });
  try {
    const settings = readSettingsFile(path);
    const agents = Array.isArray(settings.agents) ? [...settings.agents] : [];
    const key = agentEntryKey(agentId, baseUrl);
    const index = agents.findIndex((candidate) => entryKey(candidate) === key);
    const current = isRecord(agents[index]) ? agents[index] : undefined;
    const next = update(
      Array.isArray(current?.mcpServers)
        ? (current.mcpServers as McpServerConfig[])
        : [],
    );
    const entry = current
      ? { ...current, mcpServers: next }
      : { agentId, ...(baseUrl ? { baseUrl } : {}), mcpServers: next };
    if (index >= 0) agents[index] = entry;
    else agents.push(entry);
    writeFileAtomic(path, JSON.stringify({ ...settings, agents }, null, 2));
    return next;
  } finally {
    release();
  }
}

export interface AgentMcpDiskHost {
  path(): string;
  /** Current server key ("api.letta.com" means no baseUrl). */
  serverKey(): string;
  agents(): AgentSettings[];
  /** Replace the in-memory agents array without marking it dirty. */
  setAgents(agents: AgentSettings[]): void;
  flush(): Promise<void>;
}

/**
 * The settings manager's per-agent MCP bookkeeping: which agents' servers
 * this process changed itself, the merge used when `agents` is persisted,
 * and the disk-first reload/update used by `letta mcp` and remote reload.
 */
export class AgentMcpDiskSync {
  // Agent entry key -> generation of this process's last own change.
  private own = new Map<string, number>();

  constructor(private readonly host: AgentMcpDiskHost) {}

  private baseUrl(): string | undefined {
    const key = this.host.serverKey();
    return key === "api.letta.com" ? undefined : key;
  }

  /** Record that this process itself set the agent's servers. */
  markOwn(agentId: string): void {
    const key = agentEntryKey(agentId, this.baseUrl());
    this.own.set(key, (this.own.get(key) ?? 0) + 1);
  }

  snapshot(): Map<string, number> {
    return new Map(this.own);
  }

  merge(
    memory: AgentSettings[],
    disk: unknown,
    snapshot: Map<string, number>,
  ): AgentSettings[] {
    return mergeAgentsWithDisk(memory, disk, new Set(snapshot.keys()));
  }

  /** After a successful write, external changes to those agents win again. */
  written(snapshot: Map<string, number>): void {
    for (const [key, generation] of snapshot) {
      if (this.own.get(key) === generation) this.own.delete(key);
    }
  }

  clear(): void {
    this.own.clear();
  }

  /** Mirror one agent's on-disk servers in memory without dirtying them. */
  private adopt(agentId: string, servers?: McpServerConfig[]): void {
    const baseUrl = this.baseUrl();
    const key = agentEntryKey(agentId, baseUrl);
    this.own.delete(key);
    const agents = [...this.host.agents()];
    const index = agents.findIndex(
      (agent) => agentEntryKey(agent.agentId, agent.baseUrl) === key,
    );
    const current = agents[index];
    if (current) agents[index] = { ...current, mcpServers: servers };
    else if (servers) agents.push({ agentId, baseUrl, mcpServers: servers });
    this.host.setAgents(agents);
  }

  /** Adopt one agent's servers from disk (another process may have changed them). */
  async reload(agentId: string): Promise<McpServerConfig[]> {
    await this.host.flush();
    const servers = readAgentMcpServersFromDisk(
      this.host.path(),
      agentId,
      this.baseUrl(),
    );
    this.adopt(agentId, servers);
    return servers ?? [];
  }

  /** Locked, atomic (0600) change of only this agent's servers. Throws on failure. */
  async update(
    agentId: string,
    update: (current: McpServerConfig[]) => McpServerConfig[],
  ): Promise<McpServerConfig[]> {
    await this.host.flush();
    const servers = updateAgentMcpServersOnDisk(
      this.host.path(),
      agentId,
      this.baseUrl(),
      update,
    );
    this.adopt(agentId, servers);
    return servers;
  }
}
