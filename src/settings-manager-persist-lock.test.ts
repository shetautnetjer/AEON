import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsFileLock } from "@/settings-agent-mcp-disk";
import { settingsManager } from "@/settings-manager";
import { setServiceName } from "@/utils/secrets";
import { acquireDurableFileLock } from "@/websocket/listener/durable-file-lock";

const originalHome = process.env.HOME;
const originalWaitMs = settingsFileLock.waitMs;
const originalConsoleError = console.error;
let testHome: string;

const settingsPath = () => join(testHome, ".letta", "settings.json");
const readSettings = () =>
  JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;

beforeEach(async () => {
  await settingsManager.reset();
  testHome = await mkdtemp(join(tmpdir(), "letta-settings-persist-lock-"));
  process.env.HOME = testHome;
  setServiceName("letta-code-settings-persist-lock-test");
});

afterEach(async () => {
  console.error = originalConsoleError;
  settingsFileLock.waitMs = originalWaitMs;
  await settingsManager.reset();
  process.env.HOME = originalHome;
  setServiceName("letta-code");
  await rm(testHome, { recursive: true, force: true });
});

describe("settings persist", () => {
  test("writes atomically with mode 0600 and leaves no temp files", async () => {
    await settingsManager.initialize();
    settingsManager.setIncludeWorktreeTool(false);
    await settingsManager.flush();
    expect(readSettings().includeWorktreeTool).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(settingsPath()).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(join(testHome, ".letta")).sort()).toEqual([
      "settings.json",
    ]);
  });

  test("never writes while another holder has the settings lock", async () => {
    await settingsManager.initialize();
    const before = readFileSync(settingsPath(), "utf8");
    settingsFileLock.waitMs = 150;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(args);

    const release = acquireDurableFileLock(settingsPath());
    try {
      settingsManager.setIncludeWorktreeTool(false);
      await settingsManager.flush();
      // Lock timeout: logged, the process keeps going, nothing written.
      expect(readFileSync(settingsPath(), "utf8")).toBe(before);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      release();
    }

    // The change stays dirty and lands on the next write.
    settingsManager.setIncludeWorktreeTool(false);
    await settingsManager.flush();
    expect(readSettings().includeWorktreeTool).toBe(false);
  });

  test("an agent entry deleted externally stays deleted", async () => {
    await settingsManager.initialize();
    settingsManager.setMcpServers("agent-x", [
      { name: "x", transport: "stdio", command: "x" },
    ]);
    settingsManager.pinAgent("agent-y");
    await settingsManager.flush();
    expect(
      (readSettings().agents as Array<{ agentId: string }>).map(
        (agent) => agent.agentId,
      ),
    ).toEqual(["agent-x", "agent-y"]);

    // Another process deletes agent-x's entry.
    const onDisk = readSettings();
    onDisk.agents = (onDisk.agents as Array<{ agentId: string }>).filter(
      (agent) => agent.agentId !== "agent-x",
    );
    writeFileSync(settingsPath(), JSON.stringify(onDisk));

    // This process changes an unrelated agent; agent-x must not come back.
    settingsManager.unpinAgent("agent-y");
    await settingsManager.flush();
    expect(
      (readSettings().agents as Array<{ agentId: string }>).map(
        (agent) => agent.agentId,
      ),
    ).toEqual(["agent-y"]);

    // Deleting the whole agents array externally behaves the same.
    const withoutAgents = readSettings();
    delete withoutAgents.agents;
    writeFileSync(settingsPath(), JSON.stringify(withoutAgents));
    settingsManager.setIncludeWorktreeTool(false);
    settingsManager.pinAgent("agent-z");
    await settingsManager.flush();
    expect(
      (readSettings().agents as Array<{ agentId: string }>).map(
        (agent) => agent.agentId,
      ),
    ).toEqual(["agent-z"]);
  });
});
