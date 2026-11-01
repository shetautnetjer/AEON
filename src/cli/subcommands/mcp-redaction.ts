/** Redaction shared by `letta mcp get` and `letta mcp add/remove` output. */

export const SENSITIVE_NAME =
  /token|key|secret|password|signature|credential|auth/i;

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

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Redact secrets in command-line args: URL credentials and sensitive query
 * values, `NAME=value` (with or without leading dashes) and `Name: value`
 * where NAME looks sensitive, and the arg after a sensitive bare flag.
 */
export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push("[REDACTED]");
      redactNext = false;
      continue;
    }
    if (URL_LIKE.test(arg)) {
      redacted.push(redactUrl(arg));
      continue;
    }
    const pair = arg.match(/^([^=:\s]+)(=|:\s*)(.*)$/s);
    if (pair) {
      const [, name = "", separator = "", value = ""] = pair;
      if (SENSITIVE_NAME.test(name)) {
        redacted.push(`${name}${separator}[REDACTED]`);
      } else {
        redacted.push(
          URL_LIKE.test(value) ? `${name}${separator}${redactUrl(value)}` : arg,
        );
      }
      continue;
    }
    if (arg.startsWith("-") && SENSITIVE_NAME.test(arg)) redactNext = true;
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
