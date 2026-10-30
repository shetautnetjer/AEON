import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __testOverrideChannelsRoot } from "@/channels/config";
import { startLocalChannelGateway } from "@/channels/gateway-local";
import { CHANNEL_GATEWAY_READY_SIGNAL } from "@/channels/gateway-supervisor";
import { runChannelGatewaySubcommand } from "@/cli/subcommands/channel-gateway";
import { type AppServerHandle, startAppServer } from "@/websocket/app-server";
import { parseAppServerWebsocketAuthSettings } from "@/websocket/app-server-auth";

// An always-on App Server started with `--ws-auth capability-token`. These tests drive the
// gateway's own entry points against such a server, so they fail if the token is not wired
// through from the CLI flag to the client.
const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
let handle: AppServerHandle | null = null;
let dir: string | null = null;

afterEach(async () => {
  await handle?.close();
  handle = null;
  __testOverrideChannelsRoot(null);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

async function tokenServer(): Promise<AppServerHandle> {
  return startAppServer({
    listen: "ws://127.0.0.1:0",
    websocketAuth: parseAppServerWebsocketAuthSettings({
      wsAuth: "capability-token",
      wsTokenSha256: sha256Hex("gateway-secret"),
    }),
  });
}

describe("channel gateway against a capability-token App Server", () => {
  test("startLocalChannelGateway attaches with appServerAuthToken and is refused without it", async () => {
    handle = await tokenServer();
    dir = mkdtempSync(join(tmpdir(), "cg-auth-"));
    __testOverrideChannelsRoot(dir);

    const gateway = await startLocalChannelGateway({
      appServerUrl: handle.controlUrl,
      appServerAuthToken: "gateway-secret",
      channelNames: [],
      failOnStartupError: false,
      logger: () => {},
    });
    await gateway.close();

    for (const appServerAuthToken of [undefined, "wrong-token"]) {
      const attempt = startLocalChannelGateway({
        appServerUrl: handle.controlUrl,
        appServerAuthToken,
        channelNames: [],
        failOnStartupError: false,
        logger: () => {},
      });
      const outcome = await Promise.race([
        attempt.then(
          async (g) => {
            await g.close();
            return "attached";
          },
          () => "refused",
        ),
        new Promise((r) => setTimeout(() => r("timeout"), 3000)),
      ]);
      expect(outcome).toBe("refused");
    }
  });

  test("the CLI attaches with a valid --app-server-token-file", async () => {
    handle = await tokenServer();
    dir = mkdtempSync(join(tmpdir(), "cg-auth-"));
    __testOverrideChannelsRoot(dir);
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "gateway-secret\n");
    const logs: string[] = [];
    const log = spyOn(console, "log").mockImplementation((m: unknown) => {
      logs.push(String(m));
    });
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const exit = runChannelGatewaySubcommand([
        "--app-server-url",
        handle.controlUrl,
        "--channels",
        "custom",
        "--allow-startup-errors",
        "--app-server-token-file",
        tokenFile,
      ]);
      // Ready means the CLI's client attached through the token; then stop it the way systemd does.
      for (
        let i = 0;
        i < 100 && !logs.includes(CHANNEL_GATEWAY_READY_SIGNAL);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(logs).toContain(CHANNEL_GATEWAY_READY_SIGNAL);
      process.emit("SIGTERM");
      expect(await exit).toBe(0);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  test("--app-server-token-file must be readable and non-empty", async () => {
    dir = mkdtempSync(join(tmpdir(), "cg-auth-"));
    const empty = join(dir, "empty");
    writeFileSync(empty, "  \n");
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await runChannelGatewaySubcommand([
          "--app-server-url",
          "ws://127.0.0.1:1/ws",
          "--channels",
          "custom",
          "--app-server-token-file",
          join(dir, "missing"),
        ]),
      ).toBe(1);
      expect(String(err.mock.calls.at(-1)?.[0])).toContain(
        "cannot read --app-server-token-file",
      );
      expect(
        await runChannelGatewaySubcommand([
          "--app-server-url",
          "ws://127.0.0.1:1/ws",
          "--channels",
          "custom",
          "--app-server-token-file",
          empty,
        ]),
      ).toBe(1);
      expect(String(err.mock.calls.at(-1)?.[0])).toContain("is empty");
    } finally {
      err.mockRestore();
    }
  });
});
