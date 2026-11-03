import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function isolated(
  run: (home: string, env: NodeJS.ProcessEnv) => Promise<void>,
) {
  const home = mkdtempSync(join(tmpdir(), "attached-startup-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    TMPDIR: home,
    LETTA_LOCAL_BACKEND_DIR: join(home, "backend"),
  };
  delete env.LETTA_API_KEY;
  delete env.LETTA_TOKEN;
  try {
    await run(home, env);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("native attach help bypasses backend, credential bootstrap and browser discovery", async () => {
  await isolated(async (home, env) => {
    for (const entry of ["src/index.ts", "src/cli/attached/entry.ts"]) {
      const child = Bun.spawn(
        [
          process.execPath,
          entry,
          ...(entry.endsWith("index.ts") ? ["attach"] : []),
          "--help",
        ],
        {
          cwd: resolve(import.meta.dir, "../../.."),
          env,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const timeout = setTimeout(() => child.kill(), 10_000);
      try {
        const [code, output, errors] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(0);
        expect(output).toContain("letta attach --agent");
        expect(errors).not.toContain("credentials");
        // Bun itself may create its transpiler cache; the CLI creates no state.
        expect(readdirSync(home).filter((name) => name !== ".bun")).toEqual([]);
      } finally {
        clearTimeout(timeout);
      }
    }
  });
}, 25_000);

test("display-only settings initialization neither creates files nor migrates saved credentials", async () => {
  await isolated(async (home, env) => {
    const source = `import {settingsManager} from './src/settings-manager'; await settingsManager.initialize({readOnly:true}); console.log(JSON.stringify({version:settingsManager.getSettings().version, theme:settingsManager.getSettings().theme}));`;
    const launch = () =>
      Bun.spawn([process.execPath, "-e", source], {
        cwd: resolve(import.meta.dir, "../../.."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
    let child = launch();
    expect(await child.exited).toBe(0);
    expect(existsSync(join(home, ".letta"))).toBe(false);
    const path = join(home, ".letta/settings.json");
    mkdirSync(join(home, ".letta"));
    const original = JSON.stringify(
      {
        theme: "light",
        env: { LETTA_API_KEY: "fixture-only-never-real" },
        refreshToken: "fixture-refresh",
        pinnedAgents: { old: "aya" },
      },
      null,
      3,
    );
    writeFileSync(path, original);
    child = launch();
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toContain(
      '"theme":"light"',
    );
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(readdirSync(join(home, ".letta"))).toEqual(["settings.json"]);
  });
});
