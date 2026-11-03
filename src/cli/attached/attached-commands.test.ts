import { describe, expect, test } from "bun:test";
import { commands } from "@/cli/commands/registry";
import {
  ATTACHED_COMMAND_CLASSIFICATION,
  routeAttachedCommand,
} from "./attached-commands";

describe("attached command router", () => {
  test("classifies every native command explicitly", () => {
    expect(Object.keys(ATTACHED_COMMAND_CLASSIFICATION).sort()).toEqual(
      Object.keys(commands).sort(),
    );
    for (const name of Object.keys(commands))
      expect(routeAttachedCommand(name).kind).not.toBe("message");
  });
  test("keeps ordinary messages and rejects unknown slash commands", () => {
    expect(routeAttachedCommand(" hello ")).toEqual({
      kind: "message",
      text: " hello ",
    });
    expect(routeAttachedCommand("/unknown").kind).toBe("error");
    expect(routeAttachedCommand("/").kind).toBe("error");
  });
  test("does not invoke fake registry placeholders or removed clear", () => {
    for (const name of ["/clear", "/clear-messages"]) {
      expect(
        routeAttachedCommand(name, { supportedCommands: [name.slice(1)] }).kind,
      ).toBe("error");
    }
    expect(
      routeAttachedCommand("/toolset", { supportedCommands: ["toolset"] }),
    ).toMatchObject({ kind: "selector", selector: "toolset" });
    expect(routeAttachedCommand("/clear")).toMatchObject({
      kind: "error",
      message: expect.stringContaining("/new"),
    });
  });
  test("routes only advertised supported commands and mod commands", () => {
    expect(routeAttachedCommand("/compact all").kind).toBe("error");
    expect(
      routeAttachedCommand("/compact all", { supportedCommands: ["compact"] }),
    ).toMatchObject({
      kind: "server",
      operation: "execute",
      commandId: "compact",
      args: "all",
    });
    expect(
      routeAttachedCommand("/my-mod stuff", {
        modCommands: [{ id: "my-mod" }],
      }),
    ).toMatchObject({ kind: "server", commandId: "my-mod", args: "stuff" });
    expect(
      routeAttachedCommand("/set-max-context 5000", {
        supportedCommands: ["context-limit"],
      }),
    ).toMatchObject({ kind: "server", commandId: "context-limit" });
  });
  test("advertised mod collisions take precedence over private controls", () => {
    for (const id of [
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
    ]) {
      expect(
        routeAttachedCommand(`/${id} some args`, {
          supportedCommands: [id],
          modCommands: [{ id }],
        }),
      ).toMatchObject({
        kind: "server",
        operation: "execute",
        commandId: id,
        args: "some args",
      });
    }
    expect(
      routeAttachedCommand(
        "/memory-repository set https://token@example.test/repo",
        { modCommands: [{ id: "memory-repository" }] },
      ).kind,
    ).toBe("error");
    expect(
      routeAttachedCommand("/system", { supportedCommands: ["system"] }).kind,
    ).toBe("error");
    expect(
      routeAttachedCommand("/profiles", {
        supportedCommands: ["attached:pinned"],
        modCommands: [{ id: "pinned" }],
      }),
    ).toMatchObject({ kind: "selector", selector: "pinned" });
  });
  test("validates arguments and exposes real selector or scope operations", () => {
    expect(routeAttachedCommand("/model extra").kind).toBe("error");
    expect(routeAttachedCommand("/rename convo hello there")).toMatchObject({
      kind: "server",
      operation: "rename-conversation",
      args: "hello there",
    });
    expect(routeAttachedCommand("/rename agent").kind).toBe("error");
    expect(routeAttachedCommand("/resume a b").kind).toBe("error");
    expect(routeAttachedCommand("/agents")).toMatchObject({
      kind: "selector",
      selector: "agents",
    });
    expect(routeAttachedCommand("/resume conv-1")).toMatchObject({
      kind: "server",
      operation: "resume",
      args: "conv-1",
    });
  });

  test("retains terminal chat shortcuts without forwarding slash text", () => {
    expect(routeAttachedCommand("/quit")).toMatchObject({
      kind: "local",
      command: "exit",
    });
    expect(routeAttachedCommand("/threads")).toMatchObject({
      kind: "selector",
      selector: "resume",
    });
    expect(routeAttachedCommand("/switch conv-b")).toMatchObject({
      kind: "server",
      operation: "resume",
      args: "conv-b",
    });
    expect(routeAttachedCommand("/switch 2").kind).toBe("error");
    expect(routeAttachedCommand("/history 12")).toMatchObject({
      kind: "local",
      command: "history",
      args: "12",
    });
    expect(routeAttachedCommand("/history 99").kind).toBe("error");
    expect(routeAttachedCommand("/status")).toMatchObject({
      kind: "local",
      command: "status",
    });
    expect(routeAttachedCommand("/stop")).toMatchObject({
      kind: "local",
      command: "stop",
    });
    expect(routeAttachedCommand("/new My title")).toMatchObject({
      kind: "server",
      operation: "new",
      args: "My title",
    });
  });

  test("exposes supported settings and keeps unavailable memory actions explicit", () => {
    for (const selector of ["sleeptime", "compaction"]) {
      expect(routeAttachedCommand(`/${selector}`)).toMatchObject({
        kind: "selector",
        selector,
      });
    }
    expect(
      routeAttachedCommand("/skills", {
        supportedCommands: ["attached:skills"],
      }),
    ).toMatchObject({ kind: "selector", selector: "skills" });
    expect(routeAttachedCommand("/memfs enable")).toMatchObject({
      kind: "server",
      operation: "enable-memfs",
    });
    expect(routeAttachedCommand("/memfs reset")).toMatchObject({
      kind: "error",
    });
    expect(routeAttachedCommand("/secret list")).toMatchObject({
      kind: "server",
      operation: "secret-list",
    });
    expect(routeAttachedCommand("/secret")).toMatchObject({
      kind: "selector",
      selector: "secret",
    });
    expect(routeAttachedCommand("/secret set my_key")).toMatchObject({
      kind: "selector",
      selector: "secret",
      args: "MY_KEY",
    });
    expect(routeAttachedCommand("/secret unset my_key")).toMatchObject({
      kind: "server",
      operation: "secret-unset",
      args: "MY_KEY",
    });
    expect(routeAttachedCommand("/secret set KEY value")).toMatchObject({
      kind: "error",
    });
    expect(routeAttachedCommand("/mods generate-env test").kind).toBe("error");
    expect(
      routeAttachedCommand("/mods generate-env test", {
        supportedCommands: ["attached:mods"],
      }),
    ).toMatchObject({
      kind: "server",
      operation: "execute-prompt",
      commandId: "mods",
    });
    expect(
      routeAttachedCommand("/my-skill do it", {
        invocableSkills: [{ id: "my-skill" }],
        supportedCommands: ["attached:skills"],
      }),
    ).toMatchObject({
      kind: "server",
      operation: "execute-prompt",
      commandId: "skills",
      args: JSON.stringify({ id: "my-skill", args: "do it" }),
    });
    expect(routeAttachedCommand("/system").kind).toBe("error");
    expect(
      routeAttachedCommand("/system", {
        supportedCommands: ["attached:system"],
      }),
    ).toMatchObject({ kind: "selector", selector: "system" });
    expect(
      routeAttachedCommand("/pin Name", {
        supportedCommands: ["attached:pin"],
      }),
    ).toMatchObject({
      kind: "server",
      operation: "execute-private",
      commandId: "pin",
      args: "Name",
    });
    expect(
      routeAttachedCommand("/hooks disable", {
        supportedCommands: ["attached:hooks"],
      }),
    ).toMatchObject({ kind: "server", commandId: "hooks", args: "disable" });
  });
});
