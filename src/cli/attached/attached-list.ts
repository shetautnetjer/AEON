import {
  AppServerClient,
  type AppServerClientOptions,
} from "@/app-server-client";

/** A failed/closed handshake must terminate just like a failed list request. */
export async function listAttachedConversations(
  options: AppServerClientOptions,
  agentId: string,
) {
  const client = new AppServerClient(options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        unsubscribe = client.onDisconnect(() =>
          reject(new Error("App-server socket closed during connection")),
        );
        timer = setTimeout(
          () => reject(new Error("App-server connection timed out")),
          options.requestTimeoutMs ?? 20_000,
        );
      }),
    ]);
    clearTimeout(timer);
    unsubscribe();
    const result = await client.conversationList({
      query: { agent_id: agentId, limit: 50 },
    });
    if (!result.success)
      throw new Error(result.error || "Could not list conversations");
    return result.conversations;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    client.close();
  }
}
