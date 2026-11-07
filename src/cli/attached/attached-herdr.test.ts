import { expect, test } from "bun:test";
import {
  attachedHerdrResume,
  attachedHerdrState,
  observeAttachedHerdr,
} from "./attached-herdr";
import {
  attachedStateDirectory,
  parseAttachedOptions,
} from "./attached-options";
import type { AttachedSnapshot } from "./attached-session";
import type { HerdrReport } from "./herdr-transport";

const options = {
  url: "ws://127.0.0.1:4599/ws",
  tokenFile: "/private/token file",
  cwd: "/project space",
  stateDir: "/selection",
  color: false,
  verbose: true,
  primaryAgentId: "aya",
};
const invocation = {
  executable: "/qualified/bin/node",
  entry: "/candidate/letta.js",
  platform: "linux" as const,
};
const env = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "pane-test",
  HERDR_SOCKET_PATH: "/unused/fixture.sock",
};
function snapshot(): AttachedSnapshot {
  return {
    scope: { agentId: "aya", conversationId: "conv-exact" },
    agent: null,
    history: [],
    generation: 1,
    deviceStatus: null,
    subagents: [],
    lastUsage: null,
    queue: [],
    pendingApprovals: [],
    pendingOwn: [],
    uncertainOwn: [],
    inputDisplayById: {},
    activeOwn: [],
    connection: "connected",
    loopStatus: {
      status: "WAITING_ON_INPUT",
      active_run_ids: [],
      executing_tool_call_ids: [],
    },
  };
}
function observable() {
  let value = snapshot();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (next: AttachedSnapshot) => {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("resume pins native identity, runtime, references and primary selection semantics without ambient routing", () => {
  const scope = snapshot().scope;
  const args = attachedHerdrResume(options, scope, invocation);
  expect(args?.slice(0, 5)).toEqual([
    "env",
    "AYA_AGENT_ID=aya",
    "/qualified/bin/node",
    "/candidate/letta.js",
    "attach",
  ]);
  const parsed = parseAttachedOptions(args?.slice(5) ?? []);
  expect(parsed).toMatchObject({
    agentId: "aya",
    conversationId: "conv-exact",
    url: options.url,
    tokenFile: options.tokenFile,
    cwd: options.cwd,
    stateDir: options.stateDir,
    color: false,
    verbose: true,
  });
  expect(parsed.create).toBeUndefined();
  expect(parsed.phone).toBe(false);
  expect(
    attachedStateDirectory(parsed.stateDir ?? "", parsed.agentId ?? "", "aya"),
  ).toBe("/selection");
  const switched = attachedHerdrResume(
    options,
    { agentId: "other", conversationId: "conv-other" },
    invocation,
  );
  const other = parseAttachedOptions(switched?.slice(5) ?? []);
  expect(
    attachedStateDirectory(other.stateDir ?? "", other.agentId ?? "", "aya"),
  ).toBe(
    attachedStateDirectory(options.stateDir, "other", options.primaryAgentId),
  );
  expect(
    attachedHerdrResume(
      { ...options, primaryAgentId: undefined },
      scope,
      invocation,
    )?.[1],
  ).toBe("AYA_AGENT_ID=");
});

test("Bun native launcher and main source both preserve owner bunfig and absolute entry", () => {
  for (const [entry, suffix] of [
    ["/candidate/src/cli/attached/entry.ts", []],
    ["/candidate/src/index.ts", ["attach"]],
  ] as const) {
    expect(
      attachedHerdrResume(options, snapshot().scope, {
        ...invocation,
        executable: "/qualified/bun",
        entry,
      })?.slice(0, 6 + suffix.length),
    ).toEqual([
      "env",
      "AYA_AGENT_ID=aya",
      "/qualified/bun",
      "--config=/candidate/bunfig.toml",
      "run",
      entry,
      ...suffix,
    ]);
  }
});

test("unsupported resume arguments never leak credential URLs or produce partial commands", () => {
  for (const url of [
    "ws://user:secret@localhost/ws",
    "ws://localhost/ws?token=secret",
    "ws://localhost/ws#secret",
    "not a url",
  ])
    expect(
      attachedHerdrResume({ ...options, url }, snapshot().scope, invocation),
    ).toBeNull();
  for (const tokenFile of [
    "/has'apostrophe",
    "/control\nfile",
    `/${"x".repeat(8192)}`,
  ])
    expect(
      attachedHerdrResume(
        { ...options, tokenFile },
        snapshot().scope,
        invocation,
      ),
    ).toBeNull();
  expect(
    attachedHerdrResume(options, snapshot().scope, {
      ...invocation,
      entry: "/unknown.js",
    }),
  ).toBeNull();
  expect(
    attachedHerdrResume(options, snapshot().scope, {
      ...invocation,
      platform: "win32",
    }),
  ).toBeNull();
});

test("native state distinguishes approval, uncertain delivery, disconnect and paused input from working or idle", () => {
  const s = snapshot();
  expect(attachedHerdrState(s).state).toBe("idle");
  expect(attachedHerdrState({ ...s, pendingOwn: ["own"] }).state).toBe(
    "working",
  );
  expect(attachedHerdrState({ ...s, uncertainOwn: ["own"] }).state).toBe(
    "blocked",
  );
  expect(attachedHerdrState({ ...s, connection: "disconnected" }).state).toBe(
    "blocked",
  );
  expect(attachedHerdrState({ ...s, error: "private provider text" })).toEqual({
    state: "blocked",
    message: "Native session requires attention",
  });
  expect(
    attachedHerdrState({
      ...s,
      loopStatus: { ...s.loopStatus, status: "WAITING_ON_APPROVAL" },
    }).state,
  ).toBe("blocked");
  expect(
    attachedHerdrState({
      ...s,
      loopStatus: { ...s.loopStatus, active_run_ids: ["other-client-run"] },
    }).state,
  ).toBe("working");
  const parked = {
    id: "q",
    client_message_id: "q",
    kind: "message" as const,
    source: "user" as const,
    content: "private",
    enqueued_at: "now",
    paused: true,
  };
  expect(
    attachedHerdrState({ ...s, pendingOwn: ["q"], queue: [parked] }).state,
  ).toBe("blocked");
});

test("inactive outside Herdr; no environment discovery or reporting", async () => {
  let calls = 0;
  for (const absent of [
    {},
    { ...env, HERDR_ENV: "0" },
    { ...env, HERDR_SOCKET_PATH: "" },
  ]) {
    const session = observable();
    const observer = observeAttachedHerdr(session, options, {
      env: absent,
      invocation,
      send: async () => {
        calls++;
        return true;
      },
    });
    session.update({ ...snapshot(), pendingOwn: ["test"] });
    await observer.close(true);
  }
  expect(calls).toBe(0);
});

test("startup remains blocked until native input subscriptions are ready", async () => {
  const session = observable();
  const reports: HerdrReport[] = [];
  const observer = observeAttachedHerdr(session, options, {
    env,
    invocation,
    ready: false,
    send: async (_path, report) => {
      reports.push(report);
      return true;
    },
  });
  await settle();
  session.update(snapshot());
  await settle();
  expect(reports).toHaveLength(1);
  expect(reports[0]?.params.state).toBe("blocked");
  expect(reports[0]?.params.message).toBe("Native terminal starting");
  observer.ready();
  await settle();
  expect(reports.at(-1)?.params.state).toBe("idle");
  await observer.close(false);
  observer.ready();
  await settle();
  expect(reports).toHaveLength(2);
});

test("coalesces in-flight updates, keeps native scope on late acknowledgment, and releases after intentional quit", async () => {
  const session = observable();
  const reports: HerdrReport[] = [];
  let acknowledge: (() => void) | undefined;
  const observer = observeAttachedHerdr(session, options, {
    env,
    invocation,
    send: async (_path, report) => {
      reports.push(report);
      if (reports.length === 1)
        await new Promise<void>((resolve) => {
          acknowledge = resolve;
        });
      return true;
    },
  });
  session.update({ ...snapshot(), pendingOwn: ["old"] });
  session.update({
    ...snapshot(),
    scope: { agentId: "other", conversationId: "new" },
    connection: "disconnected",
  });
  expect(reports).toHaveLength(1);
  acknowledge?.();
  await settle();
  expect(reports).toHaveLength(2);
  expect(reports[1]?.params.state).toBe("blocked");
  expect(reports[1]?.params.resume_argv).toContain("new");
  expect(reports[1]?.params.resume_argv).not.toContain("conv-exact");
  expect(reports[1]?.params.seq ?? -1).toBeGreaterThan(
    reports[0]?.params.seq ?? Infinity,
  );
  await observer.close(true);
  expect(reports.at(-1)?.method).toBe("pane.release_agent");
  expect(reports.at(-1)?.params.source).toBe(reports[0]?.params.source);
  expect(reports[0]?.params.source).toStartWith("aeon:attached:");
  expect(JSON.stringify(reports)).not.toContain("private provider text");
});

test("disconnect and unexpected exit retain restore metadata, reporting rejection does not affect the session", async () => {
  const session = observable();
  const reports: HerdrReport[] = [];
  const observer = observeAttachedHerdr(session, options, {
    env,
    invocation,
    send: async (_path, report) => {
      reports.push(report);
      throw new Error("not available");
    },
  });
  session.update({ ...snapshot(), connection: "disconnected" });
  await observer.close(false);
  expect(reports.at(-1)?.params.state).toBe("blocked");
  expect(reports.some((report) => report.method === "pane.release_agent")).toBe(
    false,
  );
});

test("unsupported scope withdraws stale resume and warns once; supported replacement publishes exact new scope", async () => {
  const session = observable();
  const reports: HerdrReport[] = [];
  let warnings = 0;
  const observer = observeAttachedHerdr(session, options, {
    env,
    invocation,
    warn: () => {
      warnings++;
    },
    send: async (_path, report) => {
      reports.push(report);
      return true;
    },
  });
  await settle();
  const unsupported = {
    ...snapshot(),
    scope: { agentId: "aya", conversationId: "can't-restore" },
  };
  session.update(unsupported);
  session.update(unsupported);
  await settle();
  expect(reports.at(-1)?.method).toBe("pane.release_agent");
  expect(warnings).toBe(1);
  session.update({
    ...snapshot(),
    scope: { agentId: "aya", conversationId: "replacement" },
  });
  await observer.close(false);
  expect(reports.at(-1)?.params.resume_argv).toContain("replacement");
});

test("failed acknowledgment or withdrawal stays retryable on a later native update without a retry timer", async () => {
  const session = observable();
  const reports: HerdrReport[] = [];
  const warnings: string[] = [];
  let accepted = false;
  const observer = observeAttachedHerdr(session, options, {
    env,
    invocation,
    warn: (reason) => warnings.push(reason),
    send: async (_path, report) => {
      reports.push(report);
      return accepted;
    },
  });
  await settle();
  await settle();
  expect(reports).toHaveLength(1);
  accepted = true;
  session.update(snapshot());
  await settle();
  expect(reports).toHaveLength(2);
  session.update(snapshot());
  await settle();
  expect(reports).toHaveLength(2);
  accepted = false;
  const unsupported = {
    ...snapshot(),
    scope: { agentId: "aya", conversationId: "can't-restore" },
  };
  session.update(unsupported);
  await settle();
  expect(reports.at(-1)?.method).toBe("pane.release_agent");
  accepted = true;
  session.update(unsupported);
  await observer.close(false);
  expect(
    reports.filter((report) => report.method === "pane.release_agent"),
  ).toHaveLength(2);
  expect(warnings).toEqual(["unavailable", "unsupported", "unavailable"]);
});

test("a restarted client has a fresh report stream and cannot be rejected by a prior process sequence", async () => {
  const sequences = new Map<string, number>();
  const applied: HerdrReport[] = [];
  const send = async (_path: string, report: HerdrReport) => {
    const previous = sequences.get(report.params.source) ?? 0;
    if (report.params.seq > previous) {
      sequences.set(report.params.source, report.params.seq);
      applied.push(report);
    }
    // Herdr returns ok even when it ignores a stale sequence.
    return true;
  };
  const first = observeAttachedHerdr(observable(), options, {
    env,
    invocation,
    send,
  });
  await first.close(false);
  const second = observeAttachedHerdr(observable(), options, {
    env,
    invocation,
    send,
  });
  await second.close(true);
  expect(applied.map((r) => r.method)).toEqual([
    "pane.report_agent",
    "pane.report_agent",
    "pane.release_agent",
  ]);
  expect(applied[0]?.params.source).not.toBe(applied[1]?.params.source);
  expect(applied[1]?.params.source).toBe(applied[2]?.params.source);
});
