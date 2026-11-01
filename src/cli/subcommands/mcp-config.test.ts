import { describe, expect, test } from "bun:test";
import type { ConnectedMcpServer, McpServerConfig } from "@/mcp-client";
import { type McpSubcommandDependencies, runMcpSubcommand } from "./mcp";

interface ConfigHarness {
  deps: McpSubcommandDependencies;
  stdout: string[];
  stderr: string[];
  saves: Array<{ agentId: string; configs: McpServerConfig[] }>;
  connects: McpServerConfig[];
}

function configHarness(
  options: {
    servers?: McpServerConfig[];
    connect?: (config: McpServerConfig) => Promise<ConnectedMcpServer>;
  } = {},
): ConfigHarness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const saves: ConfigHarness["saves"] = [];
  const connects: McpServerConfig[] = [];
  return {
    stdout,
    stderr,
    saves,
    connects,
    deps: {
      env: { AGENT_ID: "agent-1" },
      initializeSettings: async () => {},
      isServerMcpAvailable: () => false,
      getLocalServers: () => options.servers ?? [],
      saveLocalServers: async (agentId, configs) => {
        saves.push({ agentId, configs });
      },
      cwd: () => "/work",
      connectLocalServer: async (config) => {
        connects.push(config);
        if (!options.connect) throw new Error("Unexpected MCP connection");
        return options.connect(config);
      },
      createOAuthSession: async () => {
        throw new Error("add --check must not start OAuth for header auth");
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  };
}

const existing: McpServerConfig = {
  name: "docs",
  transport: "stdio",
  command: "old-docs",
  args: [],
};

function errorOf(harness: ConfigHarness) {
  return JSON.parse(harness.stderr[0] ?? "{}").error;
}

describe("letta mcp add/remove", () => {
  test("adds a stdio server with args, cwd default and env, redacting env", async () => {
    const harness = configHarness({ servers: [existing] });
    const code = await runMcpSubcommand(
      [
        "add",
        "files",
        "--command",
        "npx",
        "--arg=-y",
        "--arg",
        "@scope/server",
        "--arg=--api-key=sk-live-123",
        "--env",
        "API_TOKEN=sk-env-456",
      ],
      harness.deps,
    );
    expect(code).toBe(0);
    expect(harness.saves).toEqual([
      {
        agentId: "agent-1",
        configs: [
          existing,
          {
            name: "files",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@scope/server", "--api-key=sk-live-123"],
            cwd: "/work",
            env: { API_TOKEN: "sk-env-456" },
          },
        ],
      },
    ]);
    expect(JSON.parse(harness.stdout[0] ?? "{}")).toEqual({
      action: "added",
      server: {
        name: "files",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@scope/server", "--api-key=[REDACTED]"],
        cwd: "/work",
        env: { API_TOKEN: "[REDACTED]" },
      },
    });
    expect(harness.stdout.join("")).not.toContain("sk-");
    expect(harness.connects).toEqual([]);
  });

  test("adds an http server with --auth-token-env as a placeholder only", async () => {
    const harness = configHarness();
    const code = await runMcpSubcommand(
      [
        "add",
        "remote",
        "--url",
        "https://mcp.example.test/mcp?api_key=abc123",
        "--header",
        "X-Secret=hdr-789",
        "--auth-token-env",
        "REMOTE_MCP_TOKEN",
      ],
      {
        ...harness.deps,
        env: { AGENT_ID: "agent-1", REMOTE_MCP_TOKEN: "tok-value" },
      },
    );
    expect(code).toBe(0);
    const saved = harness.saves[0]?.configs[0];
    expect(saved).toEqual({
      name: "remote",
      transport: "http",
      url: "https://mcp.example.test/mcp?api_key=abc123",
      headers: {
        "X-Secret": "hdr-789",
        Authorization: `Bearer \${REMOTE_MCP_TOKEN}`,
      },
    });
    expect(JSON.stringify(saved)).not.toContain("tok-value");
    const output = harness.stdout.join("");
    expect(JSON.parse(output)).toEqual({
      action: "added",
      server: {
        name: "remote",
        transport: "streamable_http",
        url: "https://mcp.example.test/mcp?api_key=%5BREDACTED%5D",
        headers: { Authorization: "[REDACTED]", "X-Secret": "[REDACTED]" },
      },
    });
    expect(output).not.toContain("hdr-789");
    expect(output).not.toContain("abc123");
  });

  test("accepts --transport sse", async () => {
    const harness = configHarness();
    expect(
      await runMcpSubcommand(
        ["add", "events", "--url", "https://e.test/sse", "--transport", "sse"],
        harness.deps,
      ),
    ).toBe(0);
    expect(harness.saves[0]?.configs[0]).toEqual({
      name: "events",
      transport: "sse",
      url: "https://e.test/sse",
    });
  });

  test("refuses a duplicate name without --replace", async () => {
    const harness = configHarness({ servers: [existing] });
    expect(
      await runMcpSubcommand(
        ["add", "docs", "--command", "new-docs"],
        harness.deps,
      ),
    ).toBe(1);
    expect(harness.saves).toEqual([]);
    expect(errorOf(harness)).toEqual({
      code: "server_exists",
      message: "MCP server 'docs' already exists for this agent",
      hint: "Pass --replace to overwrite it, or remove it first.",
    });
  });

  test("--replace overwrites in place and keeps order", async () => {
    const other: McpServerConfig = {
      name: "z",
      transport: "sse",
      url: "https://z.test",
    };
    const harness = configHarness({ servers: [existing, other] });
    expect(
      await runMcpSubcommand(
        ["add", "docs", "--command", "new-docs", "--replace"],
        harness.deps,
      ),
    ).toBe(0);
    expect(harness.saves[0]?.configs).toEqual([
      {
        name: "docs",
        transport: "stdio",
        command: "new-docs",
        args: [],
        cwd: "/work",
      },
      other,
    ]);
    expect(JSON.parse(harness.stdout[0] ?? "{}").action).toBe("replaced");
  });

  test("rejects ambiguous or mismatched flags without saving", async () => {
    const cases: Array<[string[], string]> = [
      [
        ["add", "x"],
        "Pass exactly one of --command (stdio) or --url (http/sse)",
      ],
      [
        ["add", "x", "--command", "c", "--url", "https://x.test"],
        "Pass exactly one of --command (stdio) or --url (http/sse)",
      ],
      [
        ["add", "x", "--command", "c", "--header", "A=b"],
        "--header only apply to --url servers",
      ],
      [
        ["add", "x", "--url", "https://x.test", "--env", "A=b"],
        "--env only apply to --command servers",
      ],
      [
        ["add", "x", "--command", "c", "--env", "NOEQUALS"],
        "Invalid --env value; expected KEY=VALUE",
      ],
      [
        ["add", "x", "--url", "https://x.test", "--transport", "ws"],
        "Unsupported --transport 'ws'; use http or sse",
      ],
      [
        ["add", "x", "--url", "https://x.test", "--auth-token-env", "bad-name"],
        "Invalid token environment variable name: bad-name",
      ],
    ];
    for (const [argv, message] of cases) {
      const harness = configHarness();
      expect(await runMcpSubcommand(argv, harness.deps)).toBe(1);
      expect(errorOf(harness).message).toBe(message);
      expect(harness.saves).toEqual([]);
    }
  });

  test("--check connects once non-interactively and reports tool count", async () => {
    let closed = 0;
    const harness = configHarness({
      connect: async () => ({
        name: "files",
        tools: [
          { name: "a", inputSchema: { type: "object" } },
          { name: "b", inputSchema: { type: "object" } },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {
          closed++;
        },
      }),
    });
    expect(
      await runMcpSubcommand(
        ["add", "files", "--command", "srv", "--check"],
        harness.deps,
      ),
    ).toBe(0);
    expect(harness.connects).toHaveLength(1);
    expect(closed).toBe(1);
    expect(JSON.parse(harness.stdout[0] ?? "{}").check).toEqual({
      status: "connected",
      tools: 2,
    });
  });

  test("--check failure keeps the saved server and exits 1", async () => {
    const harness = configHarness({
      connect: async () => {
        throw new Error("spawn srv ENOENT");
      },
    });
    expect(
      await runMcpSubcommand(
        ["add", "files", "--command", "srv", "--check"],
        harness.deps,
      ),
    ).toBe(1);
    expect(harness.saves).toHaveLength(1);
    expect(JSON.parse(harness.stdout[0] ?? "{}").check).toEqual({
      status: "failed",
      error: "spawn srv ENOENT",
    });
  });

  test("removes a configured server", async () => {
    const other: McpServerConfig = {
      name: "remote",
      transport: "http",
      url: "https://r.test",
      headers: { Authorization: "Bearer raw-secret" },
    };
    const harness = configHarness({ servers: [existing, other] });
    expect(await runMcpSubcommand(["remove", "remote"], harness.deps)).toBe(0);
    expect(harness.saves[0]?.configs).toEqual([existing]);
    const output = harness.stdout.join("");
    expect(JSON.parse(output)).toEqual({
      action: "removed",
      server: {
        name: "remote",
        transport: "streamable_http",
        url: "https://r.test/",
        headers: { Authorization: "[REDACTED]" },
      },
    });
    expect(output).not.toContain("raw-secret");
  });

  test("refuses to remove an unknown server", async () => {
    const harness = configHarness({ servers: [existing] });
    expect(await runMcpSubcommand(["remove", "missing"], harness.deps)).toBe(1);
    expect(harness.saves).toEqual([]);
    expect(errorOf(harness)).toEqual({
      code: "server_not_found",
      message:
        "No client MCP server named 'missing' is configured for this agent",
      hint: "Server-side MCP servers are managed through the Letta ADE or API.",
    });
  });

  test("requires a name for add and remove", async () => {
    for (const argv of [["add"], ["remove"]]) {
      const harness = configHarness();
      expect(await runMcpSubcommand(argv, harness.deps)).toBe(1);
      expect(errorOf(harness).code).toBe("invalid_arguments");
    }
  });
});
