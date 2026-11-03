import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";

test("offline attached approval renders its full input in a real terminal", () => {
  const home = mkdtempSync(join(tmpdir(), "attached-pty-"));
  const python = `
import os, pty, fcntl, termios, struct, subprocess, select, sys, time
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 90, 0, 0))
p = subprocess.Popen(['bun', sys.argv[1]], stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy())
os.close(slave)
out = bytearray()
start = time.monotonic()
deadline = start + 8
sent_thinking = False
while time.monotonic() < deadline:
    if not sent_thinking and time.monotonic() - start > 0.6:
        os.write(master, b'\\x14')
        sent_thinking = True
    ready, _, _ = select.select([master], [], [], 0.2)
    if ready:
        try: out.extend(os.read(master, 65536))
        except OSError: break
    if p.poll() is not None and not ready: break
try: p.wait(timeout=1)
except subprocess.TimeoutExpired:
    p.kill(); p.wait(); sys.exit(124)
os.close(master)
sys.stdout.buffer.write(out)
sys.exit(p.returncode)
`;
  try {
    const child = spawnSync(
      "python3",
      ["-c", python, join(import.meta.dir, "attached-ui-pty-fixture.tsx")],
      {
        env: { ...process.env, HOME: home, TERM: "xterm-256color" },
        timeout: 10000,
        encoding: "utf8",
      },
    );
    expect(child.status).toBe(0);
    const frame = stripAnsi(child.stdout).replace(/\r/g, "");
    expect(frame).toContain("Attached service");
    expect(frame).toContain("PTY-APPROVAL");
    expect(frame).toContain("flag");
    expect(frame).toContain("1. Yes");
    expect(frame).toContain("PTY-THINKING");
    expect(frame).toContain("PTY-RESPONSE");
    expect(frame).not.toContain("Context repositories are not enabled");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
