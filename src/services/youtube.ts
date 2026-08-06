import { LiveChat } from "youtube-chat";
import { COMMAND_PREFIX } from "../config";
import { BotContext, guardMessage } from "./context";
import { generateResponse } from "./ai";
import { OAuthTokenRecord } from "./db";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token endpoint (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Returns a valid YouTube access token, transparently refreshing it when the
 * stored token is missing or within the configured refresh buffer.
 */
async function ensureYouTubeToken(ctx: BotContext): Promise<string | null> {
  const now = Date.now();
  const buffer = ctx.config.tokenRefreshBufferSec * 1000;

  const rec = await ctx.store.getToken("youtube");
  if (rec?.access_token && rec.expires_at && rec.expires_at - now > buffer) {
    return rec.access_token;
  }

  const refreshToken = rec?.refresh_token ?? ctx.config.youtube.refreshToken;
  const clientId = rec?.client_id ?? ctx.config.youtube.clientId;
  const clientSecret = rec?.client_secret ?? ctx.config.youtube.clientSecret;

  if (!refreshToken || !clientId || !clientSecret) return null;

  try {
    const tok = await refreshAccessToken(refreshToken, clientId, clientSecret);
    const expiresAt = now + tok.expires_in * 1000;
    const updated: OAuthTokenRecord = {
      platform: "youtube",
      client_id: clientId,
      client_secret: clientSecret,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? refreshToken,
      expires_at: expiresAt,
    };
    await ctx.store.saveToken(updated);
    ctx.log("youtube", "info", `Access token refreshed (expires in ${tok.expires_in}s).`);
    return tok.access_token;
  } catch (err) {
    ctx.log("youtube", "error", `YouTube token refresh failed: ${(err as Error).message}`);
    return null;
  }
}

async function sendYouTubeMessage(
  videoId: string,
  accessToken: string,
  message: string
): Promise<void> {
  const metaRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const meta = (await metaRes.json()) as any;
  const liveChatId = meta?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) {
    throw new Error("No active live chat found for this video.");
  }

  const insertRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText: message },
        },
      }),
    }
  );

  if (!insertRes.ok) {
    throw new Error(`YouTube send (${insertRes.status}): ${await insertRes.text()}`);
  }
}

function chatText(message: any[]): string {
  return (message ?? [])
    .map((m) => (typeof m?.text === "string" ? m.text : m?.emojiText ?? ""))
    .join("");
}

export function startYouTube(ctx: BotContext): void {
  const { config, queues, log } = ctx;
  const { videoId, channelId, channelHandle } = config.youtube;

  if (!videoId && !channelId && !channelHandle) {
    log("youtube", "warn", "No YOUTUBE_VIDEO_ID / YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE set. Skipping YouTube client.");
    return;
  }

  const id = videoId
    ? { liveId: videoId }
    : channelId
    ? { channelId }
    : { handle: channelHandle! };
  const liveId = videoId;

  const client = new LiveChat(id);

  client.on("chat", async (chat: any) => {
    const text: string = chatText(chat.message);
    const author: string = chat.author?.name ?? "unknown";
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const prompt = trimmed.slice(COMMAND_PREFIX.length).trim();
    if (prompt.length === 0) return;

    const messageId = chat.id ?? `${author}:${prompt}:${Date.now()}`;
    const guard = await guardMessage(ctx, "youtube", messageId, author, prompt);
    if (!guard.ok) return;

    log("youtube", "info", `<${author}>: ${prompt}`);

    queues.youtube.enqueue(async () => {
      const started = Date.now();
      try {
        if (!liveId) {
          log("youtube", "warn", "Channel-handle mode requires a video id to send; skipping.");
          return;
        }
        const accessToken = await ensureYouTubeToken(ctx);
        if (!accessToken) {
          log("youtube", "warn", "(no YouTube credentials) skipping send.");
          return;
        }
        const replyText = await generateResponse(prompt);
        await sendYouTubeMessage(liveId, accessToken, replyText);
        log("youtube", "info", `-> ${replyText}`);
        await ctx.store.logCommand({
          platform: "youtube",
          user: author,
          prompt,
          model: "groq",
          latencyMs: Date.now() - started,
          ts: Date.now(),
        });
      } catch (err) {
        log("youtube", "error", `YouTube send error: ${(err as Error).message}`);
        await ctx.store.logCommand({
          platform: "youtube",
          user: author,
          prompt,
          error: (err as Error).message,
          latencyMs: Date.now() - started,
          ts: Date.now(),
        });
      }
    });
  });

  client.on("error", (err: any) => {
    log("youtube", "error", `YouTube listener error: ${err?.message ?? err}`);
  });

  client.on("end", () => {
    log("youtube", "warn", "YouTube live chat stream ended.");
  });

  client
    .start()
    .then((ok: boolean) => {
      if (ok) {
        const label = videoId ? `video ${videoId}` : channelId ? `channel ${channelId}` : `handle ${channelHandle}`;
        log("youtube", "info", `Listening to YouTube live chat (${label}).`);
      } else {
        log("youtube", "warn", "YouTube live chat did not start (stream may be offline).");
      }
    })
    .catch((err: any) => {
      log("youtube", "error", `YouTube start failed: ${err?.message ?? err}`);
    });
}
