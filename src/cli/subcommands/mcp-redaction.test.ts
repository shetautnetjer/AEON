import { describe, expect, test } from "bun:test";
import { redactArgs, redactUrl } from "./mcp-redaction";

describe("MCP output redaction", () => {
  test("redacts signed-URL style query params and any fragment", () => {
    const out = redactUrl(
      "https://h.test/p?X-Amz-Signature=s1&sig=s2&Code=s3&client_secret=s4&page=2#access_token=s5",
    );
    expect(out).toBe(
      "https://h.test/p?X-Amz-Signature=%5BREDACTED%5D&sig=%5BREDACTED%5D&Code=%5BREDACTED%5D&client_secret=%5BREDACTED%5D&page=2#[REDACTED]",
    );
    expect(redactUrl("https://h.test/p#")).toBe("https://h.test/p#[REDACTED]");
    expect(redactUrl("https://h.test/p?a=1")).toBe("https://h.test/p?a=1");
  });

  test("never returns an unparseable URL raw", () => {
    const bad = "https://user:s1@exa mple.test/p?token=s2";
    expect(redactUrl(bad)).toBe("https://exa/[REDACTED_URL]");
    const hostOnly = "http://bad host/p?token=s3";
    expect(redactUrl(hostOnly)).toBe("http://bad/[REDACTED_URL]");
    expect(redactUrl("not a url ?token=s4")).toBe("[REDACTED_URL]");
    for (const value of [bad, hostOnly]) {
      expect(redactArgs([value]).join("")).not.toMatch(/s\d/);
    }
  });

  test("inspects the value side of --header and --env style flags", () => {
    const args = [
      "--header=Authorization: Bearer s1",
      "--header",
      "X-Api-Key: s2",
      "--env=API_TOKEN=s3",
      "-e",
      "DB_PASSWORD=s4",
      "--header=X-Trace: keep",
      "--env=MODE=keep",
      "--endpoint=https://h.test/?sig=s5#frag-s6",
      "--opt=inner=https://u:s7@h.test/",
    ];
    expect(redactArgs(args)).toEqual([
      "--header=Authorization: [REDACTED]",
      "--header",
      "X-Api-Key: [REDACTED]",
      "--env=API_TOKEN=[REDACTED]",
      "-e",
      "DB_PASSWORD=[REDACTED]",
      "--header=X-Trace: keep",
      "--env=MODE=keep",
      "--endpoint=https://h.test/?sig=%5BREDACTED%5D#[REDACTED]",
      "--opt=inner=https://h.test/",
    ]);
    expect(redactArgs(args).join(" ")).not.toMatch(/s\d/);
  });
});
