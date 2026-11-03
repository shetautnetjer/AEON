import { useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { OverlayShell } from "@/cli/components/OverlayShell";
import { SingleSelectPicker } from "@/cli/components/SingleSelectPicker";
import { Text } from "@/cli/components/Text";
import { runAttachedCommand } from "./attached-command-operations";
import type { AttachedSession } from "./attached-session";

interface Props {
  session: AttachedSession;
  onClose: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown) => void;
}

/** Hide input until a URL has been checked for embedded credentials. */
export function AttachedCommandRepository({
  session,
  onClose,
  onNotice,
  onFailure,
}: Props) {
  const initial = useRef(session.getSnapshot());
  const value = useRef("");
  const busy = useRef(false);
  const [hasInput, setHasInput] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"menu" | "url" | "saving">("menu");
  useEffect(
    () => () => {
      value.current = "";
    },
    [],
  );

  async function execute(args: string) {
    if (busy.current) return;
    const current = session.getSnapshot();
    if (
      current.connection !== "connected" ||
      current.generation !== initial.current.generation ||
      current.pendingApprovals.length
    ) {
      setError(
        "Conversation changed or an approval is pending. Reopen this view.",
      );
      return;
    }
    busy.current = true;
    setStage("saving");
    try {
      const output = await runAttachedCommand(session, {
        kind: "server",
        operation: "execute-private",
        input: "/memory-repository",
        commandId: "memory-repository",
        args,
      });
      value.current = "";
      if (output) onNotice(output);
      onClose();
    } catch (failure) {
      value.current = "";
      onFailure(failure);
      onClose();
    } finally {
      busy.current = false;
    }
  }

  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "c")) {
        value.current = "";
        onClose();
        return;
      }
      if (key.return) {
        const url = value.current.trim();
        if (!url || /:\/\/[^/\s]*@|[?#\s]/.test(url)) {
          setError(
            "Use an SSH or HTTPS repository URL without URL credentials, query, fragment, or spaces.",
          );
          return;
        }
        void execute(`set ${url}`);
        return;
      }
      if (key.backspace || key.delete) {
        value.current = [...value.current].slice(0, -1).join("");
        setHasInput(Boolean(value.current));
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
      if (
        [...input].some(
          (char) =>
            (char.codePointAt(0) ?? 0) < 32 ||
            (char.codePointAt(0) ?? 0) === 127,
        )
      ) {
        setError("Enter a single-line URL.");
        return;
      }
      value.current += input;
      setHasInput(true);
    },
    { isActive: stage === "url" },
  );

  return (
    <OverlayShell command="/memory-repository" title="Memory repository">
      {stage === "menu" ? (
        <SingleSelectPicker
          items={[
            { key: "status", label: "Show status" },
            { key: "set", label: "Set URL" },
            { key: "unset", label: "Remove URL" },
            { key: "push", label: "Push now" },
          ]}
          onSelect={(key) => {
            if (key === "set") setStage("url");
            else void execute(key);
          }}
          onCancel={onClose}
        />
      ) : stage === "saving" ? (
        <Text dimColor>Running…</Text>
      ) : (
        <>
          <Text>Repository URL: {hasInput ? "••••••••" : "(empty)"}</Text>
          <Text dimColor>
            Use SSH or HTTPS with a credential helper; embedded credentials are
            refused.
          </Text>
          {error ? <Text color="red">{error}</Text> : null}
          <Text dimColor>Enter to save · Esc to cancel</Text>
        </>
      )}
    </OverlayShell>
  );
}
