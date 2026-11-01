import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReflectionIntegrationMemoryScope,
  createReflectionMemoryWorktree,
  finalizeReflectionMemoryWorktree,
  reflectionIntegrationConsumesTranscript,
  reflectionMemoryParentHasChanges,
} from "@/agent/memory-worktree";

let tempDir: string;
let memoryDir: string;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@test.com",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf-8",
  });
}

function writeMemoryFile(relativePath: string, content: string): void {
  const path = join(memoryDir, relativePath);
  writeFileSync(path, content, "utf-8");
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "reflection-memory-worktree-"));
  memoryDir = join(tempDir, "agent", "memory");
  rmSync(memoryDir, { recursive: true, force: true });
  git(tempDir, ["init", "-b", "main", memoryDir]);
  git(memoryDir, ["config", "core.autocrlf", "false"]);
  git(memoryDir, ["config", "core.eol", "lf"]);
  writeMemoryFile("persona.md", "base\n");
  git(memoryDir, ["add", "persona.md"]);
  git(memoryDir, ["commit", "-m", "init"]);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("reflection memory worktrees", () => {
  test("integration scope makes both worktree and parent memory writable", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    const scope = buildReflectionIntegrationMemoryScope(worktree);

    expect(scope.primaryRoot).toBe(worktree.worktreeDir);
    expect(scope.writableRoots).toEqual([
      worktree.worktreeDir,
      worktree.parentMemoryDir,
      worktree.gitCommonDir,
    ]);
    expect(scope.readonlyRoots).toEqual([]);
    await finalizeReflectionMemoryWorktree(worktree, { shouldMerge: false });
  });

  test("detects uncommitted parent memory changes before launch", async () => {
    expect(await reflectionMemoryParentHasChanges(memoryDir)).toBe(false);

    writeMemoryFile("parent-dirty.md", "dirty\n");

    expect(await reflectionMemoryParentHasChanges(memoryDir)).toBe(true);
  });

  test("merges committed reflection changes after parent advances", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "reflection.md"),
      "dream\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    writeMemoryFile("parent.md", "awake\n");
    git(memoryDir, ["add", "parent.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const claims: string[] = [];
    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
      claimConflictRepair: async (dir) => {
        claims.push(dir);
        return { status: "claimed", token: "unused" };
      },
    });

    // A clean merge never consults the repair claimer.
    expect(claims).toEqual([]);
    expect(result.status).toBe("merged");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(true);
    expect(readFileSync(join(memoryDir, "parent.md"), "utf-8")).toBe("awake\n");
    expect(readFileSync(join(memoryDir, "reflection.md"), "utf-8")).toBe(
      "dream\n",
    );
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });

  test("leaves a conflicted merge in progress for the claimed repair worker", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "reflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    writeMemoryFile("persona.md", "parent\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const claims: Array<{ memoryDir: string; kind: string }> = [];
    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
      claimConflictRepair: async (dir, kind) => {
        claims.push({ memoryDir: dir, kind });
        return { status: "claimed", token: "repair-token-1" };
      },
    });

    expect(result.status).toBe("repair_started");
    expect(result.repairToken).toBe("repair-token-1");
    // The transcript is not consumed: a failed repair still retries later.
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(claims).toEqual([{ memoryDir, kind: "conflict" }]);

    // The merge is left in progress for the repair worker: the branch is its
    // second parent and preserves the commits, and only the worktree is gone.
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(true);
    const conflicted = readFileSync(join(memoryDir, "persona.md"), "utf-8");
    expect(conflicted).toContain("<<<<<<<");
    expect(conflicted).toContain("reflection");
    expect(conflicted).toContain("parent");
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe(worktree.branchName);
  });

  test("aborts a conflicted merge when its repair is already in progress", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "reflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    writeMemoryFile("persona.md", "parent\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
      claimConflictRepair: async () => ({ status: "in_progress" }),
    });

    expect(result.status).toBe("merge_conflict");
    expect(result.repairToken).toBeUndefined();
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(existsSync(join(memoryDir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "parent\n",
    );
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });

  test("a concluded repair merge leaves nothing for the next reflection to do", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "base\nreflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    writeMemoryFile("persona.md", "base\nparent\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "-m", "parent"]);

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
      claimConflictRepair: async () => ({
        status: "claimed",
        token: "repair-token-1",
      }),
    });
    expect(result.status).toBe("repair_started");

    // Simulate the repair worker: resolve keeping both sides, conclude the
    // merge, drop the now-merged reflection branch.
    writeMemoryFile("persona.md", "base\nparent\nreflection\n");
    git(memoryDir, ["add", "persona.md"]);
    git(memoryDir, ["commit", "--no-edit"]);
    git(memoryDir, ["branch", "-d", worktree.branchName]);

    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(
      git(memoryDir, ["rev-list", "--parents", "-n", "1", "HEAD"])
        .trim()
        .split(" "),
    ).toHaveLength(3);
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "base\nparent\nreflection\n",
    );

    const followup = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    const followupResult = await finalizeReflectionMemoryWorktree(followup, {
      shouldMerge: true,
    });
    expect(followupResult.status).toBe("no_changes");
    expect(reflectionIntegrationConsumesTranscript(followupResult)).toBe(true);
  });

  test("refreshes remote memory before merging reflection changes", async () => {
    const remoteDir = join(tempDir, "remote.git");
    const otherDir = join(tempDir, "other");
    git(tempDir, ["init", "--bare", remoteDir]);
    git(memoryDir, ["remote", "add", "origin", remoteDir]);
    git(memoryDir, ["push", "-u", "origin", "main"]);

    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(
      join(worktree.worktreeDir, "persona.md"),
      "reflection\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "persona.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    git(tempDir, ["clone", "--branch", "main", remoteDir, otherDir]);
    writeFileSync(join(otherDir, "persona.md"), "remote\n", "utf-8");
    git(otherDir, ["add", "persona.md"]);
    git(otherDir, ["commit", "-m", "remote"]);
    git(otherDir, ["push", "origin", "main"]);

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
    });

    expect(result.status).toBe("merge_conflict");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(readFileSync(join(memoryDir, "persona.md"), "utf-8")).toBe(
      "remote\n",
    );
    expect(git(memoryDir, ["status", "--porcelain"]).trim()).toBe("");
    expect(git(memoryDir, ["rev-parse", "HEAD"]).trim()).toBe(
      git(memoryDir, ["rev-parse", "origin/main"]).trim(),
    );
    expect(existsSync(worktree.worktreeDir)).toBe(false);
  });

  test("cleans up a no-op reflection worktree", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
    });

    expect(result.status).toBe("no_changes");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(true);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });

  test("finalizes a confirmed no-op after its worktree disappeared", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    git(memoryDir, ["worktree", "remove", "--force", worktree.worktreeDir]);
    git(memoryDir, ["branch", "-D", worktree.branchName]);

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
      knownNoChanges: true,
    });

    expect(result.status).toBe("no_changes");
    expect(result.commitCount).toBe(0);
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(true);
  });

  test("does not treat a missing committed worktree as a no-op", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "reflection.md"), "dream\n");
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);
    git(memoryDir, ["worktree", "remove", "--force", worktree.worktreeDir]);

    await expect(
      finalizeReflectionMemoryWorktree(worktree, {
        shouldMerge: true,
        knownNoChanges: true,
      }),
    ).rejects.toThrow("advanced");
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toContain(worktree.branchName);
  });

  test("cleans up when parent memory is dirty so the transcript can retry", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "reflection.md"),
      "dream\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    writeMemoryFile("parent.md", "dirty\n");

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
    });

    expect(result.status).toBe("parent_dirty");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
    expect(readFileSync(join(memoryDir, "parent.md"), "utf-8")).toBe("dirty\n");
    expect(git(memoryDir, ["status", "--porcelain"])).toContain("?? parent.md");
  });

  test("cleans up dirty uncommitted reflection worktrees for retry", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });
    writeFileSync(join(worktree.worktreeDir, "scratch.md"), "dirty\n", "utf-8");

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: true,
    });

    expect(result.status).toBe("dirty_uncommitted");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });

  test("cleans up failed committed reflection worktrees for retry", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    writeFileSync(
      join(worktree.worktreeDir, "reflection.md"),
      "dream\n",
      "utf-8",
    );
    git(worktree.worktreeDir, ["add", "reflection.md"]);
    git(worktree.worktreeDir, ["commit", "-m", "reflection"]);

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: false,
    });

    expect(result.status).toBe("failed");
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });

  test("classifies failed clean no-op worktrees as failed", async () => {
    const worktree = await createReflectionMemoryWorktree({
      parentMemoryDir: memoryDir,
    });

    const result = await finalizeReflectionMemoryWorktree(worktree, {
      shouldMerge: false,
    });

    expect(result.status).toBe("failed");
    expect(result.commitCount).toBe(0);
    expect(reflectionIntegrationConsumesTranscript(result)).toBe(false);
    expect(existsSync(worktree.worktreeDir)).toBe(false);
    expect(
      git(memoryDir, ["branch", "--list", worktree.branchName]).trim(),
    ).toBe("");
  });
});
