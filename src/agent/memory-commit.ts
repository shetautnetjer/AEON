import { execFile } from "node:child_process";
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

  return withMemoryOperation(
    root,
    async () => {
      // `add -A -- <paths>` stages edits, additions and deletions, but only inside the given paths.
      await git(["add", "-A", "--", ...paths]);
      const { stdout } = await git(["diff", "--cached", "--name-only", "--", ...paths]);
      if (!stdout.trim()) return { status: "nothing-to-commit", paths } as const;
      // `commit -- <paths>` commits only these paths, leaving other staged changes staged.
      await git([
        "commit",
        "-m",
        options.message,
        ...(options.author ? [`--author=${options.author}`] : []),
        "--",
        ...paths,
      ]);
      const { stdout: head } = await git(["rev-parse", "--short", "HEAD"]);
      return { status: "committed", commit: head.trim(), paths } as const;
    },
    options.signal,
  );
}
