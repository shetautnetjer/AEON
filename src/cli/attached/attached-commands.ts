import { isLocalAgentId } from "@/agent/agent-id";
import { commands } from "@/cli/commands/registry";
import {
  ATTACHED_CONTROL_NAMES,
  hasAttachedControl,
} from "@/types/attached-control-commands";

export { AttachedCommandView } from "./AttachedCommandView";

import type {
  AttachedCommandAction,
  AttachedCommandCapabilities,
} from "./attached-command-types";

export type {
  AttachedCommandAction,
  AttachedCommandCapabilities,
} from "./attached-command-types";

/** Every native registry entry is deliberately classified for attached mode. */
export const ATTACHED_COMMAND_CLASSIFICATION: Record<
  string,
  "selector" | "server" | "remote" | "local" | "unavailable"
> = {
  "/agents": "selector",
  "/pinned": "selector",
  "/profiles": "selector",
  "/model": "selector",
  "/resume": "selector",
  "/memory": "selector",
  "/new": "server",
  "/fork": "server",
  "/rename": "server",
  "/recompile": "server",
  "/init": "remote",
  "/doctor": "remote",
  "/dream": "remote",
  "/reflect": "remote",
  "/reflection": "remote",
  "/compact": "remote",
  "/reload": "remote",
  "/context-limit": "remote",
  "/set-max-context": "remote",
  "/help": "local",
  "/exit": "local",
  "/reflect-arena": "unavailable",
  "/skills": "selector",
  "/skill-creator": "remote",
  "/palace": "unavailable",
  "/sleeptime": "selector",
  "/compaction": "selector",
  "/memfs": "server",
  "/search": "selector",
  "/connect": "unavailable",
  "/clear": "unavailable",
  "/clear-messages": "unavailable",
  "/chdir": "unavailable",
  "/cd": "unavailable",
  "/btw": "unavailable",
  "/pin": "remote",
  "/unpin": "remote",
  "/description": "server",
  "/toolset": "selector",
  "/experiments": "selector",
  "/mods": "remote",
  "/ade": "unavailable",
  "/system": "selector",
  "/personality": "selector",
  "/subagents": "selector",
  "/mcp": "selector",
  "/secret": "selector",
  "/memory-repository": "remote",
  "/usage": "selector",
  "/context": "selector",
  "/feedback": "unavailable",
  "/hooks": "remote",
  "/statusline": "remote",
  "/title": "unavailable",
  "/reasoning-tab": "unavailable",
  "/system-reminders": "unavailable",
  "/terminal": "unavailable",
  "/install-github-app": "unavailable",
  "/bg": "selector",
  "/workflows": "unavailable",
  "/login": "unavailable",
  "/logout": "unavailable",
  "/stream": "unavailable",
  "/link": "unavailable",
  "/unlink": "unavailable",
};

/** Decide where slash commands go; registry placeholder handlers must never be executed. */
export function routeAttachedCommand(
  input: string,
  capabilities: AttachedCommandCapabilities = {},
): AttachedCommandAction {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "message", text: input };
  const match = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { kind: "error", message: "Enter a command after /." };
  const name = match[1];
  const args = match[2] ?? "";
  if (!name) return { kind: "error", message: "Enter a command after /." };
  const builtin = commands[name];
  if (name === "/clear" || name === "/clear-messages") {
    return {
      kind: "error",
      message: `${name} is unavailable in attached sessions because remote clear can corrupt conversation history. Use /new.`,
    };
  }
  if (
    name === "/ade" &&
    capabilities.agentId &&
    isLocalAgentId(capabilities.agentId)
  )
    return {
      kind: "error",
      message: "ADE is not available for local backend agents.",
    };
  if (
    name === "/memory-repository" &&
    /^set\s+.*(?::\/\/[^/\s]*@|[?#])/i.test(args)
  )
    return {
      kind: "error",
      message:
        "Use a repository URL without URL credentials, query, or fragment.",
    };
  const privateControlIds: readonly string[] = ATTACHED_CONTROL_NAMES;
  const modId = name.slice(1);
  if (
    privateControlIds.includes(modId) &&
    capabilities.modCommands?.some((item) => item.id === modId)
  ) {
    if (name === "/memory-repository" && /^set(?:\s|$)/i.test(args))
      return {
        kind: "error",
        message:
          "Do not enter repository URLs in a slash command; use /memory-repository without arguments.",
      };
    return {
      kind: "server",
      operation: "execute",
      input: trimmed,
      commandId: modId,
      args,
    };
  }
  if (builtin?.noArgs && args && name !== "/new" && name !== "/hooks")
    return { kind: "error", message: `${name} does not accept arguments.` };
  switch (name) {
    case "/agents":
      return { kind: "selector", selector: "agents", input: trimmed };
    case "/pinned":
    case "/profiles":
      if (!hasAttachedControl(capabilities.supportedCommands, "pinned"))
        return {
          kind: "error",
          message: "Pinned agents are not available from this app server.",
        };
      return { kind: "selector", selector: "pinned", input: trimmed };
    case "/threads":
    case "/list":
      if (args)
        return { kind: "error", message: `${name} does not accept arguments.` };
      return { kind: "selector", selector: "resume", input: trimmed };
    case "/switch":
    case "/attach":
      if (!args || /\s/.test(args) || /^\d+$/.test(args))
        return {
          kind: "error",
          message: `Usage: ${name} <conversation_id>. Choose a conversation from /threads; numeric indexes are not available here.`,
        };
      return { kind: "server", operation: "resume", input: trimmed, args };
    case "/model":
      return { kind: "selector", selector: "model", input: trimmed };
    case "/memory":
      return { kind: "selector", selector: "memory", input: trimmed };
    case "/skills":
      if (!hasAttachedControl(capabilities.supportedCommands, "skills"))
        return {
          kind: "error",
          message: "/skills requires the updated app server.",
        };
      return { kind: "selector", selector: "skills", input: trimmed };
    case "/context":
    case "/usage":
    case "/subagents":
    case "/bg":
    case "/search":
    case "/mcp": {
      const selector = name.slice(1) as
        | "context"
        | "usage"
        | "search"
        | "subagents"
        | "bg"
        | "mcp";
      if (selector === "mcp" && args)
        return {
          kind: "error",
          message:
            "/mcp shows a read-only server inventory here; adding or changing servers is not available in this attached view.",
        };
      if (
        (selector === "search" || selector === "mcp") &&
        !hasAttachedControl(capabilities.supportedCommands, selector)
      )
        return {
          kind: "error",
          message: `${name} is not available on this app server.`,
        };
      return { kind: "selector", selector, input: trimmed, args };
    }
    case "/compaction":
      return { kind: "selector", selector: "compaction", input: trimmed };
    case "/sleeptime":
      return { kind: "selector", selector: "sleeptime", input: trimmed };
    case "/toolset":
      return { kind: "selector", selector: "toolset", input: trimmed };
    case "/experiments":
      if (args)
        return {
          kind: "error",
          message: "/experiments does not accept arguments in attached mode.",
        };
      return { kind: "selector", selector: "experiments", input: trimmed };
    case "/system":
    case "/personality": {
      const selector = name.slice(1) as "system" | "personality";
      if (!hasAttachedControl(capabilities.supportedCommands, selector))
        return {
          kind: "error",
          message: `${name} is not available on this app server.`,
        };
      return { kind: "selector", selector, input: trimmed };
    }
    case "/description":
      if (!args)
        return { kind: "error", message: "Usage: /description <text>" };
      return { kind: "server", operation: "description", input: trimmed, args };
    case "/memory-repository":
      if (
        !hasAttachedControl(capabilities.supportedCommands, "memory-repository")
      )
        return {
          kind: "error",
          message: "/memory-repository requires the updated app server.",
        };
      if (!args || args === "set")
        return {
          kind: "selector",
          selector: "repository",
          input: "/memory-repository",
        };
      if (args.startsWith("set "))
        return {
          kind: "error",
          message:
            "Open /memory-repository and choose Set URL to enter it securely.",
        };
      return {
        kind: "server",
        operation: "execute-private",
        input: trimmed,
        commandId: "memory-repository",
        args,
      };
    case "/mods":
      if (
        (args === "generate-env" || args.startsWith("generate-env ")) &&
        hasAttachedControl(capabilities.supportedCommands, "mods")
      )
        return {
          kind: "server",
          operation: "execute-prompt",
          input: trimmed,
          commandId: "mods",
          args,
        };
      return {
        kind: "error",
        message:
          "/mods needs server-side skill loading or the native learning harness, which this attached view does not yet expose.",
      };
    case "/statusline":
    case "/skill-creator": {
      const id = name.slice(1);
      if (!hasAttachedControl(capabilities.supportedCommands, id))
        return {
          kind: "error",
          message: `${name} requires the updated app server.`,
        };
      return {
        kind: "server",
        operation: "execute-prompt",
        input: trimmed,
        commandId: id,
        args,
      };
    }
    case "/secret": {
      const [subcommand, key, ...rest] = args.split(/\s+/);
      if (!subcommand || subcommand === "help")
        return {
          kind: "selector",
          selector: "secret",
          input: "/secret",
          args: "",
        };
      if (
        subcommand === "set" &&
        !rest.length &&
        (!key || /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      )
        return {
          kind: "selector",
          selector: "secret",
          input: "/secret set",
          args: key?.toUpperCase() ?? "",
        };
      if (subcommand === "list" && !key)
        return {
          kind: "server",
          operation: "secret-list",
          input: trimmed,
          args: "",
        };
      if (
        ["unset", "delete", "remove", "rm"].includes(subcommand ?? "") &&
        key &&
        !rest.length &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      )
        return {
          kind: "server",
          operation: "secret-unset",
          input: trimmed,
          args: key.toUpperCase(),
        };
      return {
        kind: "error",
        message:
          "Use /secret to add a value securely, /secret list, or /secret unset KEY. Do not put values in the visible command line.",
      };
    }
    case "/memfs":
      if (!args)
        return { kind: "selector", selector: "memory", input: trimmed };
      if (args === "enable")
        return {
          kind: "server",
          operation: "enable-memfs",
          input: trimmed,
          args,
        };
      return {
        kind: "error",
        message:
          "/memfs supports viewing and enable in attached mode; sync, reset and disable are unavailable.",
      };
    case "/resume":
      if (args && /\s/.test(args))
        return { kind: "error", message: "Usage: /resume [conversation_id]" };
      return args
        ? { kind: "server", operation: "resume", input: trimmed, args }
        : { kind: "selector", selector: "resume", input: trimmed };
    case "/new":
      return { kind: "server", operation: "new", input: trimmed, args };
    case "/fork":
      return { kind: "server", operation: "fork", input: trimmed, args };
    case "/recompile":
      return { kind: "server", operation: "recompile", input: trimmed, args };
    case "/rename": {
      const parsed = /^(agent|convo|conversation)\s+(.+)$/.exec(args);
      if (!parsed?.[2]?.trim())
        return {
          kind: "error",
          message: "Usage: /rename agent <name> or /rename convo <name>",
        };
      return {
        kind: "server",
        operation:
          parsed[1] === "agent" ? "rename-agent" : "rename-conversation",
        input: trimmed,
        args: parsed[2].trim(),
      };
    }
    case "/history":
      if (
        args &&
        (!/^\d+$/.test(args) || Number(args) < 1 || Number(args) > 50)
      )
        return { kind: "error", message: "Usage: /history [1-50]" };
      return { kind: "local", command: "history", input: trimmed, args };
    case "/status":
      if (args)
        return { kind: "error", message: "/status does not accept arguments." };
      return { kind: "local", command: "status", input: trimmed };
    case "/stop":
      if (args)
        return { kind: "error", message: "/stop does not accept arguments." };
      return { kind: "local", command: "stop", input: trimmed };
    case "/help":
    case "/?":
      return { kind: "local", command: "help", input: trimmed };
    case "/exit":
    case "/quit":
      if (args)
        return { kind: "error", message: `${name} does not accept arguments.` };
      return { kind: "local", command: "exit", input: trimmed };
  }

  const id = name === "/set-max-context" ? "context-limit" : name.slice(1);
  const supported =
    ATTACHED_COMMAND_CLASSIFICATION[name] === "remote" &&
    (privateControlIds.includes(id)
      ? hasAttachedControl(capabilities.supportedCommands, id)
      : capabilities.supportedCommands?.includes(id));
  const mod =
    !builtin && capabilities.modCommands?.some((item) => item.id === id);
  if (
    !builtin &&
    !mod &&
    hasAttachedControl(capabilities.supportedCommands, "skills") &&
    capabilities.invocableSkills?.some((item) => item.id === id)
  )
    return {
      kind: "server",
      operation: "execute-prompt",
      input: trimmed,
      args: JSON.stringify({ id, args }),
      commandId: "skills",
    };
  if (supported || mod)
    return {
      kind: "server",
      operation:
        supported && privateControlIds.includes(id)
          ? "execute-private"
          : "execute",
      input: trimmed,
      args,
      commandId: id,
    };
  if (builtin)
    return {
      kind: "error",
      message: `${name} is not available in this attached terminal yet.`,
    };
  return { kind: "error", message: `Unknown command: ${name}` };
}
