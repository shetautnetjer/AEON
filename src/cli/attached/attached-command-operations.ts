import {
  attachedControlId,
  hasAttachedControl,
} from "@/types/attached-control-commands";
import type {
  AgentListResponseMessage,
  AgentUpdateResponseMessage,
  ConversationForkResponseMessage,
  ConversationRecompileResponseMessage,
  ConversationUpdateResponseMessage,
  EnableMemfsResponseMessage,
  ListMemoryResponseMessage,
  ListModelsResponseMessage,
  MemoryFileEntry,
  SecretApplyResponse,
  SecretListResponse,
  UpdateModelResponseMessage,
} from "@/types/protocol_v2";
import type { ExecuteCommandResponseMessage } from "@/types/task-control-protocol";
import type { AttachedCommandAction } from "./attached-command-types";
import type { AttachedSession } from "./attached-session";

export interface AttachedChoice {
  key: string;
  label: string;
  description?: string;
}

function ensurePrivateCommandAvailable(
  session: AttachedSession,
  id: string,
): void {
  const status = session.getSnapshot().deviceStatus?.device_status;
  if (!hasAttachedControl(status?.supported_commands, id))
    throw new Error(`/${id} is no longer advertised by the app server.`);
}

export async function memoryFiles(
  session: AttachedSession,
): Promise<{ files: MemoryFileEntry[]; enabled: boolean }> {
  const client = session.client;
  const requestId = client.nextRequestId("memory");
  const files: MemoryFileEntry[] = [];
  const off = client.onMessage((frame) => {
    if (frame.type === "list_memory_response" && frame.request_id === requestId)
      files.push(...frame.entries);
  });
  try {
    const r = await client.request<ListMemoryResponseMessage>(
      {
        type: "list_memory",
        request_id: requestId,
        agent_id: session.getSnapshot().scope.agentId,
      },
      {
        predicate: (m): m is ListMemoryResponseMessage =>
          m.type === "list_memory_response" && m.done,
      },
    );
    if (!r.success) throw new Error(r.error ?? "Could not list memory");
    return { files, enabled: r.memfs_enabled === true };
  } finally {
    off();
  }
}

function requireSuccess<T extends { success: boolean; error?: string }>(
  response: T,
  fallback: string,
): T {
  if (!response.success) throw new Error(response.error ?? fallback);
  return response;
}

async function refreshAfterUpdate(
  session: AttachedSession,
  description: string,
): Promise<void> {
  try {
    await session.refreshAgent();
  } catch (error) {
    throw new Error(
      `${description} succeeded, but the agent view could not refresh: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function attachedAgents(
  session: AttachedSession,
): Promise<AttachedChoice[]> {
  const r = await session.client.request<
    "agent_list",
    AgentListResponseMessage
  >(
    "agent_list",
    {},
    {
      predicate: (m): m is AgentListResponseMessage =>
        m.type === "agent_list_response",
    },
  );
  return requireSuccess(r, "Could not list agents").agents.map((a) => ({
    key: a.id,
    label: a.name ?? a.id,
    description: a.id,
  }));
}

export async function attachedPinnedAgents(
  session: AttachedSession,
): Promise<AttachedChoice[]> {
  ensurePrivateCommandAvailable(session, "pinned");
  const { agentId, conversationId } = session.getSnapshot().scope;
  const r = await session.client.request<
    "execute_command",
    ExecuteCommandResponseMessage
  >(
    "execute_command",
    {
      runtime: { agent_id: agentId, conversation_id: conversationId },
      command_id: attachedControlId("pinned"),
      args: "",
    },
    {
      predicate: (m): m is ExecuteCommandResponseMessage =>
        m.type === "execute_command_response",
    },
  );
  if (!r.success) throw new Error(r.output || "Could not list pinned agents");
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.output);
  } catch {
    throw new Error("Invalid pinned-agent response");
  }
  if (!Array.isArray(parsed)) throw new Error("Invalid pinned-agent response");
  return parsed.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      value.error
    )
      return [];
    return [{ key: value.id, label: value.name, description: value.id }];
  });
}

export async function attachedSkills(
  session: AttachedSession,
): Promise<{ choices: AttachedChoice[]; omitted: number }> {
  ensurePrivateCommandAvailable(session, "skills");
  const { agentId, conversationId } = session.getSnapshot().scope;
  const r = await session.client.request<
    "execute_command",
    ExecuteCommandResponseMessage
  >(
    "execute_command",
    {
      runtime: { agent_id: agentId, conversation_id: conversationId },
      command_id: attachedControlId("skills"),
      args: "",
    },
    {
      predicate: (m): m is ExecuteCommandResponseMessage =>
        m.type === "execute_command_response",
    },
  );
  if (!r.success) throw new Error(r.output || "Could not list skills");
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.output);
  } catch {
    throw new Error("Invalid skill list response");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("skills" in parsed) ||
    !Array.isArray(parsed.skills)
  )
    throw new Error("Invalid skill list response");
  const choices = parsed.skills.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string")
      return [];
    return [
      {
        key: value.id,
        label: value.name,
        description:
          typeof value.description === "string" ? value.description : undefined,
      },
    ];
  });
  return {
    choices,
    omitted:
      "omitted" in parsed && typeof parsed.omitted === "number"
        ? parsed.omitted
        : 0,
  };
}

export async function attachedConversations(
  session: AttachedSession,
  agentId: string,
): Promise<AttachedChoice[]> {
  const r = await session.client.conversationList({
    query: { agent_id: agentId, limit: 100 },
  });
  return requireSuccess(r, "Could not list conversations").conversations.map(
    (c) => ({ key: c.id, label: c.summary || c.id, description: c.id }),
  );
}

export async function attachedModels(
  session: AttachedSession,
): Promise<AttachedChoice[]> {
  const r = await session.client.request<
    "list_models",
    ListModelsResponseMessage
  >(
    "list_models",
    {},
    {
      predicate: (m): m is ListModelsResponseMessage =>
        m.type === "list_models_response",
    },
  );
  return requireSuccess(r, "Could not list models").entries.map((m) => ({
    key: m.id,
    label: m.label,
    description: m.handle,
  }));
}

export async function selectAttachedModel(
  session: AttachedSession,
  modelId: string,
): Promise<void> {
  const { agentId, conversationId } = session.getSnapshot().scope;
  const r = await session.client.request<
    "update_model",
    UpdateModelResponseMessage
  >(
    "update_model",
    {
      runtime: { agent_id: agentId, conversation_id: conversationId },
      payload: { model_id: modelId },
    },
    {
      predicate: (m): m is UpdateModelResponseMessage =>
        m.type === "update_model_response",
    },
  );
  requireSuccess(r, "Could not update model");
  await refreshAfterUpdate(session, "Model update");
}

export async function runAttachedCommand(
  session: AttachedSession,
  action: Extract<AttachedCommandAction, { kind: "server" }>,
): Promise<string> {
  const snapshot = session.getSnapshot();
  const { agentId, conversationId } = snapshot.scope;
  const runtime = { agent_id: agentId, conversation_id: conversationId };
  const client = session.client;
  switch (action.operation) {
    case "new":
      await session.newConversation(action.args || "Terminal");
      return "Started a new conversation.";
    case "enable-memfs": {
      const r = await client.request<
        "enable_memfs",
        EnableMemfsResponseMessage
      >(
        "enable_memfs",
        { agent_id: agentId },
        {
          predicate: (m): m is EnableMemfsResponseMessage =>
            m.type === "enable_memfs_response",
        },
      );
      requireSuccess(r, "Could not enable memory filesystem");
      return "Memory filesystem enabled.";
    }
    case "description": {
      const r = await client.request<
        "agent_update",
        AgentUpdateResponseMessage
      >(
        "agent_update",
        { agent_id: agentId, body: { description: action.args } },
        {
          predicate: (m): m is AgentUpdateResponseMessage =>
            m.type === "agent_update_response",
        },
      );
      requireSuccess(r, "Could not update description");
      await refreshAfterUpdate(session, "Description update");
      return "Agent description updated.";
    }
    case "secret-list": {
      const r = await client.request<"secret_list", SecretListResponse>(
        "secret_list",
        { agent_id: agentId },
        {
          predicate: (m): m is SecretListResponse =>
            m.type === "secret_list_response",
        },
      );
      if (!r.success) throw new Error("Could not list secret names.");
      const names = r.secrets.map((item) => item.key);
      return names.length
        ? `Available secret names:\n${names.map((name) => `  $${name}`).join("\n")}`
        : "No secrets stored.";
    }
    case "secret-unset": {
      const r = await client.request<"secret_apply", SecretApplyResponse>(
        "secret_apply",
        { agent_id: agentId, set: {}, unset: [action.args] },
        {
          predicate: (m): m is SecretApplyResponse =>
            m.type === "secret_apply_response",
        },
      );
      if (!r.success) throw new Error("Could not unset secret.");
      return `Secret $${action.args} removed if present.`;
    }
    case "resume":
      await session.switchConversation(agentId, action.args);
      return "Conversation resumed.";
    case "fork": {
      if (
        snapshot.connection !== "connected" ||
        snapshot.loopStatus.status !== "WAITING_ON_INPUT" ||
        snapshot.queue.length ||
        snapshot.pendingApprovals.length ||
        snapshot.pendingOwn.length ||
        snapshot.activeOwn.length
      ) {
        throw new Error(
          "Finish the current turn, queue, and approvals before forking.",
        );
      }
      const r = await client.request<
        "conversation_fork",
        ConversationForkResponseMessage
      >(
        "conversation_fork",
        { conversation_id: conversationId },
        {
          predicate: (m): m is ConversationForkResponseMessage =>
            m.type === "conversation_fork_response",
        },
      );
      const id = requireSuccess(r, "Could not fork conversation").conversation
        ?.id;
      if (!id) throw new Error("Fork did not return a conversation ID");
      try {
        await session.switchConversation(agentId, id);
      } catch (error) {
        throw new Error(
          `Created fork ${id}, but could not attach: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return "Conversation forked.";
    }
    case "rename-agent": {
      const r = await client.request<
        "agent_update",
        AgentUpdateResponseMessage
      >(
        "agent_update",
        { agent_id: agentId, body: { name: action.args } },
        {
          predicate: (m): m is AgentUpdateResponseMessage =>
            m.type === "agent_update_response",
        },
      );
      requireSuccess(r, "Could not rename agent");
      await refreshAfterUpdate(session, "Agent rename");
      return "Agent renamed.";
    }
    case "rename-conversation": {
      const r = await client.request<
        "conversation_update",
        ConversationUpdateResponseMessage
      >(
        "conversation_update",
        { conversation_id: conversationId, body: { summary: action.args } },
        {
          predicate: (m): m is ConversationUpdateResponseMessage =>
            m.type === "conversation_update_response",
        },
      );
      requireSuccess(r, "Could not rename conversation");
      return "Conversation renamed.";
    }
    case "recompile": {
      const r = await client.request<
        "conversation_recompile",
        ConversationRecompileResponseMessage
      >(
        "conversation_recompile",
        { conversation_id: conversationId },
        {
          predicate: (m): m is ConversationRecompileResponseMessage =>
            m.type === "conversation_recompile_response",
        },
      );
      requireSuccess(r, "Could not recompile conversation");
      return r.result ?? "Conversation recompiled.";
    }
    case "execute":
    case "execute-private":
    case "execute-prompt": {
      if (action.operation !== "execute") {
        if (!action.commandId) throw new Error("Missing command ID.");
        ensurePrivateCommandAvailable(session, action.commandId);
      }
      const r = await client.request<
        "execute_command",
        ExecuteCommandResponseMessage
      >(
        "execute_command",
        {
          runtime,
          command_id:
            action.operation === "execute"
              ? action.commandId
              : attachedControlId(action.commandId ?? ""),
          args: action.args,
        },
        {
          predicate: (m): m is ExecuteCommandResponseMessage =>
            m.type === "execute_command_response",
        },
      );
      if (!r.success) throw new Error(r.output || "Command failed");
      if (action.operation === "execute-prompt") {
        const current = session.getSnapshot();
        if (
          current.generation !== snapshot.generation ||
          current.scope.agentId !== agentId ||
          current.scope.conversationId !== conversationId
        )
          throw new Error(
            "Conversation changed before the command was submitted.",
          );
        if (!r.output)
          throw new Error("The app server returned an empty command prompt.");
        await session.submit(r.output, { displayText: action.input });
        return "";
      }
      return r.output;
    }
  }
}
