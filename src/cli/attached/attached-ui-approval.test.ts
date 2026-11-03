import { describe, expect, test } from "bun:test";
import { formatFullApprovalInput } from "./attached-ui-approval";

describe("attached approval display", () => {
  test("shows every field and makes invisible characters and spaces explicit", () => {
    const p = formatFullApprovalInput(
      { command: "echo x\u202e y", nested: { flag: true } },
      50,
      30,
    );
    expect(p.complete).toBe(true);
    const text = p.lines.join("");
    expect(text).toContain("command");
    expect(text).toContain("\\u202e");
    expect(text).toContain("\\u0020");
    expect(text).toContain("nested");
    expect(text).toContain("flag");
    expect(p.lines.every((line) => line.length <= 46)).toBe(true);
  });

  test("refuses approval when the complete input will not fit on screen", () => {
    const p = formatFullApprovalInput({ command: "x".repeat(6000) }, 32, 24);
    expect(p.complete).toBe(false);
    expect(p.lines).toEqual([]);
  });

  test("keeps escaped tokens intact across line boundaries", () => {
    const p = formatFullApprovalInput({ s: "abcdefghij x" }, 16, 24);
    expect(p.complete).toBe(true);
    expect(p.lines.every((line) => !/\\(?:u[0-9a-f]{0,3})?$/i.test(line))).toBe(
      true,
    );
    expect(p.lines.join("")).toContain("\\u0020");
  });
});
