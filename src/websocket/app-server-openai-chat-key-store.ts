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

// Chat-key -> Letta conversation map for the OpenAI-compatible surface.
// Header-pinned `chat-key:` entries are persisted under the local-backend
// storage dir so a client chat resumes the same conversation after an App
// Server restart. Any other key shape stays memory-only. The map is a
// bounded FIFO (re-remembering a key moves it to the tail); the on-disk file
// preserves that order and bound.

export const MAX_TRACKED_CHAT_KEYS = 4096;
export const CHAT_KEY_PREFIX = "chat-key:";
const STORE_FILE_NAME = "openai-chat-keys.json";
const FLUSH_DELAY_MS = 250;
const LOG_PREFIX = "openai-chat-keys";

const conversationIdByKey = new Map<string, string>();
// Entries loaded from disk that have not yet been confirmed to still exist
// in the backend during this process lifetime.
const unverifiedKeys = new Set<string>();
let loaded = false;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;
let exitHookInstalled = false;

export function getChatKeyStorePath(): string {
  return join(getLocalBackendStorageDir(), STORE_FILE_NAME);
}

function isPersistedKey(key: string): boolean {
  return key.startsWith(CHAT_KEY_PREFIX);
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const path = getChatKeyStorePath();
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
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    debugWarn(LOG_PREFIX, `corrupt ${path}; starting empty: ${String(error)}`);
    return;
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    debugWarn(LOG_PREFIX, `unexpected shape in ${path}; starting empty`);
    return;
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
    if (isPersistedKey(oldest)) dirty = true;
  }
}

function serialize(): string {
  const entries = [...conversationIdByKey].filter(([key]) =>
    isPersistedKey(key),
  );
  return `${JSON.stringify({ version: 1, entries })}\n`;
}

function tempPathFor(path: string): string {
  return `${path}.${process.pid}.tmp`;
}

// Distinct from tempPathFor so an exit-time sync write can't collide with an
// async flush that is still mid-write.
function exitTempPathFor(path: string): string {
  return `${path}.${process.pid}.exit.tmp`;
}

async function writeNow(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const path = getChatKeyStorePath();
  const tempPath = tempPathFor(path);
  const contents = serialize();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, contents, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
  } catch (error) {
    // Keep the changes pending so the next flush (or exit hook) retries.
    dirty = true;
    debugWarn(LOG_PREFIX, `failed to write ${path}: ${String(error)}`);
  }
}

function writeNowSync(): void {
  dirty = false;
  const path = getChatKeyStorePath();
  const tempPath = exitTempPathFor(path);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, serialize(), { mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, path);
  } catch (error) {
    dirty = true;
    debugWarn(LOG_PREFIX, `failed to write ${path}: ${String(error)}`);
  }
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
    if (dirty || flushInFlight) writeNowSync();
  });
}

function scheduleFlush(): void {
  dirty = true;
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
  if (!dirty) return;
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
  if (isPersistedKey(key)) scheduleFlush();
}

export function deleteChatKeyConversation(key: string): void {
  ensureLoaded();
  unverifiedKeys.delete(key);
  if (conversationIdByKey.delete(key) && isPersistedKey(key)) {
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
  dirty = false;
  loaded = true;
}

/** @internal Simulates a process restart: forget memory, reload lazily. */
export function __testResetChatKeyStoreForReload(): void {
  __testClearChatKeyStore();
  loaded = false;
}

/** @internal */
export function __testChatKeyStoreSize(): number {
  ensureLoaded();
  return conversationIdByKey.size;
}
