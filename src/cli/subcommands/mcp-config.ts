import type { ConnectedMcpServer, McpServerConfig } from "@/mcp-client";
import {
  buildMcpServerConfig,
  type McpServerConfigInput,
} from "@/mcp-server-config";
import { settingsManager } from "@/settings-manager";
import { McpCliError, type McpOutput } from "./mcp-io";
import { SENSITIVE_NAME } from "./mcp-redaction";

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
  /**
   * Locked read-modify-write of only this agent's client MCP servers on disk.
   * Defaults to settingsManager.mcpDisk.update; must throw on failure.
   */
  updateLocalServers?: (
    agentId: string,
    update: (current: McpServerConfig[]) => McpServerConfig[],
  ) => Promise<McpServerConfig[]>;
  cwd?: () => string;
}

export interface McpConfigContext extends McpConfigDependencies {
  agentId: string;
  /** Redacted JSON view of a config; the same one `letta mcp get` prints. */
  describe: (config: McpServerConfig) => unknown;
  /** One non-interactive connection (no browser OAuth). */
  connect: (config: McpServerConfig) => Promise<ConnectedMcpServer>;
  stdout: McpOutput;
}

const ADD_USAGE =
  "Usage: letta mcp add <name> (--command <cmd> [--arg <a>]... [--cwd <dir>] [--env K=V]... | --url <url> [--transport http|sse] [--header K=V]... [--auth-token-env NAME]) [--replace] [--check]";

async function updateServers(
  ctx: McpConfigContext,
  update: (current: McpServerConfig[]) => McpServerConfig[],
): Promise<void> {
  const write =
    ctx.updateLocalServers ??
    ((agentId, fn) => settingsManager.mcpDisk.update(agentId, fn));
  try {
    await write(ctx.agentId, update);
  } catch (error) {
    if (error instanceof McpCliError) throw error;
    // Our own text only: the cause can quote settings content.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    throw new McpCliError(
      "settings_write_failed",
      "Could not update MCP servers in the settings file",
      typeof code === "string" && /^E[A-Z0-9_]+$/.test(code)
        ? `Filesystem error ${code}`
        : undefined,
    );
  }
}

/**
 * KEY=VALUE pairs. Keys are trimmed. Header values are trimmed like the TUI
 * /mcp add parser; --env values are kept byte-for-byte (`trimValues` false).
 */
function parsePairs(
  values: string[] | undefined,
  flag: string,
  separator: RegExp,
  trimValues: boolean,
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
    pairs[key] = trimValues ? match[2].trim() : match[2];
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
      env: parsePairs(values.env, "--env", /^([^=]+)=(.*)$/s, false),
    };
  }
  rejectFlags(values, ["arg", "cwd", "env"], "only apply to --command servers");
  return {
    transport: parseTransport(values.transport),
    name: name.trim(),
    url: values.url ?? null,
    // Same "key: value" or "key=value" forms as the TUI /mcp add --header.
    headers: parsePairs(
      values.header,
      "--header",
      /^([^:=]+)[:=]\s*(.*)$/s,
      true,
    ),
    authTokenEnv: values["auth-token-env"] ?? null,
  };
}

type CheckResult =
  | { status: "connected"; tools: number }
  | {
      status: "failed";
      error: string;
      errorClass: string;
      httpStatus?: number;
      errorCode?: string;
    };

/**
 * Fixed text plus non-secret facts only. SDK and server error messages can
 * echo URLs, headers or response bodies, so they are never printed.
 */
export function describeCheckFailure(
  error: unknown,
): Extract<CheckResult, { status: "failed" }> {
  const record = (error ?? {}) as Record<string, unknown>;
  const name = error instanceof Error ? error.name : "";
  const status = [record.status, record.code].find(
    (value): value is number =>
      typeof value === "number" && value >= 100 && value < 600,
  );
  const code =
    typeof record.code === "string" && /^E[A-Z0-9_]+$/.test(record.code)
      ? record.code
      : undefined;
  return {
    status: "failed",
    error: "Connection check failed",
    errorClass: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "Error",
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(code ? { errorCode: code } : {}),
  };
}

async function checkConnection(
  ctx: McpConfigContext,
  config: McpServerConfig,
): Promise<CheckResult> {
  try {
    const connection = await ctx.connect(config);
    try {
      return { status: "connected", tools: connection.tools.length };
    } finally {
      await connection.close().catch(() => undefined);
    }
  } catch (error) {
    return describeCheckFailure(error);
  }
}

const LITERAL_SECRET_WARNING =
  "literal secret-looking values stored in settings; prefer --auth-token-env";

/** True when a user-supplied --env/--header has a sensitive name and a literal value. */
function hasLiteralSecret(input: McpServerConfigInput): boolean {
  const pairs = input.transport === "stdio" ? input.env : input.headers;
  return Object.entries(pairs ?? {}).some(
    ([name, value]) =>
      SENSITIVE_NAME.test(name) &&
      !/^(Bearer\s+)?\$\{[A-Z_][A-Z0-9_]*\}$/.test(value),
  );
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
  const result = { replaced: false };
  await updateServers(ctx, (current) => {
    const replaced = current.some((server) => server.name === config.name);
    if (replaced && values.replace !== true) {
      throw new McpCliError(
        "server_exists",
        `MCP server '${config.name}' already exists for this agent`,
        "Pass --replace to overwrite it, or remove it first.",
      );
    }
    result.replaced = replaced;
    return replaced
      ? current.map((server) => (server.name === config.name ? config : server))
      : [...current, config];
  });
  const check = values.check ? await checkConnection(ctx, config) : undefined;
  await ctx.stdout(
    JSON.stringify(
      {
        action: result.replaced ? "replaced" : "added",
        server: ctx.describe(config),
        ...(hasLiteralSecret(input) ? { warning: LITERAL_SECRET_WARNING } : {}),
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
  const result: { removed?: McpServerConfig } = {};
  await updateServers(ctx, (current) => {
    const removed = current.find((server) => server.name === name);
    if (!removed) {
      throw new McpCliError(
        "server_not_found",
        `No client MCP server named '${name}' is configured for this agent`,
        "Server-side MCP servers are managed through the Letta ADE or API.",
      );
    }
    result.removed = removed;
    return current.filter((server) => server !== removed);
  });
  await ctx.stdout(
    JSON.stringify(
      {
        action: "removed",
        server: result.removed && ctx.describe(result.removed),
      },
      null,
      2,
    ),
  );
  return 0;
}
