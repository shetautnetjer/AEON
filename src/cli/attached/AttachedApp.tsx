import { Box, Text, useApp, useInput } from "ink";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StaticTranscript } from "@/cli/app/StaticTranscript";
import type { StaticItem } from "@/cli/app/types";
import { commands } from "@/cli/commands/registry";
import { AssistantMessage } from "@/cli/components/AssistantMessageRich";
import { CommandMessage } from "@/cli/components/CommandMessage";
import { ErrorMessage } from "@/cli/components/ErrorMessageRich";
import { EventMessage } from "@/cli/components/EventMessage";
import { HelpDialog } from "@/cli/components/HelpDialog";
import { InlineGenericApproval } from "@/cli/components/InlineGenericApproval";
import { Input } from "@/cli/components/InputRich";
import { LiveReasoningMessage } from "@/cli/components/ReasoningMessageRich";
import { StatusMessage } from "@/cli/components/StatusMessage";
import { SubagentGroupStatic } from "@/cli/components/SubagentGroupStatic";
import { ToolCallMessage } from "@/cli/components/ToolCallMessageRich";
import { toggleThinkingDisplay } from "@/cli/components/transcript-display-state";
import { LiveUserMessage } from "@/cli/components/UserMessageRich";
import {
  createBuffers,
  extractTextPart,
  type Line,
  markCurrentLineAsFinished,
  onChunk,
  setToolCallsRunning,
  toLines,
} from "@/cli/helpers/accumulator";
import {
  backfillBuffers,
  removeSystemContextBlocks,
} from "@/cli/helpers/backfill";
import { buildCliModContext } from "@/cli/helpers/cli-mod-context";
import {
  useTerminalRows,
  useTerminalWidth,
} from "@/cli/hooks/use-terminal-width";
import type { LocalModAdapter } from "@/cli/mods/use-local-mod-adapter";
import {
  ATTACHED_CONTROL_NAMES,
  hasAttachedControl,
} from "@/types/attached-control-commands";
import type { ConversationMessagesListResponseMessage } from "@/types/protocol_v2";
import { attachedSkills } from "./attached-command-operations";
import {
  ATTACHED_COMMAND_CLASSIFICATION,
  type AttachedCommandAction,
  AttachedCommandView,
  routeAttachedCommand,
} from "./attached-commands";
import {
  type AttachedSession,
  type AttachedSnapshot,
  UncertainInputError,
} from "./attached-session";
import { formatFullApprovalInput } from "./attached-ui-approval";
import { isPrivateAttachedDraft } from "./attached-ui-draft";

type ViewAction = Extract<
  AttachedCommandAction,
  { kind: "selector" | "server" }
>;
const diffs = new Map();

function LiveLine({ line, streaming }: { line: Line; streaming: boolean }) {
  switch (line.kind) {
    case "user":
      return <LiveUserMessage line={line} prompt=">" />;
    case "assistant":
      return <AssistantMessage line={line} />;
    case "reasoning":
      return <LiveReasoningMessage line={line} />;
    case "tool_call":
      return (
        <ToolCallMessage
          line={line}
          precomputedDiffs={diffs}
          isStreaming={streaming}
        />
      );
    case "error":
      return <ErrorMessage line={line} />;
    case "event":
      return <EventMessage line={line} />;
    case "status":
      return <StatusMessage line={line} />;
    case "command":
      return <CommandMessage line={line} />;
    default:
      return null;
  }
}

/** Native presentation for an existing app-server session. No local agent loop is started. */
export function AttachedApp({
  session,
  onIntentionalExit,
  onReady,
}: {
  session: AttachedSession;
  onIntentionalExit?: () => void;
  onReady?: () => void;
}) {
  // Child input subscriptions mount before this effect. Publishing idle earlier
  // can lose an automated Enter while the native UI is still loading.
  useEffect(() => onReady?.(), [onReady]);
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const columns = useTerminalWidth();
  const rows = useTerminalRows();
  const app = useApp();
  const [notice, setNotice] = useState("");
  const [skillList, setSkillList] = useState<{
    generation: number;
    choices: { id: string; description?: string }[];
  }>({ generation: 0, choices: [] });
  const [approvalFailed, setApprovalFailed] = useState(false);
  const [overlay, setOverlay] = useState<ViewAction | "help" | null>(null);
  const [, redraw] = useState(0);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const createModel = useCallback((current: AttachedSnapshot) => {
    const buffers = createBuffers(current.scope.agentId);
    backfillBuffers(buffers, current.history);
    const initial = toLines(buffers);
    // Incomplete tool calls must remain live: later server results update them.
    const completedHistory = initial.filter(
      (line) => line.kind !== "tool_call" || line.phase === "finished",
    );
    return {
      generation: current.generation,
      buffers,
      staticItems: [
        {
          kind: "welcome",
          id: `welcome-${current.generation}`,
          snapshot: {
            continueSession: true,
            agentState: current.agent,
            terminalWidth: columnsRef.current,
            attachedContext: {
              workingDirectory:
                current.deviceStatus?.device_status.current_working_directory ??
                null,
            },
          },
        } as StaticItem,
        ...completedHistory,
      ],
      committed: new Set(completedHistory.map((line) => line.id)),
      // Exact canonical IDs prevent pre-attach deltas from duplicating stored messages.
      historyIds: new Set(
        current.history.flatMap((message) => (message.id ? [message.id] : [])),
      ),
      deferred: false,
      failures: [] as { id: number; text: string }[],
      failureSerial: 0,
    };
  }, []);
  const modelRef = useRef<ReturnType<typeof createModel> | null>(null);
  const ensureModel = useCallback(
    (current: AttachedSnapshot) => {
      if (
        !modelRef.current ||
        modelRef.current.generation !== current.generation
      )
        modelRef.current = createModel(current);
      return modelRef.current;
    },
    [createModel],
  );
  const model = ensureModel(snapshot);
  useEffect(
    () =>
      session.onFrame((frame) => {
        // The transport may deliver buffered frames synchronously before React renders a switched scope.
        const current = session.getSnapshot();
        const state = ensureModel(current);
        const hasApproval = current.pendingApprovals.length > 0;
        if (frame.type === "stream_delta") {
          const delta = frame.delta;
          if ("message_type" in delta) {
            if (delta.message_type === "loop_error") {
              if (state.failures.at(-1)?.text !== delta.message)
                state.failures.push({
                  id: ++state.failureSerial,
                  text: delta.message,
                });
            } else if (
              delta.message_type === "retry" ||
              delta.message_type === "status"
            )
              setNotice(delta.message);
            if (delta.message_type === "client_tool_start")
              setToolCallsRunning(state.buffers, [delta.tool_call_id]);
            if (
              delta.message_type === "command_start" ||
              delta.message_type === "slash_command_start" ||
              delta.message_type === "command_end" ||
              delta.message_type === "slash_command_end"
            ) {
              const id = `command-${delta.command_id}`;
              const complete =
                delta.message_type === "command_end" ||
                delta.message_type === "slash_command_end";
              state.buffers.byId.set(id, {
                kind: "command",
                id,
                input: delta.input,
                output: complete ? delta.output : "",
                phase: complete ? "finished" : "running",
                ...(complete ? { success: delta.success } : {}),
              });
              if (!state.buffers.order.includes(id))
                state.buffers.order.push(id);
            }
            const id =
              "id" in delta && typeof delta.id === "string"
                ? delta.id
                : undefined;
            if (!id || !state.historyIds.has(id)) {
              const chunk =
                delta.message_type === "user_message"
                  ? {
                      ...delta,
                      content:
                        (delta.otid &&
                          current.inputDisplayById?.[delta.otid]) ??
                        removeSystemContextBlocks(
                          extractTextPart(delta.content),
                        ),
                    }
                  : delta;
              onChunk(
                state.buffers,
                chunk as Parameters<typeof onChunk>[1],
                undefined,
                { presentationOnly: true },
              );
            }
            setToolCallsRunning(
              state.buffers,
              session.getSnapshot().loopStatus.executing_tool_call_ids ?? [],
            );
          }
        } else if (frame.type === "turn_finished") {
          markCurrentLineAsFinished(state.buffers);
          if (frame.error && state.failures.at(-1)?.text !== frame.error)
            state.failures.push({
              id: ++state.failureSerial,
              text: frame.error,
            });
          if (!hasApproval) {
            for (const line of toLines(state.buffers)) {
              if (!state.committed.has(line.id)) {
                state.staticItems.push(line);
                state.committed.add(line.id);
              }
            }
          }
        }
        if (hasApproval) state.deferred = true;
        else redraw((value) => value + 1);
      }),
    [session, ensureModel],
  );
  useEffect(() => {
    if (!snapshot.pendingApprovals.length && model.deferred) {
      model.deferred = false;
      redraw((value) => value + 1);
    }
    if (snapshot.pendingApprovals.length) setOverlay(null);
    else setApprovalFailed(false);
  }, [model, snapshot.pendingApprovals.length]);
  const skillsSupported = hasAttachedControl(
    snapshot.deviceStatus?.device_status.supported_commands,
    "skills",
  );
  useEffect(() => {
    if (!skillsSupported || snapshot.connection !== "connected") return;
    let live = true;
    const generation = snapshot.generation;
    void attachedSkills(session)
      .then((result) => {
        if (live && session.getSnapshot().generation === generation)
          setSkillList({
            generation,
            choices: result.choices.map((choice) => ({
              id: choice.key,
              description: choice.description,
            })),
          });
      })
      .catch((error) => {
        if (live && session.getSnapshot().generation === generation)
          setNotice(
            `Skill completion unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    return () => {
      live = false;
    };
  }, [session, snapshot.generation, snapshot.connection, skillsSupported]);
  const invocableSkills = useMemo(
    () =>
      skillsSupported && skillList.generation === snapshot.generation
        ? skillList.choices
        : [],
    [skillsSupported, skillList, snapshot.generation],
  );
  const remoteCompletions = useMemo(() => {
    const supported =
      snapshot.deviceStatus?.device_status.supported_commands ?? [];
    const known = Object.entries(ATTACHED_COMMAND_CLASSIFICATION).map(
      ([cmd, kind]) => {
        const id =
          cmd === "/set-max-context"
            ? "context-limit"
            : cmd === "/profiles"
              ? "pinned"
              : cmd.slice(1);
        const isPrivate = (
          ATTACHED_CONTROL_NAMES as readonly string[]
        ).includes(id);
        const available =
          kind !== "unavailable" &&
          (isPrivate
            ? hasAttachedControl(supported, id)
            : kind !== "remote" || supported.includes(id));
        return {
          cmd,
          desc: `${commands[cmd]?.desc ?? "Command"}${available ? "" : " (unavailable while attached)"}`,
          order: commands[cmd]?.order ?? 100,
        };
      },
    );
    const ids = new Set(known.map((item) => item.cmd));
    for (const name of [
      "/threads",
      "/switch",
      "/history",
      "/status",
      "/stop",
      "/quit",
    ])
      if (!ids.has(name))
        known.push({
          cmd: name,
          desc: "Attached terminal command",
          order: 100,
        });
    for (const command of snapshot.deviceStatus?.device_status.mod_commands ??
      []) {
      const cmd = `/${command.id}`;
      if (!ids.has(cmd))
        known.push({
          cmd,
          desc: `${command.description}${command.args ? ` ${command.args}` : ""} (remote mod)`,
          order: 200,
        });
    }
    for (const skill of invocableSkills) {
      const cmd = `/${skill.id}`;
      if (!ids.has(cmd) && !known.some((item) => item.cmd === cmd))
        known.push({
          cmd,
          desc: `${skill.description ?? "Skill"} (skill)`,
          order: 300,
        });
    }
    return known.sort((a, b) => a.order - b.order);
  }, [snapshot.deviceStatus, invocableSkills]);
  const subagents = (snapshot.subagents ?? []).filter(
    (agent) => !agent.silent || agent.is_background,
  );
  const shownSubagents = subagents
    .filter((agent) => agent.status !== "pending")
    .map((agent) => ({
      id: agent.subagent_id,
      type: agent.subagent_type,
      description: agent.description,
      status: agent.status as "running" | "completed" | "error",
      toolCount: agent.tool_calls.length,
      totalTokens: agent.total_tokens,
      agentURL: agent.agent_url,
      error: agent.error,
      model: agent.model,
      isBackground: agent.is_background,
    }));
  const busy = snapshot.loopStatus.status !== "WAITING_ON_INPUT";
  const remoteMode =
    snapshot.deviceStatus?.device_status.current_permission_mode;
  const approval = snapshot.pendingApprovals[0];
  useInput(
    (input, key) => {
      if (key.ctrl && input === "t") toggleThinkingDisplay();
    },
    { isActive: !approval && !overlay },
  );
  const full = approval
    ? formatFullApprovalInput(
        {
          tool: approval.frame.request.tool_name,
          input: approval.frame.request.input,
        },
        columns,
        rows,
      )
    : null;
  const context = useMemo(
    () =>
      buildCliModContext({
        currentDirectory: process.cwd(),
        projectDirectory: process.cwd(),
        agentId: snapshot.scope.agentId,
        agentName: snapshot.agent?.name,
        sessionId: snapshot.scope.conversationId,
        terminalWidth: columns,
      }),
    [
      snapshot.scope.agentId,
      snapshot.scope.conversationId,
      snapshot.agent?.name,
      columns,
    ],
  );
  // Input's presentation only consults registry and loading flags; do not load a local mod runtime.
  const inertAdapter = useMemo(
    () =>
      ({
        context,
        registry: null,
        isLoading: false,
        hasModSources: false,
        hadModPanels: false,
      }) as unknown as LocalModAdapter,
    [context],
  );
  const exit = () => {
    onIntentionalExit?.();
    session.close();
    app.exit();
  };
  const submit = async (text?: string) => {
    if (!text?.trim()) return { submitted: false };
    const capabilities = snapshot.deviceStatus?.device_status;
    const action = routeAttachedCommand(text, {
      supportedCommands: capabilities?.supported_commands,
      modCommands: capabilities?.mod_commands,
      agentId: snapshot.scope.agentId,
      invocableSkills,
    });
    if (action.kind === "error") {
      setNotice(action.message);
      return { submitted: false };
    }
    if (action.kind === "local") {
      if (action.command === "exit") exit();
      else if (action.command === "help") setOverlay("help");
      else if (action.command === "stop") {
        try {
          const stopped = await session.interrupt(false);
          setNotice(
            stopped ? "Stop requested." : "No active turn was stopped.",
          );
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
        }
      } else if (action.command === "status") {
        setNotice(
          `Connection: ${snapshot.connection}; loop: ${snapshot.loopStatus.status}; queued: ${snapshot.queue.length}; approvals: ${snapshot.pendingApprovals.length}.`,
        );
      } else if (action.command === "history") {
        try {
          const response =
            await session.client.request<ConversationMessagesListResponseMessage>(
              {
                type: "conversation_messages_list",
                request_id: session.client.nextRequestId("history"),
                conversation_id: snapshot.scope.conversationId,
                query: {
                  limit: action.args ? Number(action.args) : 20,
                  order: "desc",
                },
              },
              {
                predicate: (
                  frame,
                ): frame is ConversationMessagesListResponseMessage =>
                  frame.type === "conversation_messages_list_response",
              },
            );
          if (!response.success)
            throw new Error(response.error ?? "History unavailable");
          const current = session.getSnapshot();
          if (
            current.generation !== snapshot.generation ||
            current.pendingApprovals.length
          )
            throw new Error(
              "History display cancelled because the conversation or approval state changed.",
            );
          const historyBuffers = createBuffers(current.scope.agentId);
          backfillBuffers(historyBuffers, [...response.messages].reverse());
          const prefix = session.client.nextRequestId("history-display");
          model.staticItems.push(
            ...toLines(historyBuffers).map((line) => ({
              ...line,
              id: `${prefix}-${line.id}`,
            })),
          );
          redraw((value) => value + 1);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
        }
      }
      return { submitted: true };
    }
    if (action.kind === "selector" || action.kind === "server") {
      setOverlay(action);
      return { submitted: true };
    }
    try {
      await session.submit(action.text);
      setNotice("");
      return { submitted: true };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const target = ensureModel(session.getSnapshot());
      target.failures.push({ id: ++target.failureSerial, text });
      redraw((value) => value + 1);
      // The server may already be executing this message. Do not restore a retryable draft.
      if (error instanceof UncertainInputError) return { submitted: true };
      return { submitted: false };
    }
  };
  const answer = (allow: boolean, reason = "") => {
    if (!approval) return;
    if (allow && !full?.complete) {
      setNotice(
        "Cannot approve: the full tool input does not fit in this terminal. Resize the terminal or deny the request.",
      );
      return;
    }
    setApprovalFailed(false);
    void session
      .answerApproval(
        approval.identity,
        allow
          ? { behavior: "allow" }
          : { behavior: "deny", message: reason || "Denied by user" },
      )
      .catch(() => setApprovalFailed(true));
  };
  return (
    <Box flexDirection="column">
      <StaticTranscript
        renderEpoch={snapshot.generation}
        // Ink memoizes new Static items by array identity. The model appends
        // in place, so pass a fresh array when committing completed lines.
        items={[...model.staticItems]}
        columns={columns}
        statusLinePrompt=">"
        showCompactionsEnabled={false}
        precomputedDiffs={diffs}
      />
      {!approval &&
        toLines(model.buffers)
          .filter((line) => !model.committed.has(line.id))
          .map((line) => (
            <Box key={line.id} marginTop={1}>
              <LiveLine line={line} streaming={busy} />
            </Box>
          ))}
      {!approval &&
        model.failures.map((failure) => (
          <Text key={failure.id} color="red">
            {failure.text}
          </Text>
        ))}
      {!approval && snapshot.uncertainOwn?.length ? (
        <Text color="yellow">
          A message has uncertain delivery. Wait for its outcome, or reconnect
          and review conversation history before retrying.
        </Text>
      ) : null}
      {!approval && notice ? <Text color="yellow">{notice}</Text> : null}
      {!approval && snapshot.error ? (
        <Text color="red">{snapshot.error}</Text>
      ) : null}
      {snapshot.connection !== "connected" ? (
        <Text color="red">Connection: {snapshot.connection}</Text>
      ) : null}
      {!approval && shownSubagents.length > 0 && (
        <SubagentGroupStatic agents={shownSubagents} />
      )}
      {!approval &&
        subagents
          .filter((agent) => agent.status === "pending")
          .map((agent) => (
            <Text key={agent.subagent_id} dimColor>
              Pending {agent.subagent_type}: {agent.description}
            </Text>
          ))}
      {!approval && <Text dimColor>Permission: {remoteMode ?? "unknown"}</Text>}
      {!approval &&
        snapshot.queue.map((item) => (
          <Text key={item.id} dimColor wrap="truncate-end">
            Queued{item.paused ? " (paused)" : ""}:{" "}
            {JSON.stringify(item.content).replace(
              /[\u007f-\uffff]/g,
              (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
            )}
          </Text>
        ))}
      {approval && full ? (
        <Box flexDirection="column">
          <Text>Tool approval, complete input:</Text>
          {full.complete ? (
            <Text>{full.lines.join("\n")}</Text>
          ) : (
            <Text color="red">
              Full input cannot fit; approval is disabled. Resize the terminal
              or deny.
            </Text>
          )}
          {approvalFailed ? (
            <Text color="red">
              Approval response failed; the request remains pending.
            </Text>
          ) : null}
          {snapshot.pendingApprovals.length > 1 ? (
            <Text dimColor>
              {snapshot.pendingApprovals.length - 1} more approval(s) waiting
            </Text>
          ) : null}
          <InlineGenericApproval
            key={`${approval.identity.requestId}:${approval.identity.generation}`}
            toolName={approval.frame.request.tool_name}
            toolArgs="{}"
            onApprove={() => answer(true)}
            onApproveAlways={() => answer(true)}
            onDeny={(reason) => answer(false, reason)}
            onCancel={() => answer(false)}
            allowPersistence={false}
            showPreview={false}
            isFocused
          />
        </Box>
      ) : null}
      {!approval && overlay === "help" ? (
        <Box flexDirection="column">
          <HelpDialog
            attachedCommands={remoteCompletions}
            onClose={() => setOverlay(null)}
          />
        </Box>
      ) : null}
      {!approval && overlay && overlay !== "help" ? (
        <AttachedCommandView
          session={session}
          action={overlay}
          onClose={() => setOverlay(null)}
          onNotice={setNotice}
          onFailure={(error) => {
            const target = ensureModel(session.getSnapshot());
            target.failures.push({
              id: ++target.failureSerial,
              text: error instanceof Error ? error.message : String(error),
            });
            redraw((value) => value + 1);
          }}
        />
      ) : null}
      <Input
        streaming={busy}
        tokenCount={0}
        thinkingMessage="Working"
        onSubmit={submit}
        onBashSubmit={async () => {
          setNotice(
            "Direct shell mode is unavailable in this attached terminal.",
          );
        }}
        inputEnabled={
          !approval && !overlay && snapshot.connection === "connected"
        }
        collapseInputWhenDisabled={!!approval || !!overlay}
        permissionMode={remoteMode ?? "unrestricted"}
        remotePermissionMode
        attachedCommands={remoteCompletions}
        onPasteError={setNotice}
        rejectDraft={isPrivateAttachedDraft}
        onRejectedDraft={() =>
          setNotice(
            "Use /secret for masked entry. Memory repository set is unavailable in this visible terminal. Press Esc or Enter to continue.",
          )
        }
        onPermissionModeChange={(mode) => {
          const current = session.getSnapshot();
          if (
            current.generation !== snapshot.generation ||
            current.pendingApprovals.length ||
            current.connection !== "connected" ||
            current.deviceStatus?.device_status.current_permission_mode !==
              remoteMode
          ) {
            setNotice(
              "Permission change cancelled because the session state changed.",
            );
            return;
          }
          if (!remoteMode) {
            setNotice(
              "Permission mode is unknown; wait for server status before changing it.",
            );
            return;
          }
          try {
            session.client.send({
              type: "change_device_state",
              runtime: {
                agent_id: snapshot.scope.agentId,
                conversation_id: snapshot.scope.conversationId,
              },
              payload: { mode },
            });
            setNotice(
              "Permission change requested; waiting for server status.",
            );
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
          }
        }}
        onExit={exit}
        onInterrupt={() => {
          void session
            .interrupt()
            .then((aborted) => {
              if (!aborted)
                setNotice(
                  "No turn from this terminal is running. Use /stop to stop the conversation's current turn.",
                );
            })
            .catch((error) =>
              setNotice(error instanceof Error ? error.message : String(error)),
            );
        }}
        agentId={snapshot.scope.agentId}
        agentName={snapshot.agent?.name}
        currentModel={
          snapshot.agent?.model ?? snapshot.agent?.llm_config?.model
        }
        currentModelProvider={snapshot.agent?.llm_config?.provider_name}
        conversationId={snapshot.scope.conversationId}
        terminalWidth={columns}
        modContext={context}
        modAdapter={inertAdapter}
      />
    </Box>
  );
}
