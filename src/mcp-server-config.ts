import type { McpServerConfig } from "@/mcp-client";

/** Transport-agnostic fields a user supplies when adding a client MCP server. */
export interface McpServerConfigInput {
  transport: "http" | "sse" | "stdio";
  name: string;
  url?: string | null;
  command?: string | null;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Stored as an `Authorization: Bearer ${NAME}` placeholder, never a value. */
  authTokenEnv?: string | null;
}

const TOKEN_ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Build the settings entry for a client-local MCP server. Shared by the TUI
 * `/mcp add` command and the non-interactive `letta mcp add` subcommand.
 */
export function buildMcpServerConfig(
  input: McpServerConfigInput,
  defaults: { cwd: string },
): McpServerConfig {
  if (input.authTokenEnv && !TOKEN_ENV_NAME.test(input.authTokenEnv)) {
    throw new Error(
      `Invalid token environment variable name: ${input.authTokenEnv}`,
    );
  }
  const env = input.env ?? {};
  const headers = {
    ...input.headers,
    ...(input.authTokenEnv
      ? { Authorization: `Bearer \${${input.authTokenEnv}}` }
      : {}),
  };
  if (input.transport === "stdio") {
    if (!input.command) throw new Error("Command is required for stdio");
    return {
      name: input.name,
      transport: "stdio",
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd ?? defaults.cwd,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  if (!input.url) throw new Error("URL is required for HTTP/SSE");
  return {
    name: input.name,
    transport: input.transport,
    url: input.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}
