import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Node bundle opens the attached Ink UI against a loopback fixture without starting a second runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "attached-node-bundle-"));
  let server: { stop: (closeActiveConnections?: boolean) => void } | undefined;
  const requests: string[] = [];
  let auth = "";
  try {
    // Bun's test process can contaminate the bundler's alias registry. Build
    // in a child, as the repository's isolated build tests do.
    const buildScript = `const result = await Bun.build({
      entrypoints: ['./src/standalone-entry.ts'], outdir: process.argv[1], target: 'node', format: 'esm',
      naming: {entry: 'letta.js'}, define: {LETTA_VERSION: '"test"', BUILD_TIME: '"test"', __USE_MAGICK__: 'false'},
      loader: {'.md':'text','.mdx':'text','.txt':'text'},
      external: ['ws','@vscode/ripgrep','node-pty','grammy','@pierre/diffs','@pierre/diffs/*','@shikijs/langs','@shikijs/langs/*']
    }); if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }`;
    const build = spawnSync("bun", ["-e", buildScript, root], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect({ status: build.status, stderr: build.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await symlink(
      join(process.cwd(), "node_modules"),
      join(root, "node_modules"),
    );
    const home = join(root, "home");
    await mkdir(home);
    const token = join(root, "token");
    await writeFile(token, "fixture-token");
    const mock = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, socketServer) {
        auth = request.headers.get("authorization") ?? "";
        return socketServer.upgrade(request)
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        message(socket, bytes) {
          const frame = JSON.parse(String(bytes)) as {
            type: string;
            request_id: string;
            runtime?: unknown;
            conversation_id?: string;
            agent_id?: string;
          };
          requests.push(frame.type);
          const base = { request_id: frame.request_id, success: true };
          let response: unknown;
          if (frame.type === "conversation_retrieve")
            response = {
              ...base,
              type: "conversation_retrieve_response",
              conversation: { id: "conv", agent_id: "aya" },
            };
          else if (frame.type === "agent_retrieve")
            response = {
              ...base,
              type: "agent_retrieve_response",
              agent: {
                id: "aya",
                name: "Aya",
                model: "fixture/model",
                llm_config: {},
                blocks: [],
                tools: [],
                tags: [],
                sources: [],
              },
            };
          else if (frame.type === "sync")
            response = {
              ...base,
              type: "sync_response",
              runtime: frame.runtime,
            };
          else if (frame.type === "conversation_messages_list")
            response = {
              ...base,
              type: "conversation_messages_list_response",
              messages: [],
              next_before: null,
              has_more: false,
            };
          if (response) socket.send(JSON.stringify(response));
        },
      },
    });
    server = mock;
    const node = Bun.which("node");
    const python = Bun.which("python3");
    if (!node || !python)
      throw new Error("Node and Python are required for the PTY fixture");
    const argv = [
      node,
      join(root, "letta.js"),
      "attach",
      "--agent",
      "aya",
      "--conversation",
      "conv",
      "--url",
      `ws://127.0.0.1:${mock.port}/ws`,
      "--token-file",
      token,
      "--state-dir",
      join(root, "state"),
    ];
    const ptyScript = `
import os, pty, fcntl, termios, struct, subprocess, select, sys, time
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 90, 0, 0))
p = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy())
os.close(slave)
out = bytearray(); started = time.monotonic(); sent = False; entered = False; sent_at = 0
while time.monotonic() - started < 12:
    ready, _, _ = select.select([master], [], [], 0.1)
    if ready:
        try: out.extend(os.read(master, 65536))
        except OSError: break
    if not sent and b'Attached service' in out and time.monotonic() - started > 1:
        os.write(master, b'/exit'); sent = True; sent_at = time.monotonic()
    if sent and not entered and time.monotonic() - sent_at > 0.5:
        os.write(master, b'\\r'); entered = True
    if p.poll() is not None and not ready: break
status = p.poll()
if status is None: p.kill(); p.wait(); status = 124
os.close(master); sys.stdout.buffer.write(out); sys.exit(status)
`;
    const child = spawn(python, ["-c", ptyScript, ...argv], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        TMPDIR: root,
        TERM: "xterm-256color",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const capture = (data: Buffer) => {
      output += data.toString();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const outcome = await new Promise<{
      code: number | null;
      timedOut: boolean;
    }>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ code: null, timedOut: true });
      }, 15_000);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut: false });
      });
    });
    if (outcome.code !== 0 || outcome.timedOut)
      throw new Error(
        `Node fixture failed: ${JSON.stringify(outcome)}; requests=${requests.join(",")}; output=${output.slice(-3000)}`,
      );
    expect(auth).toBe("Bearer fixture-token");
    expect(requests).toEqual([
      "conversation_retrieve",
      "agent_retrieve",
      "sync",
      "conversation_messages_list",
    ]);
    expect(output).toContain("Aya");
    expect(output).not.toContain("Cannot find module");
  } finally {
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
