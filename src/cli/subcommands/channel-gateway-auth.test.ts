import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createAppServerClient } from "@/app-server-client";
import { runChannelGatewaySubcommand } from "@/cli/subcommands/channel-gateway";
import { type AppServerHandle, startAppServer } from "@/websocket/app-server";
import { parseAppServerWebsocketAuthSettings } from "@/websocket/app-server-auth";

// A capability-token App Server (how Aya's daemon runs) must accept the channel gateway's
// client only with the token, which channel-gateway now reads from --app-server-token-file.
const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
let handle: AppServerHandle | null = null;
let dir: string | null = null;

afterEach(async () => {
  await handle?.close();
  handle = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("channel-gateway against a capability-token App Server", () => {
  test("the gateway's client connects with the token and is refused without it", async () => {
    handle = await startAppServer({
      listen: "ws://127.0.0.1:0",
      websocketAuth: parseAppServerWebsocketAuthSettings({
        wsAuth: "capability-token",
        wsTokenSha256: sha256Hex("gateway-secret"),
      }),
    });
    const withToken = createAppServerClient({
      url: handle.controlUrl,
      WebSocket: WebSocket as never,
      authToken: "gateway-secret",
    });
    await withToken.connect();
    const info = await withToken.info();
    expect(info.type).toBe("app_server_info_response");
    withToken.close();

    // Without the token the server refuses the WebSocket upgrade with 401 before any socket opens;
    // check it with a plain upgrade request so it doesn't depend on a client's error events.
    // Without (or with a wrong) token the upgrade is refused, so the gateway's client can never
    // attach. connect() rejects instead of opening.
    for (const authToken of [undefined, "wrong-token"]) {
      const client = createAppServerClient({
        url: handle.controlUrl,
        WebSocket: WebSocket as never,
        ...(authToken ? { authToken } : {}),
      });
      client.socket.on?.("error", () => {});
      const outcome = await Promise.race([
        client.connect().then(
          () => "opened",
          () => "refused",
        ),
        new Promise((r) => setTimeout(() => r("timeout"), 3000)),
      ]);
      expect(outcome).toBe("refused");
      client.close();
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
