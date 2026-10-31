import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { debugLog, debugWarn } from "@/utils/debug";
import { getLocalBackendStorageDir } from "@/utils/local-backend-paths";
import { acquireDurableFileLock } from "@/websocket/listener/durable-file-lock";

// Chat-key -> Letta conversation map for the OpenAI-compatible surface.
// Header-pinned `chat-key:` entries are persisted under the local-backend
// storage dir so a client chat resumes the same conversation after an App
// Server restart. Any other key shape stays memory-only. The map is a
// bounded FIFO (re-remembering a key moves it to the tail); the on-disk file
// preserves that order and bound.
//
// Several App Server processes can share one storage dir, so persistence is
// a read-merge-write under a durable interprocess lock: every write re-reads
// the file, layers this process's pending changes on top, and re-applies the
// bound. Writing an in-memory snapshot instead would silently delete the
// mappings other processes added since this one last loaded.

export const MAX_TRACKED_CHAT_KEYS = 4096;
export const CHAT_KEY_PREFIX = "chat-key:";
const STORE_FILE_NAME = "openai-chat-keys.json";
const FLUSH_DELAY_MS = 250;
const LOCK_WAIT_MS = 2_000;
const LOG_PREFIX = "openai-chat-keys";

const conversationIdByKey = new Map<string, string>();
// Entries learned from disk that have not yet been confirmed to still exist
// in the backend during this process lifetime.
const unverifiedKeys = new Set<string>();
// Persisted keys this process changed since its last successful write; `null`
// records a delete. Local FIFO evictions are never recorded: eviction only
// bounds this process's memory and must not remove entries other processes
// still rely on.
const pendingChanges = new Map<string, string | null>();
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;
let exitHookInstalled = false;
// Test seam invoked inside a write's critical section after the disk read.
let preWriteHook: (() => void | Promise<void>) | null = null;

export function getChatKeyStorePath(): string {
  return join(getLocalBackendStorageDir(), STORE_FILE_NAME);
}

function isPersistedKey(key: string): boolean {
  return key.startsWith(CHAT_KEY_PREFIX);
}

function readPersistedEntries(path: string): Array<[string, string]> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      debugWarn(
        LOG_PREFIX,
        `failed to read ${path}; starting empty: ${String(error)}`,
      );
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    debugWarn(LOG_PREFIX, `corrupt ${path}; starting empty: ${String(error)}`);
    return [];
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    debugWarn(LOG_PREFIX, `unexpected shape in ${path}; starting empty`);
    return [];
  }
  const valid: Array<[string, string]> = [];
  let dropped = 0;
  for (const entry of entries) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      isPersistedKey(entry[0]) &&
      typeof entry[1] === "string" &&
      entry[1].length > 0
    ) {
      valid.push([entry[0], entry[1]]);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    debugWarn(LOG_PREFIX, `dropped ${dropped} invalid entries from ${path}`);
  }
  return valid;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const path = getChatKeyStorePath();
  const valid = readPersistedEntries(path);
  // Loaded entries go first (oldest); anything already in memory wins.
  const existing = [...conversationIdByKey];
  conversationIdByKey.clear();
  for (const [key, conversationId] of valid.slice(-MAX_TRACKED_CHAT_KEYS)) {
    conversationIdByKey.delete(key);
    conversationIdByKey.set(key, conversationId);
    unverifiedKeys.add(key);
  }
  for (const [key, conversationId] of existing) {
    conversationIdByKey.delete(key);
    conversationIdByKey.set(key, conversationId);
    unverifiedKeys.delete(key);
  }
  enforceBound();
  debugLog(LOG_PREFIX, `loaded ${valid.length} chat-key entries from ${path}`);
}

function enforceBound(): void {
  while (conversationIdByKey.size > MAX_TRACKED_CHAT_KEYS) {
    const oldest = conversationIdByKey.keys().next().value;
    if (oldest === undefined) break;
    conversationIdByKey.delete(oldest);
    unverifiedKeys.delete(oldest);
    // Eviction is local bounding only. It is not recorded in pendingChanges,
    // so a later merged write never turns it into a delete of another
    // process's on-disk entry.
  }
}

// This process's pending changes on top of what is on disk right now: set
// keys move to the tail (FIFO recency), deletes are removed, and the merged
// result keeps the newest MAX_TRACKED_CHAT_KEYS entries.
function mergePersistedEntries(
  diskEntries: Array<[string, string]>,
  applied: Map<string, string | null>,
): Array<[string, string]> {
  const merged = new Map(diskEntries);
  for (const [key, value] of applied) {
    if (value === null) {
      merged.delete(key);
    } else {
      merged.delete(key);
      merged.set(key, value);
    }
  }
  while (merged.size > MAX_TRACKED_CHAT_KEYS) {
    const oldest = merged.keys().next().value;
    if (oldest === undefined) break;
    merged.delete(oldest);
  }
  return [...merged];
}

function serializeEntries(entries: Array<[string, string]>): string {
  return `${JSON.stringify({ version: 1, entries })}\n`;
}

// The applied changes landed on disk; changes recorded while the write was in
// flight stay pending for the next flush.
function clearAppliedChanges(applied: Map<string, string | null>): void {
  for (const [key, value] of applied) {
    if (pendingChanges.get(key) === value) pendingChanges.delete(key);
  }
}

// Pick up keys other processes wrote that this process doesn't hold, so it
// can resolve their chats too. Like entries loaded at startup they stay
// unverified.
function adoptMergedEntries(merged: Array<[string, string]>): void {
  for (const [key, conversationId] of merged) {
    if (conversationIdByKey.has(key)) continue;
    conversationIdByKey.set(key, conversationId);
    unverifiedKeys.add(key);
  }
  enforceBound();
}

function tempPathFor(path: string): string {
  return `${path}.${process.pid}.tmp`;
}

// Distinct from tempPathFor so an exit-time sync write can't collide with an
// async flush that is still mid-write.
function exitTempPathFor(path: string): string {
  return `${path}.${process.pid}.exit.tmp`;
}

type MergedWrite = {
  applied: Map<string, string | null>;
  merged: Array<[string, string]>;
};

// Read-merge-write under the interprocess lock shared with every other App
// Server process using this storage dir. Returns null on failure (including
// a lock timeout); the caller keeps the pending changes for a later retry.
async function writeMerged(
  path: string,
  tempPath: string,
): Promise<MergedWrite | null> {
  let release: (() => void) | null = null;
  try {
    release = acquireDurableFileLock(path, { waitMs: LOCK_WAIT_MS });
    const applied = new Map(pendingChanges);
    const merged = mergePersistedEntries(readPersistedEntries(path), applied);
    const contents = serializeEntries(merged);
    await preWriteHook?.();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, contents, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
    return { applied, merged };
  } catch (error) {
    debugWarn(LOG_PREFIX, `failed to write ${path}: ${String(error)}`);
    return null;
  } finally {
    release?.();
  }
}

function writeMergedSync(path: string, tempPath: string): MergedWrite | null {
  let release: (() => void) | null = null;
  try {
    release = acquireDurableFileLock(path, { waitMs: LOCK_WAIT_MS });
    const applied = new Map(pendingChanges);
    const merged = mergePersistedEntries(readPersistedEntries(path), applied);
    void preWriteHook?.();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, serializeEntries(merged), { mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, path);
    return { applied, merged };
  } catch (error) {
    debugWarn(LOG_PREFIX, `failed to write ${path}: ${String(error)}`);
    return null;
  } finally {
    release?.();
  }
}

async function writeNow(): Promise<void> {
  if (pendingChanges.size === 0) return;
  const path = getChatKeyStorePath();
  const outcome = await writeMerged(path, tempPathFor(path));
  if (!outcome) return;
  clearAppliedChanges(outcome.applied);
  adoptMergedEntries(outcome.merged);
}

function writeNowSync(): void {
  const path = getChatKeyStorePath();
  const outcome = writeMergedSync(path, exitTempPathFor(path));
  if (!outcome) return;
  clearAppliedChanges(outcome.applied);
  adoptMergedEntries(outcome.merged);
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // "exit" listeners must be synchronous; a short sync write is fine here.
  process.once("exit", () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // An in-flight async flush may not finish before exit (and may fail),
    // so write the current state synchronously in that case too.
    if (pendingChanges.size > 0 || flushInFlight) writeNowSync();
  });
}

function scheduleFlush(): void {
  installExitHook();
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushChatKeyStore();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** Write pending changes now (serialized with any in-flight write). */
export async function flushChatKeyStore(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (flushInFlight) await flushInFlight;
  if (pendingChanges.size === 0) return;
  flushInFlight = writeNow().finally(() => {
    flushInFlight = null;
  });
  await flushInFlight;
}

export function getChatKeyConversation(key: string): string | undefined {
  ensureLoaded();
  return conversationIdByKey.get(key);
}

/** True when the entry came from disk and hasn't been re-confirmed yet. */
export function isChatKeyUnverified(key: string): boolean {
  ensureLoaded();
  return unverifiedKeys.has(key);
}

export function markChatKeyVerified(key: string): void {
  unverifiedKeys.delete(key);
}

export function setChatKeyConversation(
  key: string,
  conversationId: string,
): void {
  ensureLoaded();
  const previous = conversationIdByKey.get(key);
  conversationIdByKey.delete(key);
  conversationIdByKey.set(key, conversationId);
  if (previous !== conversationId) unverifiedKeys.delete(key);
  enforceBound();
  if (isPersistedKey(key)) {
    // Re-recording a key moves it to the pending tail so the merged file's
    // FIFO order reflects recency, same as the in-memory map.
    pendingChanges.delete(key);
    pendingChanges.set(key, conversationId);
    scheduleFlush();
  }
}

export function deleteChatKeyConversation(key: string): void {
  ensureLoaded();
  unverifiedKeys.delete(key);
  conversationIdByKey.delete(key);
  if (isPersistedKey(key)) {
    pendingChanges.delete(key);
    pendingChanges.set(key, null);
    scheduleFlush();
  }
}

/** @internal Drops in-memory state without touching disk; the next access
 * starts empty (no reload) so tests don't leak entries into each other. */
export function __testClearChatKeyStore(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  conversationIdByKey.clear();
  unverifiedKeys.clear();
  pendingChanges.clear();
  preWriteHook = null;
  loaded = true;
}

/** @internal Simulates a process restart: forget memory, reload lazily. */
export function __testResetChatKeyStoreForReload(): void {
  __testClearChatKeyStore();
  loaded = false;
}

/** @internal Runs inside a write's critical section after the disk read so a
 * test can force cross-process read/write interleavings. */
export function __testSetChatKeyPreWriteHook(
  hook: (() => void | Promise<void>) | null,
): void {
  preWriteHook = hook;
}

/** @internal */
export function __testChatKeyStoreSize(): number {
  ensureLoaded();
  return conversationIdByKey.size;
}
