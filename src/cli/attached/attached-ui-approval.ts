/** Encode an approval input as visible, unambiguous ASCII before drawing it in Ink. */
export function formatFullApprovalInput(
  input: unknown,
  columns: number,
  terminalRows: number,
): { complete: boolean; lines: string[] } {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    columns < 16
  ) {
    return { complete: false, lines: [] };
  }
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return { complete: false, lines: [] };
  }
  if (!json || json.length > 20_000) return { complete: false, lines: [] };
  const width = Math.floor(columns) - 4; // gutter plus one spare column: no terminal soft-wrap
  const tokens: string[] = [];
  for (let i = 0; i < json.length; i++) {
    const char = json[i] ?? "";
    if (char === "\\") {
      const length = json[i + 1] === "u" ? 6 : 2;
      tokens.push(json.slice(i, i + length));
      i += length - 1;
    } else if (
      char === " " ||
      char.charCodeAt(0) < 0x20 ||
      char.charCodeAt(0) > 0x7e
    ) {
      tokens.push(`\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    } else {
      tokens.push(char);
    }
  }
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (token.length > width) return { complete: false, lines: [] };
    if (line.length + token.length > width) {
      lines.push(line);
      line = "";
    }
    line += token;
  }
  if (line) lines.push(line);
  // Leave room for tool name, approval options, the mounted input, and terminal chrome.
  if (lines.length > Math.max(0, Math.floor(terminalRows) - 12)) {
    return { complete: false, lines: [] };
  }
  return { complete: true, lines };
}
