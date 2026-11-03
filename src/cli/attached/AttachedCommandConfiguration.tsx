import { useEffect, useRef, useState } from "react";
import { ExperimentSelector } from "@/cli/components/ExperimentSelector";
import { OverlayShell } from "@/cli/components/OverlayShell";
import { PersonalitySelector } from "@/cli/components/PersonalitySelector";
import { SingleSelectPicker } from "@/cli/components/SingleSelectPicker";
import { SystemPromptSelector } from "@/cli/components/SystemPromptSelector";
import { Text } from "@/cli/components/Text";
import type { ExperimentId, ExperimentSnapshot } from "@/experiments/types";
import type { ToolsetPreference } from "@/tools/toolset";
import type {
  GetExperimentsResponseMessage,
  SetExperimentResponseMessage,
  UpdateToolsetResponseMessage,
} from "@/types/protocol_v2";
import { runAttachedCommand } from "./attached-command-operations";
import type { AttachedSession } from "./attached-session";

interface Props {
  session: AttachedSession;
  selector: "toolset" | "experiments" | "system" | "personality";
  onClose: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown) => void;
}

export function AttachedCommandConfiguration({
  session,
  selector,
  onClose,
  onNotice,
  onFailure,
}: Props) {
  const initial = useRef(session.getSnapshot());
  const callbacks = useRef({ onClose, onNotice, onFailure });
  callbacks.current = { onClose, onNotice, onFailure };
  const [experiments, setExperiments] = useState<ExperimentSnapshot[] | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const device = initial.current.deviceStatus?.device_status;
  const { agentId, conversationId } = initial.current.scope;
  const runtime = { agent_id: agentId, conversation_id: conversationId };

  useEffect(() => {
    if (selector !== "experiments") return;
    let live = true;
    session.client
      .request<"get_experiments", GetExperimentsResponseMessage>(
        "get_experiments",
        {},
        {
          predicate: (m): m is GetExperimentsResponseMessage =>
            m.type === "get_experiments_response",
        },
      )
      .then((result) => {
        if (!result.success)
          throw new Error(result.error ?? "Experiments unavailable");
        if (live) setExperiments(result.experiments);
      })
      .catch((error) => {
        if (live) {
          callbacks.current.onFailure(error);
          callbacks.current.onClose();
        }
      });
    return () => {
      live = false;
    };
  }, [selector, session]);

  function ensureCurrent() {
    const current = session.getSnapshot();
    if (
      current.generation !== initial.current.generation ||
      current.scope.agentId !== agentId ||
      current.scope.conversationId !== conversationId
    )
      throw new Error("Conversation changed; reopen settings.");
    if (
      current.loopStatus.status !== "WAITING_ON_INPUT" ||
      current.queue.length ||
      current.pendingApprovals.length
    )
      throw new Error(
        "Finish the current turn, queue, and approvals before changing settings.",
      );
  }

  async function selectToolset(key: string) {
    if (saving) return;
    setSaving(true);
    try {
      ensureCurrent();
      if (!device?.available_toolsets.some((entry) => entry.id === key))
        throw new Error("Toolset is no longer available.");
      const r = await session.client.request<
        "update_toolset",
        UpdateToolsetResponseMessage
      >(
        "update_toolset",
        { runtime, toolset_preference: key as ToolsetPreference },
        {
          predicate: (m): m is UpdateToolsetResponseMessage =>
            m.type === "update_toolset_response",
        },
      );
      if (!r.success) throw new Error(r.error ?? "Could not update toolset");
      onNotice(`Toolset set to ${r.current_toolset_preference ?? key}.`);
      onClose();
    } catch (error) {
      onFailure(error);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function selectPreset(key: string) {
    if (saving) return;
    setSaving(true);
    try {
      ensureCurrent();
      const output = await runAttachedCommand(session, {
        kind: "server",
        operation: "execute-private",
        input: `/${selector}`,
        args: key,
        commandId: selector,
      });
      try {
        await session.refreshAgent();
      } catch (error) {
        throw new Error(
          `Change succeeded, but the agent view could not refresh: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      onNotice(output);
      onClose();
    } catch (error) {
      await session.refreshAgent().catch(() => {});
      onFailure(error);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function saveExperiments(
    changes: Array<{ experimentId: ExperimentId; enabled: boolean }>,
  ) {
    if (saving) return;
    setSaving(true);
    let applied = 0;
    try {
      for (const change of changes) {
        ensureCurrent();
        const r = await session.client.request<
          "set_experiment",
          SetExperimentResponseMessage
        >(
          "set_experiment",
          { experiment_id: change.experimentId, enabled: change.enabled },
          {
            predicate: (m): m is SetExperimentResponseMessage =>
              m.type === "set_experiment_response",
          },
        );
        if (!r.success)
          throw new Error(r.error ?? "Could not update experiment");
        applied++;
      }
      onNotice(
        changes.length
          ? `Updated ${applied} experiment setting(s).`
          : "No experiment settings changed.",
      );
      onClose();
    } catch (error) {
      onFailure(
        new Error(
          `${applied} change(s) applied before failure: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (saving) return <Text dimColor>Saving settings…</Text>;
  if (selector === "system")
    return <SystemPromptSelector onSelect={selectPreset} onCancel={onClose} />;
  if (selector === "personality")
    return <PersonalitySelector onSelect={selectPreset} onCancel={onClose} />;
  if (selector === "experiments")
    return experiments === null ? (
      <Text dimColor>Loading experiments…</Text>
    ) : (
      <ExperimentSelector
        experiments={experiments}
        onConfirm={saveExperiments}
        onCancel={onClose}
      />
    );
  if (!device)
    return (
      <OverlayShell command="/toolset" title="Toolset unavailable">
        <Text>Server has not advertised toolsets.</Text>
        <SingleSelectPicker items={[]} onSelect={() => {}} onCancel={onClose} />
      </OverlayShell>
    );
  return (
    <OverlayShell command="/toolset" title="Choose toolset">
      <SingleSelectPicker
        items={device.available_toolsets.map((entry) => ({
          key: entry.id,
          label: entry.label,
          description: entry.description,
          isCurrent: entry.id === device.current_toolset_preference,
        }))}
        onSelect={selectToolset}
        onCancel={onClose}
      />
    </OverlayShell>
  );
}
