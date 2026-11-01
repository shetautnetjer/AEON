/** Redaction shared by `letta mcp get` and `letta mcp add/remove` output. */

const SENSITIVE_NAME = /token|key|secret|password|signature|credential|auth/i;

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** Redact values that follow (or are inline with) sensitive-named flags. */
export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push("[REDACTED]");
      redactNext = false;
      continue;
    }
    if (arg.startsWith("-")) {
      const equalsIndex = arg.indexOf("=");
      const flagName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
      if (SENSITIVE_NAME.test(flagName)) {
        if (equalsIndex === -1) {
          redactNext = true;
          redacted.push(arg);
        } else {
          redacted.push(`${flagName}=[REDACTED]`);
        }
        continue;
      }
    }
    redacted.push(arg);
  }
  return redacted;
}

export function redactValues(
  values: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(values ?? {})
      .sort()
      .map((name) => [name, "[REDACTED]"]),
  );
}
