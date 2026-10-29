import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitMemoryPaths } from "@/agent/memory-commit";
import { claimMemoryOperation } from "@/agent/memory-operation";

let dir = "";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memory-commit-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.md"), "a\n");
  writeFileSync(join(dir, "b.md"), "b\n");
  git("add", "-A");
  git("commit", "-qm", "init");
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("commitMemoryPaths", () => {
  test("commits only the named paths; other staged and unstaged edits stay out", async () => {
    writeFileSync(join(dir, "a.md"), "a2\n");
    writeFileSync(join(dir, "b.md"), "b2\n");
    git("add", "b.md"); // another thread staged b.md
    const r = await commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "edit a" });
    expect(r.status).toBe("committed");
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe("a.md");
    expect(git("diff", "--cached", "--name-only")).toBe("b.md"); // still staged, not committed
  });

  test("stages deletions and new files inside the named paths", async () => {
    rmSync(join(dir, "a.md"));
    writeFileSync(join(dir, "c.md"), "c\n");
    await commitMemoryPaths({ memoryDir: dir, paths: ["a.md", "c.md"], message: "rm a, add c" });
    expect(git("show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual(["A\tc.md", "D\ta.md"]);
  });

  test("refuses no paths, the repo root, and paths outside the repo", async () => {
    await expect(commitMemoryPaths({ memoryDir: dir, paths: [], message: "x" })).rejects.toThrow(/never commits everything/);
    await expect(commitMemoryPaths({ memoryDir: dir, paths: ["."], message: "x" })).rejects.toThrow(/outside|root/);
    await expect(commitMemoryPaths({ memoryDir: dir, paths: ["../x"], message: "x" })).rejects.toThrow(/outside/);
    await expect(commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "  " })).rejects.toThrow(/message/);
  });

  test("reports nothing-to-commit without creating a commit", async () => {
    const before = git("rev-parse", "HEAD");
    const r = await commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "noop" });
    expect(r.status).toBe("nothing-to-commit");
    expect(git("rev-parse", "HEAD")).toBe(before);
  });

  test("waits for the harness memory lock instead of interleaving with it", async () => {
    const release = await claimMemoryOperation(dir, { wait: true });
    expect(release).not.toBeNull();
    writeFileSync(join(dir, "a.md"), "locked\n");
    let done = false;
    const pending = commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "after lock" }).then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false); // blocked while another writer holds the lease
    await release?.();
    expect((await pending).status).toBe("committed");
  });

  test("applies an explicit author", async () => {
    writeFileSync(join(dir, "a.md"), "by aya\n");
    await commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "authored", author: "Aya <aya@example.com>" });
    expect(git("log", "-1", "--format=%an <%ae>")).toBe("Aya <aya@example.com>");
  });
});

describe("commitMemoryPaths review fixes", () => {
  test("paths are literal: a name with glob characters never matches other files", async () => {
    writeFileSync(join(dir, "[a].md"), "glob\n");
    git("add", "--", ":(literal)[a].md");
    git("commit", "-qm", "add glob-named file");
    writeFileSync(join(dir, "[a].md"), "glob2\n");
    writeFileSync(join(dir, "a.md"), "a-other-thread\n"); // `[a].md` as a glob would match `a.md`
    await commitMemoryPaths({ memoryDir: dir, paths: ["[a].md"], message: "literal" });
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe("[a].md");
    expect(git("status", "--porcelain", "--", ":(literal)a.md")).toBe("M a.md"); // untouched, unstaged
  });

  test("a deletion that is already staged (git rm) can be committed by name", async () => {
    git("rm", "-q", "a.md");
    const r = await commitMemoryPaths({ memoryDir: dir, paths: ["a.md"], message: "rm a" });
    expect(r.status).toBe("committed");
    expect(git("show", "--name-status", "--format=", "HEAD")).toBe("D\ta.md");
  });
});

test("deleting a whole tracked directory commits by the directory name", async () => {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "x.md"), "x\n");
  writeFileSync(join(dir, "notes", "y.md"), "y\n");
  git("add", "-A"); git("commit", "-qm", "add notes");
  rmSync(join(dir, "notes"), { recursive: true, force: true });
  const r = await commitMemoryPaths({ memoryDir: dir, paths: ["notes"], message: "rm notes" });
  expect(r.status).toBe("committed");
  expect(git("show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual(["D\tnotes/x.md", "D\tnotes/y.md"]);
});
