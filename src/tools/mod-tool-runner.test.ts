import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INTERRUPTED_BY_USER } from "@/constants";
import {
  clearModPermissions,
  registerModPermission,
} from "@/mods/permission-registry";
import { clearModTools, registerModTool } from "@/mods/tool-registry";
import type { ModToolRegistration, ModToolsHandle } from "@/mods/types";
import {
  clearCapturedToolExecutionContexts,
  clearTools,
  executeTool,
  getToolNames,
  loadSpecificTools,
  prepareCurrentToolExecutionContext,
} from "@/tools/manager";
import {
  createModToolsHandle,
  MAX_MOD_TOOL_CALL_DEPTH,
  type ModToolsHandleDeps,
} from "@/tools/mod-tool-runner";

const owner = {
  id: "global:/mods/tools-run-test.ts",
  path: "/mods/tools-run-test.ts",
  scope: "global" as const,
  generation: 1,
};

function registerTestModTool(
  registration: Pick<ModToolRegistration, "name" | "run"> &
    Partial<Pick<ModToolRegistration, "approvalPolicy">>,
): void {
  registerModTool({
    description: `${registration.name} test tool`,
    parameters: { type: "object", properties: {} },
    owner,
    path: owner.path,
    approvalPolicy: registration.approvalPolicy ?? "auto",
    requiresApproval: registration.approvalPolicy === "ask",
    parallelSafe: false,
    activationSignal: new AbortController().signal,
    name: registration.name,
    run: registration.run,
  });
}

function requireTools(tools: ModToolsHandle | undefined): ModToolsHandle {
  if (!tools) throw new Error("ctx.tools missing");
  return tools;
}

function asText(result: Awaited<ReturnType<typeof executeTool>>): string {
  return typeof result.toolReturn === "string"
    ? result.toolReturn
    : JSON.stringify(result.toolReturn);
}

describe("createModToolsHandle", () => {
  function deps(overrides: Partial<ModToolsHandleDeps> = {}) {
    const executed: string[] = [];
    const base: ModToolsHandleDeps = {
      callerToolName: "caller",
      signal: new AbortController().signal,
      listTools: () => [
        { name: "Read", description: "read", parameters: {} },
        { name: "caller", description: "self", parameters: {} },
        { name: "AskUserQuestion", description: "ask", parameters: {} },
      ],
      checkPermission: async () => ({ decision: "allow" }),
      execute: async (name) => {
        executed.push(name);
        return {
          status: "success",
          toolReturn: [{ type: "text", text: `ran ${name}` }],
        };
      },
      ...overrides,
    };
    return { base, executed };
  }

  test("runs an allowed tool and flattens text output", async () => {
    const { base, executed } = deps();
    const result = await createModToolsHandle(base).run("Read", {});
    expect(result).toEqual({ status: "success", output: "ran Read" });
    expect(executed).toEqual(["Read"]);
  });

  test("refuses agent-spawning and orchestration tools", async () => {
    const { base, executed } = deps();
    const handle = createModToolsHandle(base);
    for (const name of [
      "Agent",
      "Task",
      "SendAgentMessage",
      "Workflow",
      "CodeMode",
      "Skill",
    ]) {
      const result = await handle.run(name, {});
      expect(result.status).toBe("error");
    }
    expect(executed).toEqual([]);
  });

  test("list hides the caller and interactive tools", async () => {
    const { base } = deps();
    const names = (await createModToolsHandle(base).list()).map((t) => t.name);
    expect(names).toEqual(["Read"]);
  });

  test("rejects unknown tools without checking permission", async () => {
    let checked = false;
    const { base } = deps({
      checkPermission: async () => {
        checked = true;
        return { decision: "allow" };
      },
    });
    const result = await createModToolsHandle(base).run("Nope", {});
    expect(result.status).toBe("error");
    expect(result.output).toContain("tool not available to mod tools: Nope");
    expect(checked).toBe(false);
  });

  test("does not execute denied or approval-gated calls", async () => {
    for (const decision of ["deny", "ask", "alwaysAsk"] as const) {
      const { base, executed } = deps({
        checkPermission: async () => ({ decision, matchedRule: "rule-x" }),
      });
      const result = await createModToolsHandle(base).run("Read", {});
      expect(result.status).toBe("error");
      expect(result.output).toContain(
        decision === "deny"
          ? "denied by permission rules"
          : "requires user approval",
      );
      expect(executed).toEqual([]);
    }
  });

  test("blocks a mod tool from running itself", async () => {
    const { base, executed } = deps();
    const result = await createModToolsHandle(base).run("caller", {});
    expect(result.status).toBe("error");
    expect(result.output).toContain("recursive mod tool calls are not allowed");
    expect(executed).toEqual([]);
  });

  test("returns an interrupted result when the caller signal aborts", async () => {
    const controller = new AbortController();
    const { base } = deps({
      signal: controller.signal,
      execute: () => new Promise(() => {}),
    });
    const pending = createModToolsHandle(base).run("Read", {});
    controller.abort();
    expect(await pending).toEqual({
      status: "error",
      output: INTERRUPTED_BY_USER,
    });
  });

  test("returns an interrupted result for an already-aborted call signal", async () => {
    const { base, executed } = deps();
    const result = await createModToolsHandle(base).run(
      "Read",
      {},
      { signal: AbortSignal.abort() },
    );
    expect(result).toEqual({ status: "error", output: INTERRUPTED_BY_USER });
    expect(executed).toEqual([]);
  });
});

describe("ctx.tools.run through executeTool", () => {
  let initialTools: string[] = [];
  let workspace = "";
  let notesPath = "";
  let secretPath = "";

  beforeAll(async () => {
    initialTools = getToolNames();
    await loadSpecificTools(["Read"]);
    workspace = mkdtempSync(join(tmpdir(), "mod-tools-run-"));
    mkdirSync(join(workspace, ".letta"));
    writeFileSync(
      join(workspace, ".letta", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Read(secret.txt)"] } }),
    );
    notesPath = join(workspace, "notes.txt");
    secretPath = join(workspace, "secret.txt");
    writeFileSync(notesPath, "visible notes");
    writeFileSync(secretPath, "hidden secret");
  });

  afterEach(() => {
    clearCapturedToolExecutionContexts();
    clearModPermissions();
    clearModTools();
  });

  afterAll(async () => {
    rmSync(workspace, { recursive: true, force: true });
    if (initialTools.length > 0) await loadSpecificTools(initialTools);
    else clearTools();
  });

  function prepare() {
    return prepareCurrentToolExecutionContext({
      workingDirectory: workspace,
      permissionModeState: { mode: "standard" },
    });
  }

  async function runOuter(
    inner: (tools: ModToolsHandle) => Promise<string>,
  ): Promise<Awaited<ReturnType<typeof executeTool>>> {
    registerTestModTool({
      name: "outer_tool",
      run: async (ctx) => inner(requireTools(ctx.tools)),
    });
    const prepared = await prepare();
    return executeTool("outer_tool", {}, { toolContextId: prepared.contextId });
  }

  test("runs a permitted built-in tool", async () => {
    const result = await runOuter(async (tools) => {
      const read = await tools.run("Read", { file_path: notesPath });
      return `${read.status}:${read.output.includes("visible notes")}`;
    });
    expect(result.status).toBe("success");
    expect(asText(result)).toBe("success:true");
  });

  test("lists the turn's tools", async () => {
    const result = await runOuter(async (tools) =>
      (await tools.list()).map((tool) => tool.name).join(","),
    );
    expect(asText(result).split(",")).toContain("Read");
    expect(asText(result).split(",")).not.toContain("outer_tool");
  });

  test("reports unknown tools as errors", async () => {
    const result = await runOuter(async (tools) =>
      JSON.stringify(await tools.run("DoesNotExist", {})),
    );
    expect(asText(result)).toContain("tool not available to mod tools");
  });

  test("honors deny rules", async () => {
    const result = await runOuter(async (tools) =>
      JSON.stringify(await tools.run("Read", { file_path: secretPath })),
    );
    expect(asText(result)).toContain("denied by permission rules");
    expect(asText(result)).toContain("Read(secret.txt)");
    expect(asText(result)).not.toContain("hidden secret");
  });

  test("honors mod permission overlays", async () => {
    registerModPermission({
      id: "deny-read",
      description: "Deny reads",
      path: owner.path,
      owner,
      activationSignal: new AbortController().signal,
      check: (event) =>
        event.toolName === "Read"
          ? { decision: "deny", reason: "no reads" }
          : undefined,
    });
    const result = await runOuter(async (tools) =>
      JSON.stringify(await tools.run("Read", { file_path: notesPath })),
    );
    expect(asText(result)).toContain("mod permission:deny-read");
    expect(asText(result)).not.toContain("visible notes");
  });

  test("returns an error instead of auto-approving approval-gated tools", async () => {
    let ran = false;
    registerTestModTool({
      name: "gated_tool",
      approvalPolicy: "ask",
      run: () => {
        ran = true;
        return "should not run";
      },
    });
    const result = await runOuter(async (tools) =>
      JSON.stringify(await tools.run("gated_tool", {})),
    );
    expect(asText(result)).toContain("requires user approval");
    expect(ran).toBe(false);
  });

  test("blocks direct self-recursion", async () => {
    let calls = 0;
    registerTestModTool({
      name: "self_tool",
      run: async (ctx) => {
        calls++;
        return JSON.stringify(
          await requireTools(ctx.tools).run("self_tool", {}),
        );
      },
    });
    const prepared = await prepare();
    const result = await executeTool(
      "self_tool",
      {},
      { toolContextId: prepared.contextId },
    );
    expect(asText(result)).toContain(
      "recursive mod tool calls are not allowed",
    );
    expect(calls).toBe(1);
  });

  test("blocks indirect recursion and bounds nesting depth", async () => {
    // a -> b -> a is indirect recursion.
    registerTestModTool({
      name: "ping_tool",
      run: async (ctx) =>
        JSON.stringify(await requireTools(ctx.tools).run("pong_tool", {})),
    });
    registerTestModTool({
      name: "pong_tool",
      run: async (ctx) =>
        JSON.stringify(await requireTools(ctx.tools).run("ping_tool", {})),
    });
    // chain_0 -> chain_1 -> ... until the depth limit stops it.
    const chainLength = MAX_MOD_TOOL_CALL_DEPTH + 3;
    for (let i = 0; i < chainLength; i++) {
      registerTestModTool({
        name: `chain_${i}`,
        run: async (ctx) =>
          i === chainLength - 1
            ? "bottom"
            : JSON.stringify(
                await requireTools(ctx.tools).run(`chain_${i + 1}`, {}),
              ),
      });
    }
    const prepared = await prepare();
    const ping = await executeTool(
      "ping_tool",
      {},
      { toolContextId: prepared.contextId },
    );
    expect(asText(ping)).toContain("recursive mod tool calls are not allowed");

    const chain = await executeTool(
      "chain_0",
      {},
      { toolContextId: prepared.contextId },
    );
    expect(asText(chain)).toContain(
      `limited to depth ${MAX_MOD_TOOL_CALL_DEPTH}`,
    );
    expect(asText(chain)).not.toContain("bottom");
  });

  test("returns an interrupted result when the call signal aborts", async () => {
    registerTestModTool({
      name: "hanging_tool",
      run: () => new Promise<string>(() => {}),
    });
    const result = await runOuter(async (tools) => {
      const controller = new AbortController();
      const pending = tools.run(
        "hanging_tool",
        {},
        {
          signal: controller.signal,
        },
      );
      setTimeout(() => controller.abort(), 10);
      return JSON.stringify(await pending);
    });
    expect(asText(result)).toContain(INTERRUPTED_BY_USER);
  });
});
