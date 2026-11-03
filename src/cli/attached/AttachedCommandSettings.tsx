import { useEffect, useRef, useState } from "react";
import { CompactionSelector } from "@/cli/components/CompactionSelector";
import { SleeptimeSelector } from "@/cli/components/SleeptimeSelector";
import { Text } from "@/cli/components/Text";
import type { ReflectionSettings } from "@/cli/helpers/memory-reminder";
import { DEFAULT_SUMMARIZATION_MODEL } from "@/constants";
import type {
  AgentRetrieveResponseMessage,
  AgentUpdateResponseMessage,
  GetReflectionSettingsResponseMessage,
  SetReflectionSettingsResponseMessage,
} from "@/types/protocol_v2";
import { memoryFiles } from "./attached-command-operations";
import type { AttachedSession } from "./attached-session";

interface Props {
  session: AttachedSession;
  selector: "compaction" | "sleeptime";
  onClose: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown) => void;
}

export function AttachedCommandSettings({
  session,
  selector,
  onClose,
  onNotice,
  onFailure,
}: Props) {
  const [reflection, setReflection] = useState<ReflectionSettings | null>(null);
  const [memfs, setMemfs] = useState(false);
  const [saving, setSaving] = useState(false);
  const callbacks = useRef({ onClose, onNotice, onFailure });
  callbacks.current = { onClose, onNotice, onFailure };
  const initial = useRef(session.getSnapshot());
  const { agentId, conversationId } = initial.current.scope;
  const runtime = { agent_id: agentId, conversation_id: conversationId };

  useEffect(() => {
    if (selector !== "sleeptime") return;
    let live = true;
    Promise.all([
      session.client.request<
        "get_reflection_settings",
        GetReflectionSettingsResponseMessage
      >(
        "get_reflection_settings",
        { runtime: { agent_id: agentId, conversation_id: conversationId } },
        {
          predicate: (m): m is GetReflectionSettingsResponseMessage =>
            m.type === "get_reflection_settings_response",
        },
      ),
      memoryFiles(session),
    ])
      .then(([r, memory]) => {
        if (!r.success || !r.reflection_settings)
          throw new Error(r.error ?? "Reflection settings unavailable");
        if (live) {
          const s = r.reflection_settings;
          setMemfs(memory.enabled);
          setReflection({
            trigger: s.trigger,
            stepCount: s.step_count,
            merge: s.merge,
            mergeInstructions: s.merge_instructions,
          });
        }
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
  }, [session, selector, agentId, conversationId]);

  async function save(mode: string | ReflectionSettings) {
    if (saving) return;
    setSaving(true);
    try {
      const current = session.getSnapshot();
      if (
        current.scope.agentId !== agentId ||
        current.scope.conversationId !== conversationId ||
        current.generation !== initial.current.generation
      )
        throw new Error("Conversation changed; reopen settings.");
      if (typeof mode === "string") {
        const a = await session.client.request<
          "agent_retrieve",
          AgentRetrieveResponseMessage
        >(
          "agent_retrieve",
          { agent_id: agentId },
          {
            predicate: (m): m is AgentRetrieveResponseMessage =>
              m.type === "agent_retrieve_response",
          },
        );
        if (!a.success || !a.agent)
          throw new Error(a.error ?? "Could not retrieve agent settings");
        const previous = a.agent.compaction_settings;
        const r = await session.client.request<
          "agent_update",
          AgentUpdateResponseMessage
        >(
          "agent_update",
          {
            agent_id: agentId,
            body: {
              compaction_settings: {
                ...previous,
                model: previous?.model?.trim() || DEFAULT_SUMMARIZATION_MODEL,
                mode,
              },
            },
          },
          {
            predicate: (m): m is AgentUpdateResponseMessage =>
              m.type === "agent_update_response",
          },
        );
        if (!r.success)
          throw new Error(r.error ?? "Could not update compaction settings");
        try {
          await session.refreshAgent();
        } catch (error) {
          throw new Error(
            `Compaction settings were updated, but the agent view could not refresh: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        onNotice("Compaction settings updated.");
      } else {
        const settings = {
          trigger: mode.trigger,
          step_count: mode.stepCount,
          merge: mode.merge ?? "auto",
          merge_instructions: mode.mergeInstructions ?? "",
        };
        const r = await session.client.request<
          "set_reflection_settings",
          SetReflectionSettingsResponseMessage
        >(
          "set_reflection_settings",
          { runtime, settings },
          {
            predicate: (m): m is SetReflectionSettingsResponseMessage =>
              m.type === "set_reflection_settings_response",
          },
        );
        if (!r.success)
          throw new Error(r.error ?? "Could not update sleeptime settings");
        onNotice("Sleeptime settings updated.");
      }
      onClose();
    } catch (error) {
      onFailure(error);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (saving) return <Text dimColor>Saving settings…</Text>;
  if (selector === "compaction")
    return (
      <CompactionSelector
        initialMode={initial.current.agent?.compaction_settings?.mode}
        onSave={save}
        onCancel={onClose}
      />
    );
  if (!reflection) return <Text dimColor>Loading sleeptime settings…</Text>;
  return (
    <SleeptimeSelector
      initialSettings={reflection}
      memfsEnabled={memfs}
      onSave={save}
      onCancel={onClose}
    />
  );
}
