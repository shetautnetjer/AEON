import { Box } from "ink";
import { useEffect, useRef, useState } from "react";
import { OverlayShell } from "@/cli/components/OverlayShell";
import { SingleSelectPicker } from "@/cli/components/SingleSelectPicker";
import { Text } from "@/cli/components/Text";
import type { MemoryFileEntry } from "@/types/protocol_v2";
import { AttachedCommandConfiguration } from "./AttachedCommandConfiguration";
import { AttachedCommandRepository } from "./AttachedCommandRepository";
import { AttachedCommandSecrets } from "./AttachedCommandSecrets";
import { AttachedCommandSettings } from "./AttachedCommandSettings";
import {
  AttachedCommandInspection,
  inspectionText,
} from "./attached-command-inspection";
import {
  type AttachedChoice,
  attachedAgents,
  attachedConversations,
  attachedModels,
  attachedPinnedAgents,
  attachedSkills,
  memoryFiles,
  runAttachedCommand,
  selectAttachedModel,
} from "./attached-command-operations";
import type { AttachedCommandAction } from "./attached-command-types";
import type { AttachedSession } from "./attached-session";

export interface AttachedCommandViewProps {
  session: AttachedSession;
  action: Extract<AttachedCommandAction, { kind: "selector" | "server" }>;
  onClose: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown) => void;
}

export function AttachedCommandView({
  session,
  action,
  onClose,
  onNotice,
  onFailure,
}: AttachedCommandViewProps) {
  if (action.kind === "selector" && action.selector === "repository")
    return (
      <AttachedCommandRepository
        session={session}
        onClose={onClose}
        onNotice={onNotice}
        onFailure={onFailure}
      />
    );
  if (action.kind === "selector" && action.selector === "secret")
    return (
      <AttachedCommandSecrets
        session={session}
        initialName={action.args ?? ""}
        onClose={onClose}
        onNotice={onNotice}
        onFailure={onFailure}
      />
    );
  if (
    action.kind === "selector" &&
    (action.selector === "context" ||
      action.selector === "usage" ||
      action.selector === "search" ||
      action.selector === "subagents" ||
      action.selector === "bg" ||
      action.selector === "mcp")
  )
    return (
      <AttachedCommandInspection
        session={session}
        selector={action.selector}
        args={action.args ?? ""}
        onClose={onClose}
        onNotice={onNotice}
      />
    );
  if (
    action.kind === "selector" &&
    (action.selector === "compaction" || action.selector === "sleeptime")
  ) {
    return (
      <AttachedCommandSettings
        session={session}
        selector={action.selector}
        onClose={onClose}
        onNotice={onNotice}
        onFailure={onFailure}
      />
    );
  }
  if (
    action.kind === "selector" &&
    (action.selector === "toolset" ||
      action.selector === "experiments" ||
      action.selector === "system" ||
      action.selector === "personality")
  )
    return (
      <AttachedCommandConfiguration
        session={session}
        selector={action.selector}
        onClose={onClose}
        onNotice={onNotice}
        onFailure={onFailure}
      />
    );
  return (
    <AttachedCommandPicker
      session={session}
      action={action}
      onClose={onClose}
      onNotice={onNotice}
      onFailure={onFailure}
    />
  );
}

function AttachedCommandPicker({
  session,
  action,
  onClose,
  onNotice,
  onFailure,
}: AttachedCommandViewProps) {
  const [choices, setChoices] = useState<AttachedChoice[] | null>(null);
  const [stage, setStage] = useState("initial");
  const [targetAgent, setTargetAgent] = useState(
    session.getSnapshot().scope.agentId,
  );
  const [memory, setMemory] = useState<MemoryFileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [omitted, setOmitted] = useState(0);
  const callbacks = useRef({ onClose, onNotice, onFailure });
  callbacks.current = { onClose, onNotice, onFailure };

  useEffect(() => {
    let live = true;
    const finish = (notice: string) => {
      if (live) {
        if (notice) callbacks.current.onNotice(notice);
        callbacks.current.onClose();
      }
    };
    const load = async () => {
      if (action.kind === "server") {
        finish(await runAttachedCommand(session, action));
        return;
      }
      if (action.selector === "agents") {
        const result = await attachedAgents(session);
        if (live) setChoices(result);
      } else if (action.selector === "pinned") {
        const result = await attachedPinnedAgents(session);
        if (live) setChoices(result);
      } else if (action.selector === "model") {
        const result = await attachedModels(session);
        if (live) setChoices(result);
      } else if (action.selector === "resume") {
        const result = await attachedConversations(
          session,
          session.getSnapshot().scope.agentId,
        );
        if (live) setChoices(result);
      } else if (action.selector === "skills") {
        const result = await attachedSkills(session);
        if (live) {
          setChoices(result.choices);
          setOmitted(result.omitted);
        }
      } else if (action.selector === "memory") {
        const { files } = await memoryFiles(session);
        if (live) {
          setMemory(files);
          setChoices(
            files.map((f) => ({
              key: f.relative_path,
              label: f.relative_path,
              description: f.description ?? undefined,
            })),
          );
        }
      }
    };
    load().catch((error) => {
      if (live) {
        callbacks.current.onFailure(error);
        callbacks.current.onClose();
      }
    });
    return () => {
      live = false;
    };
  }, [session, action]);

  async function select(key: string) {
    if (busy || action.kind !== "selector") return;
    setBusy(true);
    try {
      if (
        (action.selector === "agents" || action.selector === "pinned") &&
        stage === "initial"
      ) {
        setTargetAgent(key);
        const next = await attachedConversations(session, key);
        if (!next.length)
          throw new Error(
            "This agent has no conversation to attach. Create one from an existing client first.",
          );
        setStage("conversation");
        setChoices(next);
        return;
      }
      if (
        action.selector === "agents" ||
        action.selector === "pinned" ||
        action.selector === "resume"
      ) {
        await session.switchConversation(
          action.selector === "agents" || action.selector === "pinned"
            ? targetAgent
            : session.getSnapshot().scope.agentId,
          key,
        );
        onNotice("Conversation attached.");
      } else if (action.selector === "model") {
        await selectAttachedModel(session, key);
        onNotice("Model updated.");
      } else if (action.selector === "memory") {
        const file = memory.find((f) => f.relative_path === key);
        if (file) onNotice(`${file.relative_path}\n${file.content}`);
      } else if (action.selector === "skills") {
        await runAttachedCommand(session, {
          kind: "server",
          operation: "execute-prompt",
          input: "/skills",
          commandId: "skills",
          args: JSON.stringify({ id: key, args: "" }),
        });
      }
      onClose();
    } catch (error) {
      onFailure(error);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (action.kind === "server")
    return <Text dimColor>Running {action.input}…</Text>;
  return (
    <OverlayShell
      command={action.input}
      title={
        stage === "conversation"
          ? "Choose a conversation"
          : `Choose ${action.selector}`
      }
    >
      {omitted > 0 ? (
        <Text dimColor>{omitted} additional skills omitted.</Text>
      ) : null}
      {choices === null ? (
        <Text dimColor>Loading…</Text>
      ) : choices.length === 0 ? (
        <Box>
          <Text>No items available. Press Escape to close.</Text>
          <SingleSelectPicker
            items={[]}
            onSelect={() => {}}
            onCancel={onClose}
          />
        </Box>
      ) : (
        <SingleSelectPicker
          items={choices.map((choice) => ({
            ...choice,
            label: inspectionText(choice.label),
            description: choice.description
              ? inspectionText(choice.description)
              : undefined,
          }))}
          onSelect={select}
          onCancel={onClose}
        />
      )}
    </OverlayShell>
  );
}
