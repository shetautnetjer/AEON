function numericEventDataValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringEventDataValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) return `${Math.max(0, Math.round(delayMs))}ms`;
  return `${Math.round(delayMs / 1000)}s`;
}

export function formatRetryEventStatusLines(
  eventData: Record<string, unknown>,
): string[] {
  const attempt = numericEventDataValue(eventData.attempt);
  const maxAttempts = numericEventDataValue(eventData.max_attempts);
  const delayMs = numericEventDataValue(eventData.delay_ms);
  const message = stringEventDataValue(eventData.message);

  const metadata: string[] = [];
  if (attempt !== undefined) {
    metadata.push(
      maxAttempts !== undefined
        ? `attempt ${attempt}/${maxAttempts}`
        : `attempt ${attempt}`,
    );
  }
  if (delayMs !== undefined) {
    metadata.push(`in ${formatRetryDelay(delayMs)}`);
  }

  return [
    `Provider stream error, retrying${
      metadata.length > 0 ? ` (${metadata.join(", ")})` : ""
    }${message ? `: ${message}` : ""}`,
  ];
}
