import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";

test("common attached command menus render over an offline fake protocol in a real PTY", () => {
  const home = mkdtempSync(join(tmpdir(), "attached-menu-pty-"));
  const python = `
import os, pty, fcntl, termios, struct, subprocess, select, sys, time
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 100, 0, 0))
p = subprocess.Popen(['bun', sys.argv[1]], stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy())
os.close(slave)
out = bytearray(); start = time.monotonic(); deadline = start + 7; typed = False; entered = False
while time.monotonic() < deadline:
    elapsed = time.monotonic() - start
    if elapsed > 0.45 and not typed:
        os.write(master, sys.argv[2].encode()); typed = True
    if elapsed > 0.8 and not entered:
        os.write(master, b'\\r'); entered = True
    ready, _, _ = select.select([master], [], [], 0.05)
    if ready:
        try: out.extend(os.read(master, 65536))
        except OSError: break
    if p.poll() is not None and not ready: break
try: p.wait(timeout=1)
except subprocess.TimeoutExpired:
    p.kill(); p.wait(); sys.exit(124)
os.close(master)
sys.stdout.buffer.write(out); sys.exit(p.returncode)
`;
  try {
    for (const [command, expected] of [
      ["/help", "Commands ("],
      ["/resume", "Session result"],
      ["/memory", "memory-result.md"],
      ["/model", "Model result"],
    ]) {
      const child = spawnSync(
        "python3",
        [
          "-c",
          python,
          join(import.meta.dir, "attached-ui-menu-pty-fixture.tsx"),
          command as string,
        ],
        {
          env: { ...process.env, HOME: home, TERM: "xterm-256color" },
          timeout: 9000,
          encoding: "utf8",
        },
      );
      expect(child.status).toBe(0);
      expect(stripAnsi(child.stdout).replace(/\r/g, "")).toContain(
        expected as string,
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
