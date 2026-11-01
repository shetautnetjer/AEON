import { describe, expect, test } from "bun:test";
import { buildMcpServerConfig } from "./mcp-server-config";

describe("buildMcpServerConfig", () => {
  test("builds a stdio config with the default cwd and omits empty env", () => {
    expect(
      buildMcpServerConfig(
        { transport: "stdio", name: "fs", command: "npx", args: ["-y", "x"] },
        { cwd: "/work" },
      ),
    ).toEqual({
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "x"],
      cwd: "/work",
    });
  });

  test("keeps an explicit cwd and env for stdio", () => {
    expect(
      buildMcpServerConfig(
        {
          transport: "stdio",
          name: "fs",
          command: "node",
          cwd: "/srv",
          env: { MODE: "ro" },
        },
        { cwd: "/work" },
      ),
    ).toEqual({
      name: "fs",
      transport: "stdio",
      command: "node",
      args: [],
      cwd: "/srv",
      env: { MODE: "ro" },
    });
  });

  test("stores an auth token env as a Bearer placeholder, not a value", () => {
    const previous = process.env.MCP_TEST_TOKEN;
    process.env.MCP_TEST_TOKEN = "super-secret-value";
    try {
      const config = buildMcpServerConfig(
        {
          transport: "http",
          name: "remote",
          url: "https://example.test/mcp",
          headers: { "X-Team": "core" },
          authTokenEnv: "MCP_TEST_TOKEN",
        },
        { cwd: "/work" },
      );
      expect(config).toEqual({
        name: "remote",
        transport: "http",
        url: "https://example.test/mcp",
        headers: {
          "X-Team": "core",
          Authorization: `Bearer \${MCP_TEST_TOKEN}`,
        },
      });
      expect(JSON.stringify(config)).not.toContain("super-secret-value");
    } finally {
      if (previous === undefined) delete process.env.MCP_TEST_TOKEN;
      else process.env.MCP_TEST_TOKEN = previous;
    }
  });

  test("omits empty headers for sse", () => {
    expect(
      buildMcpServerConfig(
        { transport: "sse", name: "events", url: "https://example.test/sse" },
        { cwd: "/work" },
      ),
    ).toEqual({
      name: "events",
      transport: "sse",
      url: "https://example.test/sse",
    });
  });

  test("rejects invalid token env names and missing command/url", () => {
    expect(() =>
      buildMcpServerConfig(
        {
          transport: "http",
          name: "r",
          url: "https://example.test",
          authTokenEnv: "lower-case",
        },
        { cwd: "/" },
      ),
    ).toThrow("Invalid token environment variable name: lower-case");
    expect(() =>
      buildMcpServerConfig({ transport: "stdio", name: "s" }, { cwd: "/" }),
    ).toThrow("Command is required for stdio");
    expect(() =>
      buildMcpServerConfig({ transport: "http", name: "h" }, { cwd: "/" }),
    ).toThrow("URL is required for HTTP/SSE");
  });
});
