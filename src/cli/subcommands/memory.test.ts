import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMemorySubcommand } from "@/cli/subcommands/memory";

describe("letta memory pull", () => {
  const agentId = "agent-00000000-0000-4000-8000-000000000001";
  let priorLocalBackend: string | undefined;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    priorLocalBackend = process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL;
    delete process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (priorLocalBackend !== undefined) {
      process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL = priorLocalBackend;
    } else {
      delete process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL;
    }
  });

  test("initializes settings before pulling memory", async () => {
    // Regression guard for `letta memory pull` exiting with
    // "Settings not initialized. Call settingsManager.initialize() first."
    // Subcommands run before the main CLI bootstrap initializes settings, and
    // pullMemory resolves the backend auth token through getSettings().
    const calls: string[] = [];
    let settingsInitialized = false;

    const code = await runMemorySubcommand(["pull", "--agent", agentId], {
      isGitRepo: () => true,
      initializeSettings: async () => {
        await Promise.resolve();
        settingsInitialized = true;
        calls.push("initializeSettings");
      },
      pullMemory: async (id) => {
        calls.push("pullMemory");
        if (!settingsInitialized) {
          throw new Error(
            "Settings not initialized. Call settingsManager.initialize() first.",
          );
        }
        expect(id).toBe(agentId);
        return { updated: true, summary: "Fast-forwarded 1 commit." };
      },
    });

    expect(code).toBe(0);
    expect(calls).toEqual(["initializeSettings", "pullMemory"]);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        { updated: true, summary: "Fast-forwarded 1 commit." },
        null,
        2,
      ),
    );
  });

  test("does not initialize settings when memory is not a git repo", async () => {
    let initialized = false;

    const code = await runMemorySubcommand(["pull", "--agent", agentId], {
      isGitRepo: () => false,
      initializeSettings: async () => {
        initialized = true;
      },
      pullMemory: async () => {
        throw new Error("pullMemory must not run for a non-git memory dir");
      },
    });

    expect(code).toBe(1);
    expect(initialized).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "Not a git repo. Enable git-backed memory first.",
    );
  });

  test("does not initialize settings for the local backend short-circuit", async () => {
    process.env.LETTA_LOCAL_BACKEND_EXPERIMENTAL = "1";
    let initialized = false;

    const code = await runMemorySubcommand(["pull", "--agent", agentId], {
      isGitRepo: () => true,
      initializeSettings: async () => {
        initialized = true;
      },
      pullMemory: async () => {
        throw new Error("pullMemory must not run for the local backend");
      },
    });

    expect(code).toBe(0);
    expect(initialized).toBe(false);
  });
});

describe("letta memory commit", () => {
  let dir = "";
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "memory-commit-cli-"));
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@example.com");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "x.md"), "1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  test("commits the named paths and prints the result as JSON", async () => {
    writeFileSync(join(dir, "x.md"), "2\n");
    const code = await runMemorySubcommand([
      "commit",
      "--memory-dir",
      dir,
      "-m",
      "cli edit",
      "--",
      "x.md",
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0])).status).toBe(
      "committed",
    );
    expect(git("log", "-1", "--format=%s")).toBe("cli edit");
  });

  test("refuses to commit without named paths and says why", async () => {
    const code = await runMemorySubcommand([
      "commit",
      "--memory-dir",
      dir,
      "-m",
      "none",
    ]);
    expect(code).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      "never commits everything",
    );
    expect(git("log", "-1", "--format=%s")).toBe("init");
  });
});
