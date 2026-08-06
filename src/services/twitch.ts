import tmi from "tmi.js";
import { COMMAND_PREFIX } from "../config";
import { BotContext, guardMessage } from "./context";
import { generateResponse } from "./ai";
import { LogSink } from "./types";

export function startTwitch(ctx: BotContext): void {
  const { config, queues, log } = ctx;
  const { username, oauthToken, channel } = config.twitch;
  if (!username || !oauthToken || !channel) {
    log("twitch", "warn", "Twitch credentials incomplete. Skipping Twitch client.");
    return;
  }

  const client: any = tmi.Client({
    identity: {
      username,
      password: oauthToken,
    },
    channels: [channel],
  });

  client.on("message", async (channelName: string, _tags: any, message: string, self: boolean) => {
    if (self) return;
    const trimmed = message.trim();
    if (!trimmed.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const prompt = trimmed.slice(COMMAND_PREFIX.length).trim();
    if (prompt.length === 0) return;

    const author = (_tags?.["display-name"] as string) ?? "unknown";
    const messageId = (_tags?.id as string) ?? `${author}:${prompt}:${Date.now()}`;

    const guard = await guardMessage(ctx, "twitch", messageId, author, prompt);
    if (!guard.ok) return;

    log("twitch", "info", `<${author}>: ${prompt}`);

    queues.twitch.enqueue(async () => {
      const started = Date.now();
      try {
        const replyText = await generateResponse(prompt);
        await client.say(channelName, replyText);
        log("twitch", "info", `-> ${replyText}`);
        await ctx.store.logCommand({
          platform: "twitch",
          user: author,
          prompt,
          model: "groq",
          latencyMs: Date.now() - started,
          ts: Date.now(),
        });
      } catch (err) {
        log("twitch", "error", `AI error: ${(err as Error).message}`);
        await ctx.store.logCommand({
          platform: "twitch",
          user: author,
          prompt,
          error: (err as Error).message,
          latencyMs: Date.now() - started,
          ts: Date.now(),
        });
      }
    });
  });

  client.on("connected", (addr: string) => {
    log("twitch", "info", `Connected to Twitch at ${addr} (channel: ${channel})`);
  });

  client.on("disconnected", (reason: string) => {
    log("twitch", "warn", `Twitch disconnected: ${reason}`);
  });

  client.connect().catch((err: any) => {
    log("twitch", "error", `Twitch connect failed: ${(err as Error).message}`);
  });
}
