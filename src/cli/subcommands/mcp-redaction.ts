/** Redaction shared by `letta mcp get` and `letta mcp add/remove` output. */

export const SENSITIVE_NAME =
  /token|key|secret|password|signature|credential|auth/i;

/** URL query parameter names whose values are redacted (substring, any case). */
const SENSITIVE_QUERY_NAME =
  /sig|signature|key|token|secret|password|auth|credential|code/i;

const REDACTED = "[REDACTED]";
const REDACTED_URL = "[REDACTED_URL]";

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
// scheme://[userinfo@]host — host stops at the first / ? # or port colon.
const SCHEME_AND_HOST = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/?#@]*@)?([^/?#:@\s]+)/i;

/**
 * Redact a URL for display: credentials, sensitive query values and the
 * whole fragment. A URL that does not parse is never returned raw: only its
 * scheme and host are kept when they can be extracted.
 */
export function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const match = value.match(SCHEME_AND_HOST);
    return match ? `${match[1]}://${match[2]}/${REDACTED_URL}` : REDACTED_URL;
  }
  url.username = "";
  url.password = "";
  for (const key of new Set(url.searchParams.keys())) {
    if (SENSITIVE_QUERY_NAME.test(key)) url.searchParams.set(key, REDACTED);
  }
  const hadFragment = url.hash !== "" || value.includes("#");
  url.hash = "";
  return hadFragment ? `${url.toString()}#${REDACTED}` : url.toString();
}

const PAIR = /^([^=:\s]+)(=|:\s*)(.*)$/s;

/**
 * One arg or the value side of a pair: URLs are redacted, `NAME=value` and
 * `Name: value` with a sensitive NAME lose their value, and otherwise the
 * value side is inspected the same way (so `--header=Authorization: x` and
 * `--env=API_KEY=x` are caught, not only the outer flag name).
 */
function redactArg(arg: string, depth = 0): string {
  if (URL_LIKE.test(arg)) return redactUrl(arg);
  const pair = depth < 4 ? arg.match(PAIR) : null;
  if (!pair) return arg;
  const [, name = "", separator = "", value = ""] = pair;
  if (SENSITIVE_NAME.test(name)) return `${name}${separator}${REDACTED}`;
  const inner = redactArg(value, depth + 1);
  return inner === value ? arg : `${name}${separator}${inner}`;
}

/**
 * Redact secrets in command-line args: URL credentials, sensitive query
 * values and fragments, `NAME=value` (with or without leading dashes) and
 * `Name: value` where NAME looks sensitive — also when nested in the value of
 * another flag — and the arg after a sensitive bare flag.
 */
export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }
    if (!URL_LIKE.test(arg) && !PAIR.test(arg)) {
      if (arg.startsWith("-") && SENSITIVE_NAME.test(arg)) redactNext = true;
      redacted.push(arg);
      continue;
    }
    redacted.push(redactArg(arg));
  }
  return redacted;
}

export function redactValues(
  values: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(values ?? {})
      .sort()
      .map((name) => [name, REDACTED]),
  );
}
