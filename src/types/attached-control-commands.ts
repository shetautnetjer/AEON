/** Reserved execute_command IDs for private attached-client controls. */
export const ATTACHED_CONTROL_PREFIX = "attached:";
export const ATTACHED_CONTROL_NAMES = [
  "search",
  "mcp",
  "system",
  "personality",
  "pin",
  "unpin",
  "pinned",
  "hooks",
  "memory-repository",
  "skills",
  "mods",
  "statusline",
  "skill-creator",
] as const;
export function attachedControlId(id: string): string {
  return `${ATTACHED_CONTROL_PREFIX}${id}`;
}

export function attachedControlName(wireId: string): string | null {
  return wireId.startsWith(ATTACHED_CONTROL_PREFIX)
    ? wireId.slice(ATTACHED_CONTROL_PREFIX.length)
    : null;
}

export function hasAttachedControl(
  supported: readonly string[] | undefined,
  id: string,
): boolean {
  return supported?.includes(attachedControlId(id)) ?? false;
}
