import type { CommandHandle } from "@/cli/commands/runner";
import {
  type FinalizeReflectionArenaChoiceOptions,
  finalizeReflectionArenaChoice,
} from "./reflection-arena";

/** Publish the choice outcome without treating retained cleanup as completion. */
export async function completeReflectionArenaChoiceCommand(
  command: Pick<CommandHandle, "fail" | "finish">,
  options: FinalizeReflectionArenaChoiceOptions,
  finalize = finalizeReflectionArenaChoice,
): Promise<void> {
  const result = await finalize(options);
  if (result.cleanupUnconfirmed) command.fail(result.message);
  else command.finish(result.message, true);
}
