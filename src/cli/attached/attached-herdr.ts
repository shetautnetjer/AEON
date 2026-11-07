import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { AttachedSession, AttachedSnapshot } from "./attached-session";
import { type HerdrReport, sendHerdrReport } from "./herdr-transport";

interface ResumeOptions {
  url: string;
  tokenFile: string;
  cwd: string;
  stateDir: string;
  color: boolean;
  verbose: boolean;
  primaryAgentId?: string;
}

interface Invocation {
  executable: string;
  entry: string;
  platform?: NodeJS.Platform;
}

/** Reconstruct the native attach entry, never the mutable last/phone/new route. */
export function attachedHerdrResume(
  options: ResumeOptions,
  scope: AttachedSnapshot["scope"],
  invocation: Invocation,
): string[] | null {
  const command = basename(invocation.executable);
  const entry = resolve(invocation.entry);
  const portableEntry = entry.replaceAll("\\", "/");
  if ((invocation.platform ?? process.platform) === "win32") return null;
  const args = [
    "env",
    `AYA_AGENT_ID=${options.primaryAgentId ?? ""}`,
    resolve(invocation.executable),
  ];
  if (!/^(node|bun)(\.exe)?$/.test(command)) return null;
  if (portableEntry.endsWith("/src/cli/attached/entry.ts")) {
    if (!command.startsWith("bun")) return null;
    args.push(
      `--config=${join(dirname(entry), "../../..", "bunfig.toml")}`,
      "run",
      entry,
    );
  } else if (portableEntry.endsWith("/src/index.ts")) {
    if (!command.startsWith("bun")) return null;
    args.push(
      `--config=${join(dirname(entry), "..", "bunfig.toml")}`,
      "run",
      entry,
      "attach",
    );
  } else if (basename(entry) === "letta.js") {
    args.push(entry, "attach");
  } else return null;
  // Do not persist a bearer embedded in a URL. Native token-file references suffice.
  try {
    const url = new URL(options.url);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  args.push(
    "--agent",
    scope.agentId,
    "--conversation",
    scope.conversationId,
    "--url",
    options.url,
    "--cwd",
    resolve(options.cwd),
    "--token-file",
    resolve(options.tokenFile),
    "--state-dir",
    resolve(options.stateDir),
  );
  if (!options.color) args.push("--no-color");
  if (options.verbose) args.push("--verbose");
  // Herdr 0.9.5's restore command constraints, checked before reporting state.
  if (
    args.length > 64 ||
    args.reduce((n, arg) => n + Buffer.byteLength(arg), 0) > 8192 ||
    args.some((arg) => /['\p{Cc}]/u.test(arg))
  )
    return null;
  return args;
}

export function attachedHerdrState(snapshot: AttachedSnapshot): {
  state: "idle" | "working" | "blocked";
  message?: string;
} {
  if (snapshot.connection !== "connected")
    return { state: "blocked", message: "AEON connection unavailable" };
  if (snapshot.uncertainOwn.length)
    return {
      state: "blocked",
      message: "Input delivery requires reconciliation",
    };
  if (
    snapshot.pendingApprovals.length ||
    snapshot.loopStatus.status === "WAITING_ON_APPROVAL"
  )
    return { state: "blocked", message: "Native approval required" };
  if (snapshot.error)
    return { state: "blocked", message: "Native session requires attention" };
  if (
    snapshot.loopStatus.status === "WAITING_ON_INPUT" &&
    !snapshot.loopStatus.active_run_ids.length &&
    !snapshot.activeOwn.length &&
    snapshot.queue.length &&
    snapshot.queue.every((item) => item.paused)
  )
    return { state: "blocked", message: "Queued input is paused" };
  if (
    snapshot.loopStatus.status !== "WAITING_ON_INPUT" ||
    snapshot.loopStatus.active_run_ids.length ||
    snapshot.activeOwn.length ||
    snapshot.pendingOwn.length ||
    snapshot.queue.some((item) => !item.paused)
  )
    return { state: "working" };
  if (snapshot.queue.length)
    return { state: "blocked", message: "Queued input is paused" };
  return { state: "idle" };
}

/** Presentation-only observer. Neither reporting nor release submits native input. */
export function observeAttachedHerdr(
  session: Pick<AttachedSession, "getSnapshot" | "subscribe">,
  options: ResumeOptions,
  dependencies: {
    env?: NodeJS.ProcessEnv;
    invocation?: Invocation;
    send?: typeof sendHerdrReport;
    warn?: (reason: "unsupported" | "unavailable") => void;
    ready?: boolean;
  } = {},
): { ready: () => void; close: (intentionalExit: boolean) => Promise<void> } {
  const env = dependencies.env ?? process.env;
  const path = env.HERDR_SOCKET_PATH;
  const pane = env.HERDR_PANE_ID;
  if (env.HERDR_ENV !== "1" || !path || !pane)
    return { ready: () => {}, close: async () => {} };
  let ready = dependencies.ready ?? true;
  const invocation = dependencies.invocation ?? {
    executable: process.execPath,
    entry: process.argv[1] ?? "",
  };
  const send = dependencies.send ?? sendHerdrReport;
  // Herdr tracks sequence numbers by source. A fresh report stream avoids
  // comparing wall clocks across processes/reboots while preserving order
  // within this attached client, including after uncertain acknowledgements.
  const source = `aeon:attached:${randomUUID()}`;
  let seq = 0;
  type Pending = { report: HerdrReport; signature: string };
  let latest: Pending | undefined;
  let flight: Promise<void> | undefined;
  let activeSignature: string | undefined;
  let acknowledgedSignature: string | undefined;
  let closed = false;
  let mayHold = false;
  let warned = false;
  let failureWarned = false;
  const report = (
    method: HerdrReport["method"],
    fields: Partial<HerdrReport["params"]> = {},
  ): HerdrReport => ({
    method,
    params: {
      pane_id: pane,
      source,
      agent: "aeon",
      seq: ++seq,
      ...fields,
    },
  });
  const drain = () => {
    if (flight) return;
    flight = (async () => {
      while (latest) {
        const current = latest;
        latest = undefined;
        activeSignature = current.signature;
        if (current.report.method === "pane.report_agent") mayHold = true;
        let accepted = false;
        try {
          accepted = await send(path, current.report);
        } catch {
          /* Optional reporting cannot fail chat. */
        }
        acknowledgedSignature = accepted ? current.signature : undefined;
        if (accepted) {
          failureWarned = false;
          if (current.report.method === "pane.release_agent") mayHold = false;
        } else if (!failureWarned) {
          failureWarned = true;
          dependencies.warn?.("unavailable");
        }
        activeSignature = undefined;
      }
    })().finally(() => {
      flight = undefined;
      if (latest) drain();
    });
  };
  const enqueue = (
    method: HerdrReport["method"],
    fields: Partial<HerdrReport["params"]> = {},
  ) => {
    const signature = JSON.stringify({ method, fields });
    if (
      latest?.signature === signature ||
      (!latest && activeSignature === signature) ||
      (!flight && acknowledgedSignature === signature)
    )
      return;
    latest = { report: report(method, fields), signature };
    drain();
  };
  const update = () => {
    if (closed) return;
    const snapshot = session.getSnapshot();
    const resume = attachedHerdrResume(options, snapshot.scope, invocation);
    if (!resume) {
      if (!warned) dependencies.warn?.("unsupported");
      warned = true;
      // Omitting argv keeps Herdr's previous command. Withdraw it on an unsupported switch.
      if (mayHold || latest?.report.method === "pane.report_agent")
        enqueue("pane.release_agent");
      return;
    }
    warned = false;
    const state = ready
      ? attachedHerdrState(snapshot)
      : { state: "blocked" as const, message: "Native terminal starting" };
    const fields = { ...state, resume_argv: resume };
    enqueue("pane.report_agent", fields);
  };
  const unsubscribe = session.subscribe(update);
  update();
  return {
    ready() {
      ready = true;
      update();
    },
    async close(intentionalExit) {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (
        intentionalExit &&
        (mayHold || latest?.report.method === "pane.report_agent")
      )
        enqueue("pane.release_agent");
      while (flight) await flight;
    },
  };
}
