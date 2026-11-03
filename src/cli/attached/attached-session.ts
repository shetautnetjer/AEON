import { randomUUID } from "node:crypto";
import type { AgentState } from "@letta-ai/letta-client/resources/agents/agents";
import {
  AppServerClient,
  type AppServerClientOptions,
} from "@/app-server-client";
import type { ApprovalResponseDecision } from "@/types/input-command";
import type { LoopState } from "@/types/loop-status-protocol";
import type {
  AgentRetrieveResponseMessage,
  ControlRequest,
  ConversationMessagesListResponseMessage,
  ConversationRetrieveResponseMessage,
  DeviceStatusUpdateMessage,
  QueueMessage,
  SubagentSnapshot,
  TurnFinishedMessage,
  WsProtocolMessage,
} from "@/types/protocol_v2";
import type { AgentRuntimeScope } from "@/types/runtime-scope";

export interface ApprovalIdentity {
  requestId: string;
  generation: number;
}

export interface AttachedApproval {
  identity: ApprovalIdentity;
  frame: ControlRequest;
}

export interface AttachedSnapshot {
  scope: { agentId: string; conversationId: string };
  agent: AgentState | null;
  generation: number;
  history: ConversationMessagesListResponseMessage["messages"];
  loopStatus: LoopState;
  deviceStatus: DeviceStatusUpdateMessage | null;
  subagents: SubagentSnapshot[] | null;
  lastUsage: TurnFinishedMessage["usage"] | null;
  queue: QueueMessage[];
  pendingApprovals: AttachedApproval[];
  pendingOwn: string[];
  uncertainOwn: string[];
  inputDisplayById: Record<string, string>;
  activeOwn: string[];
  connection: "connecting" | "connected" | "disconnected" | "closed";
  error?: string;
}

export interface AttachedSessionOptions extends AppServerClientOptions {
  agentId: string;
  conversationId?: string;
  title?: string;
  cwd?: string;
  clientFactory?: (options: AppServerClientOptions) => AppServerClient;
  newId?: () => string;
}

type FrameHandler = (frame: WsProtocolMessage) => void;
type SnapshotHandler = () => void;
type Candidate = {
  client: AppServerClient;
  runtime: AgentRuntimeScope;
  agent: AgentState | null;
  history: ConversationMessagesListResponseMessage["messages"];
  loopStatus: LoopState;
  deviceStatus: DeviceStatusUpdateMessage | null;
  subagents: SubagentSnapshot[] | null;
  lastUsage: TurnFinishedMessage["usage"] | null;
  queue: QueueMessage[];
  approvals: AttachedApproval[];
  pending: Set<string>;
  uncertain: Set<string>;
  inputDisplays: Map<string, string>;
  active: Set<string>;
  runs: Map<string, string[]>;
  finishedRuns: Set<string>;
  acknowledged: Set<string>;
  buffered: WsProtocolMessage[];
  unseen: WsProtocolMessage[];
  droppedUnseen: number;
  ready: boolean;
  connected: boolean;
};

function idle(candidate: Candidate): boolean {
  return (
    candidate.connected &&
    candidate.loopStatus.status === "WAITING_ON_INPUT" &&
    candidate.pending.size === 0 &&
    candidate.active.size === 0 &&
    candidate.queue.length === 0 &&
    candidate.approvals.length === 0
  );
}

function scoped(frame: WsProtocolMessage, runtime: AgentRuntimeScope): boolean {
  if ("runtime" in frame && frame.runtime) {
    return (
      frame.runtime.agent_id === runtime.agent_id &&
      frame.runtime.conversation_id === runtime.conversation_id
    );
  }
  if (frame.type === "control_request") {
    return (
      (!frame.agent_id || frame.agent_id === runtime.agent_id) &&
      (!frame.conversation_id ||
        frame.conversation_id === runtime.conversation_id)
    );
  }
  return true;
}

export class UncertainInputError extends Error {
  constructor(
    readonly inputId: string,
    readonly stillPending: boolean,
    cause: unknown,
  ) {
    super(
      stillPending
        ? `Message delivery is uncertain; check the conversation before retrying (${message(cause)}).`
        : `Input acknowledgement was lost, but a terminal outcome was observed; check the conversation (${message(cause)}).`,
    );
    this.name = "UncertainInputError";
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export class AttachedSession {
  private current!: Candidate;
  private snapshot!: AttachedSnapshot;
  private readonly listeners = new Set<SnapshotHandler>();
  private readonly frames = new Set<FrameHandler>();
  private readonly replayListeners = new Set<FrameHandler>();
  private readonly options: AttachedSessionOptions;
  private generation = 0;
  private scopeGeneration = 1;
  private switching = false;
  private closed = false;
  private approvalInFlight = false;
  private openingCandidate?: Candidate;
  private cancelOpening?: () => void;
  private error?: string;

  private constructor(options: AttachedSessionOptions) {
    this.options = options;
  }

  static async connect(
    options: AttachedSessionOptions,
  ): Promise<AttachedSession> {
    const session = new AttachedSession(options);
    session.current = await session.open(
      options.agentId,
      options.conversationId,
      options.title,
    );
    if (session.current.droppedUnseen)
      session.error =
        "Some early stream events were dropped before the terminal attached";
    session.publish();
    return session;
  }

  get client(): AppServerClient {
    return this.current.client;
  }
  getSnapshot = (): AttachedSnapshot => this.snapshot;
  subscribe = (listener: SnapshotHandler): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  onFrame = (
    listener: FrameHandler,
    options: { replayPending?: boolean } = {},
  ): (() => void) => {
    this.frames.add(listener);
    if (options.replayPending !== false) {
      this.replayListeners.add(listener);
      for (const frame of this.current.unseen.splice(0)) listener(frame);
    }
    return () => {
      this.frames.delete(listener);
      this.replayListeners.delete(listener);
    };
  };

  private publish(): void {
    const c = this.current;
    if (!c) return;
    this.snapshot = freezeSnapshot({
      scope: {
        agentId: c.runtime.agent_id,
        conversationId: c.runtime.conversation_id,
      },
      agent: c.agent ? structuredClone(c.agent) : null,
      generation: this.scopeGeneration,
      history: structuredClone(c.history),
      loopStatus: structuredClone(c.loopStatus),
      queue: structuredClone(c.queue),
      deviceStatus: c.deviceStatus ? structuredClone(c.deviceStatus) : null,
      subagents: c.subagents ? structuredClone(c.subagents) : null,
      lastUsage: c.lastUsage ? structuredClone(c.lastUsage) : null,
      pendingApprovals: structuredClone(c.approvals),
      pendingOwn: [...c.pending],
      uncertainOwn: [...c.uncertain],
      inputDisplayById: Object.fromEntries(c.inputDisplays),
      activeOwn: [...c.active],
      connection: this.closed
        ? "closed"
        : c.connected
          ? "connected"
          : "disconnected",
      ...(this.error ? { error: this.error } : {}),
    });
    for (const listener of this.listeners) listener();
  }

  private createCandidate(agentId: string, conversationId: string): Candidate {
    const { url, authToken, WebSocket, requestTimeoutMs, clientFactory } =
      this.options;
    const options = { url, authToken, WebSocket, requestTimeoutMs };
    const client = clientFactory
      ? clientFactory(options)
      : new AppServerClient(options);
    const candidate: Candidate = {
      client,
      runtime: { agent_id: agentId, conversation_id: conversationId },
      agent: null,
      history: [],
      loopStatus: {
        status: "WAITING_ON_INPUT",
        active_run_ids: [],
        executing_tool_call_ids: [],
      },
      deviceStatus: null,
      subagents: null,
      lastUsage: null,
      queue: [],
      approvals: [],
      pending: new Set(),
      uncertain: new Set(),
      inputDisplays: new Map(),
      active: new Set(),
      runs: new Map(),
      finishedRuns: new Set(),
      acknowledged: new Set(),
      buffered: [],
      unseen: [],
      droppedUnseen: 0,
      ready: Boolean(conversationId),
      connected: true,
    };
    client.onMessage((frame) => {
      if (!candidate.ready) {
        candidate.buffered.push(frame);
        return;
      }
      this.handleFrame(candidate, frame);
    });
    client.onDisconnect(() => {
      candidate.connected = false;
      if (candidate === this.current && !this.closed) {
        this.error = "Connection to the app server closed";
        this.publish();
      }
    });
    return candidate;
  }

  private async open(
    agentId: string,
    conversationId?: string,
    title?: string,
  ): Promise<Candidate> {
    const candidate = this.createCandidate(agentId, conversationId ?? "");
    this.openingCandidate = candidate;
    try {
      await this.connectCandidate(candidate);
      if (conversationId) {
        const result =
          await candidate.client.request<ConversationRetrieveResponseMessage>(
            {
              type: "conversation_retrieve",
              request_id: candidate.client.nextRequestId("retrieve"),
              conversation_id: conversationId,
            },
            {
              predicate: (
                frame,
              ): frame is ConversationRetrieveResponseMessage =>
                frame.type === "conversation_retrieve_response",
            },
          );
        if (
          !result.success ||
          result.conversation?.id !== conversationId ||
          result.conversation.agent_id !== agentId
        ) {
          throw new Error(
            result.error ?? "Conversation does not belong to this agent",
          );
        }
      } else {
        const result = await candidate.client.runtimeStart({
          agent_id: agentId,
          create_conversation: { body: { summary: title || "Terminal" } },
          conversation_source_tags: ["terminal"],
          recover_approvals: false,
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        });
        if (
          !result.success ||
          !result.runtime ||
          result.runtime.agent_id !== agentId ||
          !result.runtime.conversation_id
        ) {
          throw new Error(
            result.error ?? "Could not create a conversation for this agent",
          );
        }
        candidate.runtime = {
          agent_id: agentId,
          conversation_id: result.runtime.conversation_id,
        };
        if (result.agent && result.agent.id !== agentId)
          throw new Error("Created conversation returned a different agent");
        candidate.agent = result.agent;
        candidate.ready = true;
        for (const frame of candidate.buffered.splice(0))
          this.handleFrame(candidate, frame);
      }
      if (!candidate.agent) {
        const agent =
          await candidate.client.request<AgentRetrieveResponseMessage>(
            {
              type: "agent_retrieve",
              request_id: candidate.client.nextRequestId("agent"),
              agent_id: agentId,
            },
            {
              predicate: (frame): frame is AgentRetrieveResponseMessage =>
                frame.type === "agent_retrieve_response",
            },
          );
        if (!agent.success || agent.agent?.id !== agentId)
          throw new Error(agent.error ?? "Agent lookup failed");
        candidate.agent = agent.agent;
      }
      const sync = await candidate.client.sync({
        runtime: candidate.runtime,
        recover_approvals: false,
        resume_interrupted_turn: false,
        force_device_status: true,
      });
      if (
        !sync.success ||
        sync.runtime.agent_id !== agentId ||
        sync.runtime.conversation_id !== candidate.runtime.conversation_id
      ) {
        throw new Error(sync.error ?? "Conversation sync failed");
      }
      const history =
        await candidate.client.request<ConversationMessagesListResponseMessage>(
          {
            type: "conversation_messages_list",
            request_id: candidate.client.nextRequestId("history"),
            conversation_id: candidate.runtime.conversation_id,
            query: { limit: 40, order: "desc" },
          },
          {
            predicate: (
              frame,
            ): frame is ConversationMessagesListResponseMessage =>
              frame.type === "conversation_messages_list_response",
          },
        );
      if (!history.success)
        throw new Error(history.error ?? "Conversation history unavailable");
      candidate.history = [...history.messages].reverse();
      if (!candidate.connected)
        throw new Error("Conversation disconnected during attach");
      return candidate;
    } catch (error) {
      candidate.client.close();
      throw error;
    } finally {
      if (this.openingCandidate === candidate)
        this.openingCandidate = undefined;
    }
  }

  private connectCandidate(candidate: Candidate): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        this.cancelOpening = undefined;
        if (error) reject(error);
        else resolve();
      };
      const detach = candidate.client.onDisconnect(() =>
        finish(new Error("App-server socket closed during connection")),
      );
      const timer = setTimeout(
        () => finish(new Error("App-server connection timed out")),
        this.options.requestTimeoutMs ?? 20_000,
      );
      this.cancelOpening = () =>
        finish(new Error("Session closed during connection"));
      void candidate.client.connect().then(
        () => finish(),
        (error: unknown) => finish(new Error(message(error))),
      );
    });
  }

  private handleFrame(c: Candidate, frame: WsProtocolMessage): void {
    if (!scoped(frame, c.runtime)) return;
    let changed = false;
    if (
      frame.type === "stream_delta" ||
      frame.type === "turn_finished" ||
      frame.type === "update_subagent_state"
    ) {
      if (c !== this.current || this.replayListeners.size === 0) {
        c.unseen.push(frame);
        if (c.unseen.length > 2000) {
          c.unseen.shift();
          c.droppedUnseen++;
        }
      }
    }
    if (
      frame.type === "stream_delta" &&
      frame.delta.message_type === "loop_error" &&
      frame.delta.is_terminal
    ) {
      for (const id of frame.delta.client_message_ids ?? []) {
        if (!c.pending.has(id)) continue;
        c.pending.delete(id);
        c.uncertain.delete(id);
        c.active.delete(id);
        // Keep exact ownership so a later durable terminal can still be ACKed.
        c.acknowledged.add(id);
        if (c.acknowledged.size > 512) {
          const oldest = c.acknowledged.values().next().value;
          if (oldest !== undefined) c.acknowledged.delete(oldest);
        }
        changed = true;
      }
    }
    if (frame.type === "update_device_status") {
      c.deviceStatus = frame;
      changed = true;
    } else if (frame.type === "update_subagent_state") {
      c.subagents = frame.subagents;
      changed = true;
    } else if (frame.type === "control_request") {
      if (
        !c.approvals.some(
          (entry) => entry.frame.request_id === frame.request_id,
        )
      ) {
        c.approvals.push({
          identity: {
            requestId: frame.request_id,
            generation: ++this.generation,
          },
          frame,
        });
        changed = true;
      }
    } else if (frame.type === "update_loop_status") {
      changed = true;
      c.loopStatus = frame.loop_status;
      for (const [run, ids] of Object.entries(
        frame.loop_status.client_message_ids_by_run_id ?? {},
      )) {
        c.runs.set(run, ids);
        if (c.runs.size > 512) {
          const oldest = c.runs.keys().next().value;
          if (oldest !== undefined) c.runs.delete(oldest);
        }
        if (c.finishedRuns.delete(run))
          for (const id of ids) {
            c.pending.delete(id);
            c.uncertain.delete(id);
            c.active.delete(id);
          }
      }
      c.active = new Set(
        frame.loop_status.active_run_ids
          .flatMap((run) => c.runs.get(run) ?? [])
          .filter((id) => c.pending.has(id)),
      );
    } else if (frame.type === "update_queue") {
      changed = true;
      c.queue = frame.queue;
      for (const removed of frame.removed ?? [])
        if (removed.disposition === "cancelled") {
          c.pending.delete(removed.client_message_id);
          c.uncertain.delete(removed.client_message_id);
          c.active.delete(removed.client_message_id);
        }
    } else if (frame.type === "turn_finished") {
      changed = true;
      if (frame.usage) c.lastUsage = frame.usage;
      for (const id of new Set(frame.terminal_consumer_ids ?? [])) {
        if (!c.pending.has(id) && !c.acknowledged.has(id)) continue;
        c.pending.delete(id);
        c.uncertain.delete(id);
        c.active.delete(id);
        c.acknowledged.add(id);
        if (c.acknowledged.size > 512) {
          const oldest = c.acknowledged.values().next().value;
          if (oldest !== undefined) c.acknowledged.delete(oldest);
        }
        if (frame.idempotency_key) {
          try {
            c.client.send({
              type: "turn_finished_ack",
              runtime: frame.runtime,
              idempotency_key: frame.idempotency_key,
              consumer_id: id,
            });
          } catch (error) {
            if (c === this.current)
              this.error = `Could not acknowledge turn: ${message(error)}`;
          }
        }
      }
      if (frame.run_id) {
        for (const id of c.runs.get(frame.run_id) ?? []) {
          c.pending.delete(id);
          c.uncertain.delete(id);
          c.active.delete(id);
        }
        c.runs.delete(frame.run_id);
        c.finishedRuns.add(frame.run_id);
        if (c.finishedRuns.size > 512) {
          const oldest = c.finishedRuns.values().next().value;
          if (oldest !== undefined) c.finishedRuns.delete(oldest);
        }
      }
    }
    if (c === this.current && !this.closed) {
      if (changed) this.publish();
      for (const listener of this.frames) listener(frame);
    }
  }

  async submit(
    text: string,
    options?: { displayText?: string },
  ): Promise<string> {
    if (this.closed || this.switching || !this.current.connected)
      throw new Error("Session is not connected");
    const c = this.current;
    if (c.approvals.length)
      throw new Error("Answer the pending approval before sending a message");
    if (c.uncertain.size)
      throw new Error(
        "A previous message has uncertain delivery; check the conversation and wait for its outcome before sending again.",
      );
    const id = `cm-terminal-${(this.options.newId ?? randomUUID)()}`;
    c.pending.add(id);
    if (options?.displayText !== undefined) {
      c.inputDisplays.set(id, options.displayText);
      if (c.inputDisplays.size > 512) {
        const oldest = c.inputDisplays.keys().next().value;
        if (oldest !== undefined) c.inputDisplays.delete(oldest);
      }
    }
    this.publish();
    try {
      let result: Awaited<ReturnType<AppServerClient["submitInput"]>>;
      try {
        result = await c.client.submitInput({
          runtime: c.runtime,
          terminal_consumer_id: id,
          payload: {
            kind: "create_message",
            messages: [
              {
                role: "user",
                content: [{ type: "text", text }],
                client_message_id: id,
              },
            ],
          },
        });
      } catch (error) {
        const stillPending = c.pending.has(id);
        if (stillPending) c.uncertain.add(id);
        throw new UncertainInputError(id, stillPending, error);
      }
      if (
        !result.runtime ||
        result.runtime.agent_id !== c.runtime.agent_id ||
        result.runtime.conversation_id !== c.runtime.conversation_id
      ) {
        const stillPending = c.pending.has(id);
        if (stillPending) c.uncertain.add(id);
        throw new UncertainInputError(
          id,
          stillPending,
          "acknowledgement belongs to a different conversation",
        );
      }
      if (!result.accepted) {
        c.pending.delete(id);
        c.uncertain.delete(id);
        c.active.delete(id);
        throw new Error(result.error ?? "Message was not accepted");
      }
      if (result.disposition === "started" && c.pending.has(id))
        c.active.add(id);
      return id;
    } finally {
      if (c === this.current) this.publish();
    }
  }

  async answerApproval(
    identity: ApprovalIdentity,
    decision: ApprovalResponseDecision,
  ): Promise<void> {
    if (
      this.closed ||
      this.switching ||
      !this.current.connected ||
      this.approvalInFlight
    )
      throw new Error("Approval cannot be answered now");
    const c = this.current;
    const approval = c.approvals[0];
    if (
      !approval ||
      approval.identity.requestId !== identity.requestId ||
      approval.identity.generation !== identity.generation
    ) {
      throw new Error("Approval is stale; review the current request");
    }
    this.approvalInFlight = true;
    try {
      const result = await c.client.submitInput({
        runtime: c.runtime,
        payload: {
          kind: "approval_response",
          request_id: identity.requestId,
          decision,
        },
      });
      if (
        result.runtime.agent_id !== c.runtime.agent_id ||
        result.runtime.conversation_id !== c.runtime.conversation_id
      ) {
        throw new Error(
          "Approval acknowledgement belongs to a different conversation",
        );
      }
      if (
        !result.accepted &&
        result.error !== "Approval request is no longer pending"
      ) {
        if (c.approvals[0] === approval)
          c.approvals[0] = {
            ...approval,
            identity: {
              requestId: identity.requestId,
              generation: ++this.generation,
            },
          };
        throw new Error(result.error ?? "Approval response was not accepted");
      }
      if (c.approvals[0] === approval) c.approvals.shift();
      if (!result.accepted) throw new Error(result.error);
    } catch (error) {
      if (
        c.approvals[0] === approval &&
        approval.identity.generation === identity.generation
      ) {
        c.approvals[0] = {
          ...approval,
          identity: {
            requestId: identity.requestId,
            generation: ++this.generation,
          },
        };
      }
      throw error;
    } finally {
      this.approvalInFlight = false;
      if (c === this.current) this.publish();
    }
  }

  async interrupt(onlyOwn = true): Promise<boolean> {
    const c = this.current;
    if (this.closed || this.switching || !c.connected)
      throw new Error("Session is not connected");
    const runId = c.loopStatus.active_run_ids.find((run) =>
      (c.runs.get(run) ?? []).some((id) => c.pending.has(id)),
    );
    if (onlyOwn && !runId) return false;
    const approvalsAtRequest = new Set(c.approvals);
    const result = await c.client.abort({
      runtime: c.runtime,
      ...(onlyOwn ? { run_id: runId } : {}),
    });
    if (!result.success)
      throw new Error(result.error ?? "Could not interrupt the turn");
    if (
      result.runtime.agent_id !== c.runtime.agent_id ||
      result.runtime.conversation_id !== c.runtime.conversation_id
    ) {
      throw new Error(
        "Interrupt acknowledgement belongs to a different conversation",
      );
    }
    if (result.aborted && c === this.current) {
      c.approvals = c.approvals.filter(
        (approval) => !approvalsAtRequest.has(approval),
      );
      this.publish();
    }
    return result.aborted;
  }

  async switchConversation(
    agentId: string,
    conversationId: string,
  ): Promise<void> {
    await this.switchTo(agentId, conversationId);
  }
  async newConversation(title?: string): Promise<void> {
    await this.switchTo(this.current.runtime.agent_id, undefined, title);
  }
  async refreshAgent(): Promise<void> {
    const current = this.current;
    const generation = this.scopeGeneration;
    try {
      const result = await current.client.request<AgentRetrieveResponseMessage>(
        {
          type: "agent_retrieve",
          request_id: current.client.nextRequestId("agent-refresh"),
          agent_id: current.runtime.agent_id,
        },
        {
          predicate: (frame): frame is AgentRetrieveResponseMessage =>
            frame.type === "agent_retrieve_response",
        },
      );
      if (
        this.closed ||
        this.current !== current ||
        this.scopeGeneration !== generation
      )
        return;
      if (!result.success || result.agent?.id !== current.runtime.agent_id)
        throw new Error(result.error ?? "Agent lookup failed");
      current.agent = result.agent;
      this.publish();
    } catch (error) {
      if (
        this.closed ||
        this.current !== current ||
        this.scopeGeneration !== generation
      )
        return;
      throw error;
    }
  }
  private async switchTo(
    agentId: string,
    conversationId?: string,
    title?: string,
  ): Promise<void> {
    const old = this.current;
    if (this.closed || this.switching || !idle(old) || this.approvalInFlight)
      throw new Error(
        "Finish the current turn, queue, and approvals before switching",
      );
    this.switching = true;
    let next: Candidate | undefined;
    try {
      next = await this.open(agentId, conversationId, title);
      if (this.closed || !next.connected || !idle(old))
        throw new Error(
          "Current conversation became busy or disconnected; switch cancelled",
        );
      this.current = next;
      this.scopeGeneration++;
      this.error = next.droppedUnseen
        ? "Some early stream events were dropped before the terminal attached"
        : undefined;
      this.publish();
      const replay = this.replayListeners.size
        ? next.unseen.splice(0)
        : next.unseen;
      for (const frame of replay)
        for (const listener of this.frames) listener(frame);
      old.client.close();
    } catch (error) {
      next?.client.close();
      throw error;
    } finally {
      this.switching = false;
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelOpening?.();
    this.openingCandidate?.client.close();
    this.current.client.close();
    this.publish();
  }
}
