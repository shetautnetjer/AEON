import { useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { OverlayShell } from "@/cli/components/OverlayShell";
import { SingleSelectPicker } from "@/cli/components/SingleSelectPicker";
import { Text } from "@/cli/components/Text";
import type { SecretApplyResponse } from "@/types/protocol_v2";
import { runAttachedCommand } from "./attached-command-operations";
import type { AttachedSession } from "./attached-session";

interface Props {
  session: AttachedSession;
  initialName: string;
  onClose: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown) => void;
}
type Stage = "menu" | "set-name" | "unset-name" | "value" | "saving";

/** Secret values never enter the slash input, transcript, or visible component state. */
export function AttachedCommandSecrets({
  session,
  initialName,
  onClose,
  onNotice,
  onFailure,
}: Props) {
  const initial = useRef(session.getSnapshot());
  const secret = useRef("");
  const busy = useRef(false);
  const [name, setName] = useState(initialName);
  const [length, setLength] = useState(0);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>(initialName ? "value" : "menu");
  useEffect(
    () => () => {
      secret.current = "";
    },
    [],
  );

  function sameScope() {
    const current = session.getSnapshot();
    return (
      current.connection === "connected" &&
      current.generation === initial.current.generation &&
      current.scope.agentId === initial.current.scope.agentId &&
      current.scope.conversationId === initial.current.scope.conversationId &&
      !current.pendingApprovals.length
    );
  }

  async function submitSecret() {
    if (busy.current || !secret.current) return;
    if (!sameScope()) {
      setError(
        "Conversation changed or an approval is pending. Reopen /secret.",
      );
      return;
    }
    busy.current = true;
    setStage("saving");
    try {
      const r = await session.client.request<
        "secret_apply",
        SecretApplyResponse
      >(
        "secret_apply",
        {
          agent_id: initial.current.scope.agentId,
          set: { [name]: secret.current },
          unset: [],
        },
        {
          predicate: (m): m is SecretApplyResponse =>
            m.type === "secret_apply_response",
        },
      );
      secret.current = "";
      setLength(0);
      if (!r.success) {
        onFailure(new Error("The app server rejected the secret update."));
        onClose();
        return;
      }
      onNotice(`Secret $${name} set.`);
      onClose();
    } catch {
      secret.current = "";
      setLength(0);
      onFailure(
        new Error(
          "Secret update was not confirmed; its outcome may be unknown. Check before retrying.",
        ),
      );
      onClose();
    } finally {
      busy.current = false;
    }
  }

  async function removeSecret(key: string) {
    if (busy.current) return;
    if (!sameScope()) {
      setError(
        "Conversation changed or an approval is pending. Reopen /secret.",
      );
      return;
    }
    busy.current = true;
    setStage("saving");
    try {
      const notice = await runAttachedCommand(session, {
        kind: "server",
        operation: "secret-unset",
        input: "/secret unset",
        args: key,
      });
      onNotice(notice);
      onClose();
    } catch {
      onFailure(
        new Error(
          "Secret removal was not confirmed; its outcome may be unknown. Check before retrying.",
        ),
      );
      onClose();
    } finally {
      busy.current = false;
    }
  }

  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "c")) {
        secret.current = "";
        setLength(0);
        onClose();
        return;
      }
      if (key.return) {
        if (stage === "value") {
          void submitSecret();
          return;
        }
        const normalized = name.toUpperCase();
        if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) {
          setError(
            "Use a name beginning with a letter or underscore; only letters, numbers, and underscores are allowed.",
          );
          return;
        }
        setName(normalized);
        setError("");
        if (stage === "unset-name") void removeSecret(normalized);
        else setStage("value");
        return;
      }
      if (key.backspace || key.delete) {
        if (stage === "value") {
          secret.current = [...secret.current].slice(0, -1).join("");
          setLength(secret.current.length);
        } else setName((current) => current.slice(0, -1));
        setError("");
        return;
      }
      if (
        !input ||
        key.ctrl ||
        key.meta ||
        key.tab ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow
      )
        return;
      if (stage === "value") {
        if (
          [...input].some(
            (char) =>
              (char.codePointAt(0) ?? 0) < 32 ||
              (char.codePointAt(0) ?? 0) === 127,
          )
        ) {
          setError("Secret values must be a single line.");
          return;
        }
        secret.current += input;
        setLength(secret.current.length);
      } else if (/^[A-Za-z0-9_]+$/.test(input))
        setName((current) => current + input);
      else
        setError(
          "Secret names may contain only letters, numbers, and underscores.",
        );
    },
    {
      isActive:
        stage === "set-name" || stage === "unset-name" || stage === "value",
    },
  );

  async function menu(key: string) {
    if (key === "set") {
      setName("");
      setStage("set-name");
      return;
    }
    if (key === "unset") {
      setName("");
      setStage("unset-name");
      return;
    }
    if (!sameScope()) {
      onNotice(
        "Conversation changed or an approval is pending. Reopen /secret.",
      );
      onClose();
      return;
    }
    setStage("saving");
    try {
      onNotice(
        await runAttachedCommand(session, {
          kind: "server",
          operation: "secret-list",
          input: "/secret list",
          args: "",
        }),
      );
    } catch {
      onFailure(new Error("The app server could not list secret names."));
    }
    onClose();
  }

  return (
    <OverlayShell command="/secret" title="Manage agent secrets">
      {stage === "menu" ? (
        <SingleSelectPicker
          items={[
            { key: "set", label: "Add or update a secret" },
            { key: "list", label: "List secret names" },
            { key: "unset", label: "Remove a secret" },
          ]}
          onSelect={menu}
          onCancel={onClose}
        />
      ) : stage === "saving" ? (
        <Text dimColor>Saving…</Text>
      ) : (
        <>
          <Text>
            {stage === "value"
              ? `Value for $${name}: ${length ? "••••••••" : "(empty)"}`
              : `Secret name: ${name}`}
          </Text>
          {error ? <Text color="red">{error}</Text> : null}
          <Text dimColor>Enter to continue · Esc to cancel</Text>
        </>
      )}
    </OverlayShell>
  );
}
