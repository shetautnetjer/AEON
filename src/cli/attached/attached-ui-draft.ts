/** Reject commands that could contain credentials before any argument is displayed. */
export function isPrivateAttachedDraft(value: string): boolean {
  return /^\s*\/(?:secret|memory-repository)\s+set(?:\s|$)/i.test(value);
}
