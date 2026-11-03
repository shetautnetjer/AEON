import { createHash } from "node:crypto";
import { join } from "node:path";

export interface AttachedOptions {
  agentId?: string;
  conversationId?: string;
  create?: string;
  url?: string;
  tokenFile?: string;
  stateDir?: string;
  cwd?: string;
  phone: boolean;
  list: boolean;
  help: boolean;
  color: boolean;
  verbose: boolean;
}

export function parseAttachedOptions(argv: string[]): AttachedOptions {
  const options: AttachedOptions = {
    phone: false,
    list: false,
    help: false,
    color: true,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal < 0 ? raw : raw.slice(0, equal);
    const inline = equal < 0 ? undefined : raw.slice(equal + 1);
    const value = () => {
      const result = inline ?? argv[++i];
      if (!result || result.startsWith("-"))
        throw new Error(`${flag} requires a value`);
      return result;
    };
    switch (flag) {
      case "--agent":
      case "-a":
        options.agentId = value();
        break;
      case "--conv":
      case "--conversation":
      case "-C":
      case "-c":
        options.conversationId = value();
        break;
      case "--url":
      case "--app-server-url":
        options.url = value();
        break;
      case "--token-file":
      case "--app-server-token-file":
        options.tokenFile = value();
        break;
      case "--state-dir":
        options.stateDir = value();
        break;
      case "--cwd":
        options.cwd = value();
        break;
      case "--new":
        options.create =
          inline ??
          (argv[i + 1] && !argv[i + 1]?.startsWith("-")
            ? argv[++i]
            : "Terminal");
        break;
      case "--phone":
        options.phone = true;
        break;
      case "--list":
      case "--threads":
        options.list = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown attach option: ${flag}`);
    }
    if (
      inline !== undefined &&
      [
        "--phone",
        "--list",
        "--threads",
        "--help",
        "-h",
        "--no-color",
        "--verbose",
        "-v",
      ].includes(flag)
    ) {
      throw new Error(`${flag} does not accept a value`);
    }
  }
  if (
    [
      options.conversationId !== undefined,
      options.create !== undefined,
      options.phone,
    ].filter(Boolean).length > 1
  ) {
    throw new Error("Choose only one of --conversation, --new, or --phone");
  }
  if (
    options.list &&
    (options.conversationId !== undefined ||
      options.create !== undefined ||
      options.phone)
  ) {
    throw new Error(
      "--list cannot be combined with --conversation, --new, or --phone",
    );
  }
  return options;
}

/** Keep the existing primary-agent paths; other agents cannot overwrite them. */
export function attachedStateDirectory(
  root: string,
  agentId: string,
  primaryAgentId?: string,
): string {
  return agentId === primaryAgentId
    ? root
    : join(root, `agent-${createHash("sha256").update(agentId).digest("hex")}`);
}
