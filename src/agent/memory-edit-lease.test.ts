import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setCurrentAgentId } from "@/agent/context";
import { withMemoryEditLease } from "@/agent/memory-edit-lease";
import { getScopedMemoryFilesystemRoot } from "@/agent/memory-filesystem";
import { claimMemoryOperation } from "@/agent/memory-operation";
import { settingsManager } from "@/settings-manager";
import { TestDirectory } from "@/test-utils/test-fs";
import { apply_patch } from "@/tools/impl/apply-patch";
import { edit } from "@/tools/impl/edit";
import { write } from "@/tools/impl/write";

// Aya's own Edit/Write/ApplyPatch calls on her memory checkout used to skip
// the memory lease, so a worker's change or a parallel edit could be dropped
// with no error. These tests fail when the tools stop taking the lease.

const AGENT = "agent-memory-edit-lease";
const HOLD_MS = 400;
let root: string;
const file = () => join(root, "notes", "diary.md");

/**
 * Hold the lease from another process and do a worker-style read-modify-write
 * on `path` (replace "B: old" with "B: worker"). Resolves once it holds.
 */
async function holdLeaseInChild(path: string, holdMs = HOLD_MS) {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { withMemoryOperation } from ${JSON.stringify(join(import.meta.dir, "memory-operation.ts"))};
       import { readFile, writeFile } from "node:fs/promises";
       const [dir, path, ms] = process.argv.slice(1);
       await withMemoryOperation(dir, async () => {
         const text = await readFile(path, "utf8");
         console.log("holding");
         await new Promise((r) => setTimeout(r, Number(ms)));
         await writeFile(path, text.replace("B: old", "B: worker"));
       });`,
      root,
      path,
      String(holdMs),
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const reader = child.stdout.getReader();
  let seen = "";
  while (!seen.includes("holding")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("lease holder exited before holding the lease");
    seen += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return child;
}

describe("memory edit lease", () => {
  beforeAll(async () => {
    await settingsManager.initialize();
    settingsManager.setMemfsEnabled(AGENT, true);
    root = getScopedMemoryFilesystemRoot(AGENT);
    mkdirSync(join(root, "notes"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    setCurrentAgentId(AGENT);
  });
  afterAll(() => {
    setCurrentAgentId(null);
    rmSync(root, { recursive: true, force: true });
  });

  const tools = {
    Edit: () =>
      edit({ file_path: file(), old_string: "A: old", new_string: "A: aya" }),
    Write: () => write({ file_path: file(), content: "A: aya\nB: old\n" }),
    ApplyPatch: () =>
      apply_patch({
        input: `*** Begin Patch\n*** Update File: ${file()}\n@@\n-A: old\n+A: aya\n*** End Patch`,
      }),
  };

  for (const [name, run] of Object.entries(tools)) {
    test(`${name} on a memory file waits for a worker holding the lease`, async () => {
      writeFileSync(file(), "A: old\nB: old\n");
      const worker = await holdLeaseInChild(file());
      const started = Date.now();
      await run();
      const waited = Date.now() - started;
      await worker.exited;
      expect(waited).toBeGreaterThanOrEqual(HOLD_MS / 2);
      // Write replaces the whole file, so it can only be checked for ordering:
      // it ran after the worker, not in the middle of its read and write.
      const text = readFileSync(file(), "utf8");
      expect(text).toContain("A: aya");
      if (name !== "Write") expect(text).toContain("B: worker");
    });
  }

  test("ten parallel Edits on one memory file keep every change", async () => {
    writeFileSync(file(), "END\n");
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        edit({
          file_path: file(),
          old_string: "END",
          new_string: `line ${i}\nEND`,
        }),
      ),
    );
    const kept = readFileSync(file(), "utf8").match(/^line /gm) ?? [];
    expect(kept.length).toBe(10);
  });

  describe("outside the lease", () => {
    let other: TestDirectory | undefined;
    afterEach(() => other?.cleanup());

    test("an Edit outside the memory checkout does not wait", async () => {
      writeFileSync(file(), "A: old\nB: old\n");
      other = new TestDirectory();
      const outside = other.createFile("x.md", "A: old\n");
      const worker = await holdLeaseInChild(file());
      const started = Date.now();
      await edit({
        file_path: outside,
        old_string: "A: old",
        new_string: "A: new",
      });
      expect(Date.now() - started).toBeLessThan(HOLD_MS / 2);
      await worker.exited;
    });

    test("a memory worker session does not wait on its parent's lease", async () => {
      const release = await claimMemoryOperation(root);
      expect(release).not.toBeNull();
      try {
        const started = Date.now();
        await withMemoryEditLease(file(), async () => {}, {
          memoryDir: root,
          timeoutMs: 1_000,
          env: { LETTA_MEMORY_WORKER_SESSION: "1" },
        });
        expect(Date.now() - started).toBeLessThan(500);
      } finally {
        await release?.();
      }
    });

    test("a subagent launched by the lease holder works under its lease", async () => {
      const release = await claimMemoryOperation(root);
      try {
        const runChild = (env: Record<string, string>) =>
          Bun.spawn(
            [
              process.execPath,
              "-e",
              `import { withMemoryEditLease } from ${JSON.stringify(join(import.meta.dir, "memory-edit-lease.ts"))};
               const [dir, path] = process.argv.slice(1);
               try {
                 await withMemoryEditLease(path, async () => {}, { memoryDir: dir, timeoutMs: 300 });
                 console.log("ran");
               } catch { console.log("timed out"); }`,
              root,
              file(),
            ],
            { stdout: "pipe", env: { ...process.env, ...env } },
          );
        const delegated = runChild({ LETTA_SUBAGENT_LAUNCH: "1" });
        const unrelated = runChild({ LETTA_SUBAGENT_LAUNCH: "" });
        expect((await new Response(delegated.stdout).text()).trim()).toBe(
          "ran",
        );
        expect((await new Response(unrelated.stdout).text()).trim()).toBe(
          "timed out",
        );
      } finally {
        await release?.();
      }
    });
  });

  test("a timed-out edit writes nothing and says why", async () => {
    writeFileSync(file(), "A: old\nB: old\n");
    const worker = await holdLeaseInChild(file(), 1_500);
    let error: unknown;
    let ran = false;
    try {
      await withMemoryEditLease(
        file(),
        async () => {
          ran = true;
        },
        { memoryDir: root, timeoutMs: 200 },
      );
    } catch (e) {
      error = e;
    }
    await worker.exited;
    expect(ran).toBe(false);
    expect(String(error)).toContain("Memory is being updated");
  });
});
