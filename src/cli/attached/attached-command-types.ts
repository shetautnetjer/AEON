export interface AttachedCommandCapabilities {
  agentId?: string;
  supportedCommands?: readonly string[];
  modCommands?: readonly { id: string; description?: string; args?: string }[];
  invocableSkills?: readonly { id: string; description?: string }[];
}

export type AttachedCommandAction =
  | { kind: "message"; text: string }
  | {
      kind: "selector";
      selector:
        | "agents"
        | "pinned"
        | "model"
        | "resume"
        | "memory"
        | "skills"
        | "compaction"
        | "sleeptime"
        | "toolset"
        | "experiments"
        | "system"
        | "personality"
        | "context"
        | "usage"
        | "search"
        | "subagents"
        | "bg"
        | "mcp"
        | "secret"
        | "repository";
      input: string;
      args?: string;
    }
  | {
      kind: "server";
      operation:
        | "new"
        | "fork"
        | "resume"
        | "rename-agent"
        | "rename-conversation"
        | "recompile"
        | "enable-memfs"
        | "description"
        | "secret-list"
        | "secret-unset"
        | "execute-prompt"
        | "execute-private"
        | "execute";
      input: string;
      args: string;
      commandId?: string;
    }
  | {
      kind: "local";
      command: "help" | "exit" | "history" | "status" | "stop";
      input: string;
      args?: string;
    }
  | { kind: "error"; message: string };
