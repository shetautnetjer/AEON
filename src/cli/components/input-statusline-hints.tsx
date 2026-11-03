import { formatModeLabel } from "@/cli/helpers/format";
import { colors } from "./colors";
import { Text } from "./Text";

export function StatuslineBashModeHint() {
  return (
    <Text>
      <Text color={colors.bash.prompt}>⏵⏵ bash mode</Text>
      <Text color={colors.bash.prompt} dimColor>
        {" "}
        (backspace to exit)
      </Text>
    </Text>
  );
}

export function StatuslineModeHint({
  modeName,
  modeColor,
  modeGlyph,
  showExitHint,
}: {
  modeName: string;
  modeColor: string;
  modeGlyph?: string | null;
  showExitHint: boolean;
}) {
  return (
    <Text>
      <Text color={modeColor}>{formatModeLabel(modeName, modeGlyph)}</Text>
      <Text color={modeColor} dimColor>
        {" "}
        (shift+tab to {showExitHint ? "exit" : "cycle"})
      </Text>
    </Text>
  );
}
export function StatuslineQueuedMessageHint({
  queueMode,
  deferModeSupported,
}: {
  queueMode: "immediate" | "defer";
  deferModeSupported: boolean;
}) {
  return (
    <Text dimColor>
      {deferModeSupported
        ? queueMode === "defer"
          ? "press ↑ to edit queued message · ctrl+d to release queue"
          : "press ↑ to edit queued message · ctrl+d to hold queue until done"
        : "press ↑ to edit queued message"}
    </Text>
  );
}

export function StatuslineQueueModeChangedHint({
  queueMode,
  deferModeSupported,
}: {
  queueMode: "immediate" | "defer";
  deferModeSupported: boolean;
}) {
  if (!deferModeSupported) {
    return null;
  }

  return (
    <Text dimColor>
      {queueMode === "defer"
        ? "queue held until done · ctrl+d to release"
        : "queue sends as soon as possible · ctrl+d to hold"}
    </Text>
  );
}
