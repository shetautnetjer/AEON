import { existsSync, readFileSync } from "node:fs";

export function readSettingsObjectSync(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readStartupBackendSettings(path: string): {
  preferredBackendMode: "api" | "local" | undefined;
  envBaseUrl: string | undefined;
} {
  const raw = readSettingsObjectSync(path);
  const mode = raw.preferredBackendMode;
  const env = raw.env;
  const envBaseUrl =
    env && typeof env === "object" && !Array.isArray(env)
      ? (env as Record<string, unknown>).LETTA_BASE_URL
      : undefined;
  return {
    preferredBackendMode: mode === "api" || mode === "local" ? mode : undefined,
    envBaseUrl: typeof envBaseUrl === "string" ? envBaseUrl : undefined,
  };
}
