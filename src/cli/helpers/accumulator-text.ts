import { isRecord } from "@/utils/type-guards";

// Flatten common SDK "parts" → text
function getStringProp(obj: Record<string, unknown>, key: string) {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function extractTextPart(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((p) => (isRecord(p) ? (getStringProp(p, "text") ?? "") : ""))
      .join("");
  }
  if (isRecord(v)) {
    return getStringProp(v, "text") ?? getStringProp(v, "delta") ?? "";
  }
  return "";
}
