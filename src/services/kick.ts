import WebSocket from "ws";
import { COMMAND_PREFIX } from "../config";
import { BotContext, guardMessage } from "./context";
import { generateResponse } from "./ai";
import { OAuthTokenRecord } from "./db";

const KICK_PUSHER_KEY = "eb1d5f283081a78b932c";
const KICK_PUSHER_HOST = "ws-us2.pusher.com";
const KICK_CHAT_EVENT = "App\\Events\\ChatMessageSent";
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

interface KickChatPayload {
  id?: string;
  chatroom_id?: number;
  sender?: { username?: string };
  content?: string;
  message?: string;
}

function decodeKickPayload(raw: unknown): KickChatPayload | null {
  if (typeof raw === "string") {
    try {
      const json = Buffer.from(raw, "base64").toString("utf8");
      return JSON.parse(json) as KickChatPayload;
    } catch {
      try {
        return JSON.parse(raw) as KickChatPayload;
      } catch {
        return null;
      }
    }
  }
  if (raw && typeof raw === "object") return raw as KickChatPayload;
  return null;
}

async function ensureKickToken(ctx: BotContext): Promise<string | null> {
  const { config, store, log } = ctx;
  const now = Date.now();
  const buffer = config.tokenRefreshBufferSec * 1000;

  const rec = await store.getToken("kick");
  if (rec?.access_token && rec.expires_at && rec.expires_at - now > buffer) {
    return rec.access_token;
  }

  const clientId = rec?.client_id ?? config.kick.clientId;
  const clientSecret = rec?.client_secret ?? config.kick.clientSecret;

  if (clientId && clientSecret) {
    try {
      const res = await fetch(KICK_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token: string; expires_in?: number };
        const expiresAt = now + (data.expires_in ?? 3600) * 1000;
        await store.saveToken({
          platform: "kick",
          client_id: clientId,
          client_secret: clientSecret,
          access_token: data.access_token,
          expires_at: expiresAt,
        });
        log("kick", "info", "Access token refreshed via client credentials.");
        return data.access_token;
      }
      log("kick", "warn", `Kick token refresh returned (${res.status}); falling back to static token.`);
    } catch (err) {
      log("kick", "error", `Kick token refresh failed: ${(err as Error).message}`);
    }
  }

  return config.kick.bearerToken ?? null;
}

async function sendKickMessage(
  chatroomId: string,
  bearerToken: string,
  message: string
): Promise<void> {
  const res = await fetch("https://kick.com/api/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
      type: "message",
      chatroom_id: Number(chatroomId),
    }),
  });
  if (!res.ok) {
    throw new Error(`Kick send (${res.status}): ${await res.text()}`);
  }
}

export function startKick(ctx: BotContext): void {
  const { config, queues, log } = ctx;
  const { chatroomId } = config.kick;
  if (!chatroomId) {
    log("kick", "warn", "KICK_CHATROOM_ID not set. Skipping Kick client.");
    return;
  }

  const channelName = `chatrooms.${chatroomId}.v2`;
  let ws: WebSocket | null = null;
  let backoff = 2000;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    const url = `wss://${KICK_PUSHER_HOST}/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
    ws = new WebSocket(url);

    ws.on("open", () => {
      backoff = 2000;
      ws!.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel: channelName } }));
      log("kick", "info", `Connected to Kick Pusher (${channelName}).`);
    });

    ws.on("message", (data: WebSocket.RawData) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (parsed.event === "pusher:ping") {
        ws!.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        return;
      }
      if (parsed.event !== KICK_CHAT_EVENT) return;

      const payload = decodeKickPayload(parsed.data);
      if (!payload) return;

      const text: string = payload.content ?? payload.message ?? "";
      const author: string = payload.sender?.username ?? "unknown";
      const trimmed = text.trim();
      if (!trimmed.toLowerCase().startsWith(COMMAND_PREFIX)) return;

      const prompt = trimmed.slice(COMMAND_PREFIX.length).trim();
      if (prompt.length === 0) return;

      const messageId = payload.id ?? `${author}:${prompt}:${Date.now()}`;
      void (async () => {
        const guard = await guardMessage(ctx, "kick", messageId, author, prompt);
        if (!guard.ok) return;
        log("kick", "info", `<${author}>: ${prompt}`);

        queues.kick.enqueue(async () => {
          const started = Date.now();
          try {
            const token = await ensureKickToken(ctx);
            if (!token) {
              log("kick", "warn", "(no Kick credentials) skipping send.");
              return;
            }
            const replyText = await generateResponse(prompt);
            await sendKickMessage(chatroomId, token, replyText);
            log("kick", "info", `-> ${replyText}`);
            await ctx.store.logCommand({
              platform: "kick",
              user: author,
              prompt,
              model: "groq",
              latencyMs: Date.now() - started,
              ts: Date.now(),
            });
          } catch (err) {
            log("kick", "error", `Kick send error: ${(err as Error).message}`);
            await ctx.store.logCommand({
              platform: "kick",
              user: author,
              prompt,
              error: (err as Error).message,
              latencyMs: Date.now() - started,
              ts: Date.now(),
            });
          }
        });
      })();
    });

    ws.on("close", () => {
      if (stopped) return;
      log("kick", "warn", `Kick connection closed. Reconnecting in ${backoff / 1000}s.`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5 * 60 * 1000);
    });

    ws.on("error", (err: Error) => {
      log("kick", "error", `Kick socket error: ${err.message}`);
    });
  };

  connect();
}
