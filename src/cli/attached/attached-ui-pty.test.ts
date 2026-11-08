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
deadline = time.monotonic() + 8
sent_thinking = False
result = 124
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try: out.extend(os.read(master, 65536))
            except OSError: break
        # Initial approval owns focus. Wait for the actual reasoning control,
        # not elapsed startup time, before sending its expand key exactly once.
        if not sent_thinking and b'ctrl+t to expand' in out:
            os.write(master, b'\\x14')
            sent_thinking = True
        if p.poll() is not None and not ready: break
    try: result = p.wait(timeout=1)
    except subprocess.TimeoutExpired: pass
    if result == 0 and not sent_thinking:
        sys.stderr.write('Thinking expand control was never ready\\n')
        result = 2
finally:
    if p.poll() is None:
        p.kill()
        p.wait()
    os.close(master)
    sys.stdout.buffer.write(out)
sys.exit(result)
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
