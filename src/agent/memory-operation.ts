import { resolve } from "node:path";
import { getMemoryGitDir } from "@/agent/memory-git-dir";
import { type FileLockOptions, tryAcquireFileLock } from "@/utils/file-lock";

/** Lock a checkout and its index; isolated reflection worktrees remain independent. */
export async function getMemoryOperationPath(
  memoryDir: string,
): Promise<string> {
  return resolve(
    await getMemoryGitDir(memoryDir),
    "letta-memory-operation.lock",
  );
}

/**
 * The lease is a file lock that is reaped only when its holder process is
 * gone (pid plus start time), so a paused holder keeps the checkout and
 * waiters keep waiting; the abort signal is the way to give up.
 */
const LEASE_OPTIONS: FileLockOptions = {
  reapOnlyDeadOwner: true,
  retryMs: 100,
};

/**
 * Serialize the writers of a memory checkout across local processes: memory
 * workers, conflict repair, reflection integration, post-turn sync, and the
 * primary agent's own Edit, Write and ApplyPatch calls on files inside the
 * checkout (see `withMemoryEditLease`, which waits a bounded time).
 *
 * Returns a release function, or null when the checkout is owned by another
 * running process and neither `wait` nor `timeoutMs` lets the call wait it out.
 */
export async function claimMemoryOperation(
  memoryDir: string,
  options: { wait?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<(() => Promise<void>) | null> {
  return tryAcquireFileLock(await getMemoryOperationPath(memoryDir), {
    ...LEASE_OPTIONS,
    timeoutMs:
      options.timeoutMs ?? (options.wait ? Number.POSITIVE_INFINITY : 0),
    signal: options.signal,
  });
}

export async function withMemoryOperation<T>(
  memoryDir: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await claimMemoryOperation(memoryDir, { wait: true, signal });
  if (!release) throw new Error("Failed to acquire memory checkout");
  try {
    signal?.throwIfAborted();
    return await operation();
  } finally {
    await release();
  }
}
