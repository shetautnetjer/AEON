import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { getCurrentAgentId } from "@/agent/context";
import {
  claimMemoryOperation,
  getMemoryOperationPath,
} from "@/agent/memory-operation";
import { getActiveMemoryDirectory } from "@/agent/memory-runtime";
import { isMemoryWorkerSession } from "@/agent/subagents/memory-worker-session";
import { SUBAGENT_LAUNCH_ENV } from "@/utils/subagent-launch-marker";

/** How long one of the agent's file edits waits for a memory task to finish. */
export const MEMORY_EDIT_LEASE_TIMEOUT_MS = 30_000;

export interface MemoryEditLeaseOptions {
  /** The agent's memory checkout; defaults to the current agent's. null: none. */
  memoryDir?: string | null;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

function currentMemoryDirectory(): string | null {
  try {
    const agentId = getCurrentAgentId();
    return (agentId && getActiveMemoryDirectory(agentId)) || null;
  } catch {
    return null;
  }
}

/** Real path of `path`, resolving the deepest ancestor that exists (for new files). */
function realPathAllowingMissing(path: string): string | null {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    missing.unshift(basename(current));
    current = parent;
  }
  try {
    return join(realpathSync(current), ...missing);
  } catch {
    return null;
  }
}

/** The memory checkout one of `paths` falls inside, or null when none does. */
export function memoryCheckoutFor(
  paths: string[],
  memoryDir: string | null,
): string | null {
  if (!memoryDir || !existsSync(join(memoryDir, ".git"))) return null;
  const root = realPathAllowingMissing(memoryDir);
  if (!root) return null;
  for (const path of paths) {
    const target = realPathAllowingMissing(path);
    if (target && (target === root || target.startsWith(root + sep))) {
      return root;
    }
  }
  return null;
}

/**
 * A subagent that the lease holder launched to work under its lease (the
 * reflection integration child, which edits the checkout while its parent
 * holds the lease for the merge, verification and push).
 */
async function leaseHeldByParentProcess(checkout: string): Promise<boolean> {
  try {
    const record = JSON.parse(
      await readFile(await getMemoryOperationPath(checkout), "utf8"),
    ) as { pid?: unknown };
    return record.pid === process.ppid;
  } catch {
    return false;
  }
}

/**
 * Run one of the agent's own file edits (Edit, Write, ApplyPatch) under the
 * memory checkout lease when it targets a file inside the agent's memory
 * checkout. Without it, an edit that reads a file before a memory worker's
 * merge, a repair or another edit and writes after it silently drops that
 * change. Paths outside the checkout run unchanged.
 *
 * The wait is bounded: a memory worker can hold the lease for its whole run,
 * and a turn must not hang on it. On timeout nothing is written and the edit
 * fails with a message the agent can act on. Memory worker sessions and a
 * child launched by the current lease holder already work under that lease,
 * so they skip it instead of waiting on their own parent.
 */
export async function withMemoryEditLease<T>(
  paths: string | string[],
  edit: () => Promise<T>,
  options: MemoryEditLeaseOptions = {},
): Promise<T> {
  const env = options.env ?? process.env;
  if (isMemoryWorkerSession(env)) return edit();
  const memoryDir =
    options.memoryDir !== undefined
      ? options.memoryDir
      : currentMemoryDirectory();
  const checkout = memoryCheckoutFor(
    Array.isArray(paths) ? paths : [paths],
    memoryDir,
  );
  if (!checkout) return edit();
  if (
    env[SUBAGENT_LAUNCH_ENV] === "1" &&
    (await leaseHeldByParentProcess(checkout))
  ) {
    return edit();
  }
  const release = await claimMemoryOperation(checkout, {
    timeoutMs: options.timeoutMs ?? MEMORY_EDIT_LEASE_TIMEOUT_MS,
    signal: options.signal,
  });
  if (!release) {
    throw new Error(
      "Memory is being updated by a background memory task, so this edit was not made. Try it again in a moment.",
    );
  }
  try {
    return await edit();
  } finally {
    await release();
  }
}
