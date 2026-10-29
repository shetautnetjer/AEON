import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { withMemoryOperation } from "@/agent/memory-operation";

const run = promisify(execFile);

export interface MemoryCommitOptions {
  memoryDir: string;
  /** Paths to commit, relative to the memory root (or absolute inside it). Required: no implicit "all". */
  paths: string[];
  message: string;
  /** Commit author, e.g. "Aya <agent@letta.com>". Omit to use the repo's configured identity. */
  author?: string;
  signal?: AbortSignal;
}

export type MemoryCommitResult =
  | { status: "committed"; commit: string; paths: string[] }
  | { status: "nothing-to-commit"; paths: string[] };

/**
 * Commit the agent's own memory edits under the same cross-process lease the
 * harness writers use (memory workers, conflict repair, reflection
 * integration, post-turn sync), so two threads of one agent cannot interleave
 * staging and committing. Only the named paths are staged and committed;
 * anything else already staged by someone else stays out of the commit.
 */
export async function commitMemoryPaths(
  options: MemoryCommitOptions,
): Promise<MemoryCommitResult> {
  const root = resolve(options.memoryDir);
  if (options.paths.length === 0) {
    throw new Error("memory commit needs at least one path; it never commits everything");
  }
  if (!options.message.trim()) throw new Error("memory commit needs a message");
  const paths = options.paths.map((p) => {
    const abs = isAbsolute(p) ? normalize(p) : resolve(root, p);
    const rel = relative(root, abs);
    if (rel === "" || rel === "." || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error(`path is outside the memory repository (or is its root): ${p}`);
    }
    return rel;
  });
  const git = (args: string[]) => run("git", ["-C", root, ...args], { maxBuffer: 16 << 20 });
  // Literal pathspecs: a memory file named `[a].md` must never act as a glob that also
  // matches `a.md` (another thread's edit).
  const specs = paths.map((p) => `:(literal)${p}`);

  return withMemoryOperation(
    root,
    async () => {
      // Stage edits, additions and deletions inside the named paths. `git add` rejects a pathspec
      // that matches nothing, which is exactly a file whose deletion is already staged (`git rm`):
      // skip those, since the index already holds the deletion and the commit below includes it.
      const tracked = new Set(
        (await git(["ls-files", "-z", "--cached", "--", ...specs])).stdout.split("\0").filter(Boolean),
      );
      const stageable = specs.filter((_, i) => {
        const p = paths[i] as string;
        return existsSync(resolve(root, p)) || tracked.has(p);
      });
      if (stageable.length > 0) await git(["add", "-A", "--", ...stageable]);
      const { stdout } = await git(["diff", "--cached", "--name-only", "--", ...specs]);
      if (!stdout.trim()) return { status: "nothing-to-commit", paths } as const;
      // `commit -- <paths>` commits only these paths, leaving other staged changes staged.
      await git([
        "commit",
        "-m",
        options.message,
        ...(options.author ? [`--author=${options.author}`] : []),
        "--",
        ...specs,
      ]);
      const { stdout: head } = await git(["rev-parse", "--short", "HEAD"]);
      return { status: "committed", commit: head.trim(), paths } as const;
    },
    options.signal,
  );
}
