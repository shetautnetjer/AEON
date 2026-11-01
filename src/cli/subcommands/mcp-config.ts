import type { ConnectedMcpServer, McpServerConfig } from "@/mcp-client";
import {
  buildMcpServerConfig,
  type McpServerConfigInput,
} from "@/mcp-server-config";
import { settingsManager } from "@/settings-manager";
import { McpCliError, type McpOutput } from "./mcp-io";

/** parseArgs options for `letta mcp add`; spread into the shared parser. */
export const MCP_CONFIG_OPTIONS = {
  command: { type: "string" },
  arg: { type: "string", multiple: true },
  cwd: { type: "string" },
  env: { type: "string", multiple: true },
  url: { type: "string" },
  transport: { type: "string" },
  header: { type: "string", multiple: true },
  "auth-token-env": { type: "string" },
  replace: { type: "boolean" },
  check: { type: "boolean" },
} as const;

export interface McpConfigValues {
  command?: string;
  arg?: string[];
  cwd?: string;
  env?: string[];
  url?: string;
  transport?: string;
  header?: string[];
  "auth-token-env"?: string;
  replace?: boolean;
  check?: boolean;
}

export interface McpConfigDependencies {
  /** Persist the agent's client MCP servers. Defaults to settings + flush. */
  saveLocalServers?: (
    agentId: string,
    configs: McpServerConfig[],
  ) => Promise<void>;
  cwd?: () => string;
}

export interface McpConfigContext extends McpConfigDependencies {
  agentId: string;
  /** The agent's current client-local servers (from settings). */
  servers: McpServerConfig[];
  /** Redacted JSON view of a config; the same one `letta mcp get` prints. */
  describe: (config: McpServerConfig) => unknown;
  /** One non-interactive connection (no browser OAuth). */
  connect: (config: McpServerConfig) => Promise<ConnectedMcpServer>;
  stdout: McpOutput;
}

const ADD_USAGE =
  "Usage: letta mcp add <name> (--command <cmd> [--arg <a>]... [--cwd <dir>] [--env K=V]... | --url <url> [--transport http|sse] [--header K=V]... [--auth-token-env NAME]) [--replace] [--check]";

async function saveServers(
  ctx: McpConfigContext,
  configs: McpServerConfig[],
): Promise<void> {
  if (ctx.saveLocalServers) {
    await ctx.saveLocalServers(ctx.agentId, configs);
    return;
  }
  settingsManager.setMcpServers(ctx.agentId, configs);
  await settingsManager.flush();
}

function parsePairs(
  values: string[] | undefined,
  flag: string,
  separator: RegExp,
): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const value of values ?? []) {
    const match = value.match(separator);
    const key = match?.[1]?.trim();
    if (!key || match?.[2] === undefined) {
      throw new McpCliError(
        "invalid_arguments",
        `Invalid ${flag} value; expected KEY=VALUE`,
      );
    }
    pairs[key] = match[2].trim();
  }
  return pairs;
}

function parseTransport(value: string | undefined): "http" | "sse" {
  const normalized = value?.toLowerCase() ?? "http";
  if (normalized === "http" || normalized === "streamable_http") return "http";
  if (normalized === "sse") return "sse";
  throw new McpCliError(
    "invalid_arguments",
    `Unsupported --transport '${value}'; use http or sse`,
  );
}

function rejectFlags(values: McpConfigValues, flags: string[], why: string) {
  const present = flags.filter(
    (flag) => values[flag as keyof McpConfigValues] !== undefined,
  );
  if (present.length > 0) {
    throw new McpCliError(
      "invalid_arguments",
      `${present.map((flag) => `--${flag}`).join(", ")} ${why}`,
    );
  }
}

/** Translate `letta mcp add` flags into the shared config-builder input. */
export function parseMcpAddInput(
  name: string | undefined,
  values: McpConfigValues,
): McpServerConfigInput {
  if (!name?.trim()) throw new McpCliError("invalid_arguments", ADD_USAGE);
  if (Boolean(values.command) === Boolean(values.url)) {
    throw new McpCliError(
      "invalid_arguments",
      "Pass exactly one of --command (stdio) or --url (http/sse)",
      ADD_USAGE,
    );
  }
  if (values.command) {
    rejectFlags(
      values,
      ["transport", "header", "auth-token-env"],
      "only apply to --url servers",
    );
    return {
      transport: "stdio",
      name: name.trim(),
      command: values.command,
      args: values.arg ?? [],
      cwd: values.cwd ?? null,
      env: parsePairs(values.env, "--env", /^([^=]+)=(.*)$/s),
    };
  }
  rejectFlags(values, ["arg", "cwd", "env"], "only apply to --command servers");
  return {
    transport: parseTransport(values.transport),
    name: name.trim(),
    url: values.url ?? null,
    // Same "key: value" or "key=value" forms as the TUI /mcp add --header.
    headers: parsePairs(values.header, "--header", /^([^:=]+)[:=]\s*(.*)$/s),
    authTokenEnv: values["auth-token-env"] ?? null,
  };
}

async function checkConnection(
  ctx: McpConfigContext,
  config: McpServerConfig,
): Promise<
  { status: "connected"; tools: number } | { status: "failed"; error: string }
> {
  try {
    const connection = await ctx.connect(config);
    try {
      return { status: "connected", tools: connection.tools.length };
    } finally {
      await connection.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `letta mcp add`: write one client-local server to this agent's settings. */
export async function runMcpAdd(
  ctx: McpConfigContext,
  name: string | undefined,
  values: McpConfigValues,
): Promise<number> {
  const input = parseMcpAddInput(name, values);
  let config: McpServerConfig;
  try {
    config = buildMcpServerConfig(input, {
      cwd: (ctx.cwd ?? (() => process.cwd()))(),
    });
  } catch (error) {
    throw new McpCliError(
      "invalid_arguments",
      error instanceof Error ? error.message : String(error),
    );
  }
  const exists = ctx.servers.some((server) => server.name === config.name);
  if (exists && values.replace !== true) {
    throw new McpCliError(
      "server_exists",
      `MCP server '${config.name}' already exists for this agent`,
      "Pass --replace to overwrite it, or remove it first.",
    );
  }
  const configs = exists
    ? ctx.servers.map((server) =>
        server.name === config.name ? config : server,
      )
    : [...ctx.servers, config];
  await saveServers(ctx, configs);
  const check = values.check ? await checkConnection(ctx, config) : undefined;
  await ctx.stdout(
    JSON.stringify(
      {
        action: exists ? "replaced" : "added",
        server: ctx.describe(config),
        ...(check ? { check } : {}),
      },
      null,
      2,
    ),
  );
  return check?.status === "failed" ? 1 : 0;
}

/** `letta mcp remove`: delete one client-local server from this agent. */
export async function runMcpRemove(
  ctx: McpConfigContext,
  name: string | undefined,
): Promise<number> {
  if (!name) {
    throw new McpCliError(
      "invalid_arguments",
      "Usage: letta mcp remove <name>",
    );
  }
  const removed = ctx.servers.find((server) => server.name === name);
  if (!removed) {
    throw new McpCliError(
      "server_not_found",
      `No client MCP server named '${name}' is configured for this agent`,
      "Server-side MCP servers are managed through the Letta ADE or API.",
    );
  }
  await saveServers(
    ctx,
    ctx.servers.filter((server) => server !== removed),
  );
  await ctx.stdout(
    JSON.stringify(
      { action: "removed", server: ctx.describe(removed) },
      null,
      2,
    ),
  );
  return 0;
}
