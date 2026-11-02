import type { ConversationMessageCompactBody } from "@/backend/backend";
import { isUnselectedLocalModelHandle } from "@/backend/dev/pi-model-factory";
import { isRecord } from "@/utils/type-guards";
import {
  LOCAL_DEFAULT_COMPACTION_MODE,
  LOCAL_DEFAULT_SLIDING_WINDOW_PERCENTAGE,
  type LocalCompactionMode,
} from "./compaction";

/**
 * Local-backend compaction settings: parse and validate a settings value,
 * decide what to store on the agent, and resolve the settings one compaction
 * uses (mode, prompt, clip size, sliding-window share and summary model).
 */
export type LocalCompactionSettingsRecord = Record<string, unknown>;

export interface ResolvedLocalCompactionSettings {
  mode: LocalCompactionMode;
  prompt?: string | null;
  clipChars?: number | null;
  slidingWindowPercentage: number;
  /**
   * Model handle that writes the summary (for example
   * "anthropic/claude-haiku-5-5"). Unset means the agent's own model. The
   * summarizer falls back to the agent's model if this one fails.
   */
  model?: string;
}

export function compactionSettingsRecord(
  value: unknown,
): LocalCompactionSettingsRecord | null | undefined {
  if (value === null) return null;
  return isRecord(value) ? { ...value } : undefined;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function localCompactionMode(
  value: unknown,
): LocalCompactionMode | undefined {
  if (value === "all" || value === "sliding_window") return value;
  return undefined;
}

/**
 * The summary model a settings value names, or undefined. Cloud-only handles
 * (`letta/auto`, which Letta Code writes into new agents by default) and the
 * unselected placeholders are not local models, so they mean "use the
 * agent's model" exactly as before this setting was honored.
 */
export function localSummaryModelHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const handle = value.trim();
  return isUnselectedLocalModelHandle(handle) ? undefined : handle;
}

export function validateLocalCompactionSettingsRecord(
  settings: LocalCompactionSettingsRecord,
): void {
  if (settings.mode === undefined || settings.mode === null) return;
  if (!localCompactionMode(settings.mode)) {
    throw new Error(
      `Local backend compaction currently supports only modes "all" and "sliding_window" (received "${String(
        settings.mode,
      )}").`,
    );
  }
}

export function localCompactionSettingsForStorage(
  settings: LocalCompactionSettingsRecord | null | undefined,
): LocalCompactionSettingsRecord | null | undefined {
  if (settings === undefined || settings === null) return settings;

  const hasLocalSetting =
    hasOwn(settings, "mode") ||
    hasOwn(settings, "prompt") ||
    hasOwn(settings, "clip_chars") ||
    hasOwn(settings, "sliding_window_percentage") ||
    // Any model value is stored, including letta/auto: storing replaces the
    // agent's settings, so sending a non-local model is how a configured
    // summary model is cleared back to "the agent's own model".
    hasOwn(settings, "model");
  if (!hasLocalSetting) return undefined;

  return { ...settings };
}

/**
 * What one compaction uses: the agent's stored settings with a compact
 * request's settings merged over them. Changing the mode in a request without
 * a prompt drops the stored prompt (it belongs to the other mode).
 */
export function resolveLocalCompactionSettings(
  agentCompactionSettings: unknown,
  body?: ConversationMessageCompactBody,
): ResolvedLocalCompactionSettings {
  const bodyRecord = (body ?? {}) as Record<string, unknown>;
  const requestSettings = compactionSettingsRecord(
    bodyRecord.compaction_settings,
  );
  if (requestSettings !== undefined && requestSettings !== null) {
    validateLocalCompactionSettingsRecord(requestSettings);
  }
  const agentSettings = compactionSettingsRecord(agentCompactionSettings);
  const baseSettings =
    agentSettings && agentSettings !== null ? agentSettings : {};
  const mergedSettings =
    requestSettings && requestSettings !== null
      ? { ...baseSettings, ...requestSettings }
      : baseSettings;
  const requestChangedMode =
    requestSettings !== undefined &&
    requestSettings !== null &&
    hasOwn(requestSettings, "mode");
  const requestChangedPrompt =
    requestSettings !== undefined &&
    requestSettings !== null &&
    hasOwn(requestSettings, "prompt");
  if (
    requestChangedMode &&
    !requestChangedPrompt &&
    agentSettings &&
    agentSettings !== null &&
    agentSettings.mode !== requestSettings.mode
  ) {
    delete mergedSettings.prompt;
  }

  const mode =
    localCompactionMode(mergedSettings.mode) ?? LOCAL_DEFAULT_COMPACTION_MODE;
  const model = localSummaryModelHandle(mergedSettings.model);
  return {
    mode,
    prompt:
      typeof mergedSettings.prompt === "string" ||
      mergedSettings.prompt === null
        ? mergedSettings.prompt
        : undefined,
    clipChars:
      typeof mergedSettings.clip_chars === "number" ||
      mergedSettings.clip_chars === null
        ? mergedSettings.clip_chars
        : undefined,
    slidingWindowPercentage:
      typeof mergedSettings.sliding_window_percentage === "number"
        ? mergedSettings.sliding_window_percentage
        : LOCAL_DEFAULT_SLIDING_WINDOW_PERCENTAGE,
    ...(model ? { model } : {}),
  };
}
