import { Box, useInput } from "ink";
import {
  createElement,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { OverlayShell } from "@/cli/components/OverlayShell";
import { Text } from "@/cli/components/Text";
import {
  attachedControlId,
  hasAttachedControl,
} from "@/types/attached-control-commands";
import type { ExecuteCommandResponseMessage } from "@/types/task-control-protocol";
import type { AttachedSession, AttachedSnapshot } from "./attached-session";

export type InspectionSelector =
  | "context"
  | "usage"
  | "search"
  | "subagents"
  | "bg"
  | "mcp";
export interface AttachedCommandInspectionProps {
  session: AttachedSession;
  selector: InspectionSelector;
  args: string;
  onClose: () => void;
  onNotice: (text: string) => void;
}

/** Escape control characters and directional formatting in untrusted daemon output. */
export function inspectionText(value: unknown, max = 240): string {
  let out = "";
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0) ?? 0;
    const unsafe =
      code < 32 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
    out += unsafe ? `\\u${code.toString(16).padStart(4, "0")}` : char;
    if (out.length >= max) return `${out.slice(0, max)}…`;
  }
  return out;
}

export function buildInspectionLines(
  selector: InspectionSelector,
  snapshot: AttachedSnapshot,
): string[] {
  const status = snapshot.deviceStatus?.device_status;
  if (selector === "context") {
    const config = snapshot.agent?.llm_config;
    const window =
      config &&
      typeof config === "object" &&
      "context_window" in config &&
      typeof config.context_window === "number"
        ? config.context_window
        : undefined;
    const observed = snapshot.lastUsage?.context_tokens;
    return [
      `Agent: ${inspectionText(snapshot.agent?.name ?? snapshot.scope.agentId)}`,
      `Conversation: ${inspectionText(snapshot.scope.conversationId)}`,
      `Model: ${inspectionText(snapshot.agent?.model ?? "not reported")}`,
      `Configured context window: ${window === undefined ? "not reported" : window.toLocaleString()}`,
      `Last observed context estimate: ${observed == null ? "not reported" : observed.toLocaleString()} (may not be current)`,
      `Memory directory: ${inspectionText(status?.memory_directory ?? "not reported")}`,
    ];
  }
  if (selector === "usage") {
    const usage = snapshot.lastUsage;
    if (!usage)
      return [
        "No completed-turn usage has been observed by this terminal.",
        "Session totals and account balance are not included in this snapshot.",
      ];
    return [
      "Last observed completed turn (not session totals):",
      `Prompt: ${usage.prompt_tokens ?? "not reported"}; completion: ${usage.completion_tokens ?? "not reported"}; total: ${usage.total_tokens ?? "not reported"}`,
      `Cached input: ${usage.cached_input_tokens ?? "not reported"}; steps: ${usage.step_count ?? "not reported"}`,
      "Account balance is not included in this snapshot.",
    ];
  }
  if (selector === "subagents") {
    if (snapshot.subagents === null)
      return ["The app server has not sent a subagent snapshot."];
    const lines = snapshot.subagents.map(
      (entry) =>
        `${inspectionText(entry.subagent_type)} ${inspectionText(entry.subagent_id)} — ${inspectionText(entry.status)} — ${inspectionText(entry.description)}`,
    );
    return [
      "Subagents reported for this conversation:",
      ...(lines.length ? lines.slice(0, 50) : ["None reported."]),
      ...(lines.length > 50 ? [`${lines.length - 50} more omitted.`] : []),
    ];
  }
  if (selector === "bg") {
    if (!status)
      return [
        "The app server has not advertised a background-process snapshot.",
      ];
    const lines = status.background_processes.map(
      (process) =>
        `${inspectionText(process.kind)} ${inspectionText(process.process_id)} — ${inspectionText(process.status)}${"description" in process ? ` — ${inspectionText(process.description)}` : ""}`,
    );
    return [
      "Background processes advertised for this runtime:",
      ...(lines.length ? lines.slice(0, 50) : ["None reported."]),
      ...(lines.length > 50 ? [`${lines.length - 50} more omitted.`] : []),
    ];
  }
  return [];
}

type SearchRange = "agent" | "conv" | "all";
type SearchMode = "auto" | "fts" | "vector" | "hybrid";
export function AttachedCommandInspection({
  session,
  selector,
  args,
  onClose,
}: AttachedCommandInspectionProps) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [query, setQuery] = useState(args);
  const [range, setRange] = useState<SearchRange>("agent");
  const [mode, setMode] = useState<SearchMode>("auto");
  const [requestArgs, setRequestArgs] = useState<string | null>(() =>
    selector === "mcp"
      ? ""
      : selector === "search" && args.trim()
        ? JSON.stringify({ query: args.trim(), range: "agent" })
        : null,
  );
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [searchNumber, setSearchNumber] = useState(0);
  const isRemote = selector === "search" || selector === "mcp";
  const supported = hasAttachedControl(
    snapshot.deviceStatus?.device_status.supported_commands,
    selector,
  );
  useEffect(() => {
    void searchNumber; // Re-run an explicitly resubmitted identical query.
    if (!isRemote || requestArgs === null) return;
    if (!supported) {
      setOutput([
        `The running app server does not advertise /${selector} inspection.`,
      ]);
      return;
    }
    let active = true;
    const scopeGeneration = snapshot.generation;
    const client = session.client;
    const runtime = {
      agent_id: snapshot.scope.agentId,
      conversation_id: snapshot.scope.conversationId,
    };
    setLoading(true);
    void client
      .request<ExecuteCommandResponseMessage>(
        {
          type: "execute_command",
          request_id: client.nextRequestId(selector),
          command_id: attachedControlId(selector),
          args: requestArgs,
          runtime,
        },
        {
          predicate: (frame): frame is ExecuteCommandResponseMessage =>
            frame.type === "execute_command_response",
        },
      )
      .then((response) => {
        if (!active || session.getSnapshot().generation !== scopeGeneration)
          return;
        setPage(0);
        setOutput(
          (
            response.output ||
            (response.success ? "No results." : "Request failed.")
          )
            .split("\n")
            .slice(0, 205)
            .map((line) => inspectionText(line)),
        );
      })
      .catch(() => {
        if (active && session.getSnapshot().generation === scopeGeneration)
          setOutput([`Could not retrieve /${selector} from the app server.`]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    isRemote,
    requestArgs,
    searchNumber,
    selector,
    session,
    snapshot.generation,
    snapshot.scope.agentId,
    snapshot.scope.conversationId,
    supported,
  ]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || key.downArrow) {
      setPage((previous) =>
        Math.max(
          0,
          Math.min(
            Math.ceil(output.length / 8) - 1,
            previous + (key.downArrow ? 1 : -1),
          ),
        ),
      );
      return;
    }
    if (selector !== "search") {
      if (key.return) onClose();
      return;
    }
    if (key.tab) {
      if (key.shift)
        setMode(
          (previous) =>
            ({ auto: "fts", fts: "vector", vector: "hybrid", hybrid: "auto" })[
              previous
            ] as SearchMode,
        );
      else
        setRange(
          (previous) =>
            ({ agent: "conv", conv: "all", all: "agent" })[
              previous
            ] as SearchRange,
        );
      return;
    }
    if (key.return) {
      if (!query.trim()) {
        setOutput(["Enter a search query."]);
        return;
      }
      setRequestArgs(
        JSON.stringify({
          query: query.trim(),
          range,
          ...(mode === "auto" ? {} : { mode }),
        }),
      );
      setSearchNumber((previous) => previous + 1);
      return;
    }
    if (key.backspace || key.delete)
      setQuery((previous) => previous.slice(0, -1));
    else if (input && !key.ctrl && !key.meta)
      setQuery((previous) => previous + input);
  });

  const allLines = isRemote ? output : buildInspectionLines(selector, snapshot);
  const lines = allLines.slice(page * 8, page * 8 + 8);
  const children = createElement(
    Box,
    { flexDirection: "column" },
    ...(selector === "search"
      ? [
          createElement(
            Text,
            { key: "query" },
            `Query: ${inspectionText(query, 200)}  [${range}, ${mode}]`,
          ),
        ]
      : []),
    ...(loading
      ? [createElement(Text, { key: "loading", dimColor: true }, "Searching…")]
      : []),
    ...lines.map((line, index) => createElement(Text, { key: index }, line)),
  );
  return createElement(OverlayShell, {
    command: `/${selector}`,
    title: selector,
    footer:
      selector === "search"
        ? "Type query; Enter search; Tab range; Shift-Tab mode; arrows page; Esc close"
        : "Arrows page; Enter or Esc to close",
    children,
  });
}
