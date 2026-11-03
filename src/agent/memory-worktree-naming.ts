import { randomUUID } from "node:crypto";

export function buildReflectionWorktreeId(now: Date = new Date()): string {
  const timestamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function summarizeReflectionCommitSubject(subject: string): string {
  const summary = subject
    .trim()
    .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, "")
    .trim();
  return summary || "reflection memory updates";
}
