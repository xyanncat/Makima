import { LiveChat } from "youtube-chat";
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

interface YouTubeLiveSearchResponse {
  items?: Array<{
    id?: {
      videoId?: string;
    };
  }>;
}

/** Finds the channel's currently active public live stream without relying on
 * youtube-chat's brittle channel-page HTML parser. */
async function discoverLiveVideoId(
  channelId: string,
  accessToken: string
): Promise<string | null> {
  const params = new URLSearchParams({
    part: "id",
    channelId,
    eventType: "live",
    type: "video",
    maxResults: "1",
  });
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`YouTube live discovery failed (${res.status})`);
  }

  const data = (await res.json()) as YouTubeLiveSearchResponse;
  return data.items?.[0]?.id?.videoId ?? null;
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

/** Starts a self-healing listener and returns an idempotent shutdown function. */
export function startYouTube(ctx: BotContext): () => void {
  const { config, queues, log } = ctx;
  const { channelId } = config.youtube;

  if (!channelId) {
    log("youtube", "warn", "No YOUTUBE_CHANNEL_ID set. Skipping YouTube client.");
    return () => undefined;
  }

  const configuredChannelId = channelId;
  let activeClient: LiveChat | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectDelayMs = 60_000;
  let generation = 0;
  let stopped = false;
  const maxReconnectDelayMs = 300_000;

  const scheduleReconnect = (session: number) => {
    if (stopped || session !== generation || reconnectTimer) return;
    const delay = reconnectDelayMs;
    log("youtube", "info", `Reconnecting YouTube chat client in ${delay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);
      startSession();
    }, delay);
    reconnectTimer.unref();
  };

  const handleChat = async (client: LiveChat, chat: any) => {
    const text: string = chatText(chat.message);
    const author: string = chat.author?.name ?? "unknown";
    const authorId: string = chat.author?.channelId ?? author;
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(config.commandPrefix)) return;

    const prompt = trimmed.slice(config.commandPrefix.length).trim();
    if (prompt.length === 0) return;

    // youtube-chat does not expose YouTube's message id. Its timestamp is stable
    // across a replay, unlike Date.now(), so it still makes deduplication useful.
    const timestamp = chat.timestamp instanceof Date ? chat.timestamp.getTime() : String(chat.timestamp ?? "unknown");
    const messageId = `youtube:${authorId}:${timestamp}:${trimmed}`;
    const guard = await guardMessage(ctx, "youtube", messageId, authorId, prompt);
    if (!guard.ok) return;

    log("youtube", "info", `<${author}>: ${prompt}`);

    queues.youtube.enqueue(async () => {
      const started = Date.now();
      try {
        const activeVideoId = client.liveId;
        if (!activeVideoId) {
          log("youtube", "warn", "No active live video ID found; skipping response.");
          return;
        }
        const accessToken = await ensureYouTubeToken(ctx);
        if (!accessToken) {
          log("youtube", "warn", "(no YouTube credentials) skipping send.");
          return;
        }
        const replyText = await generateResponse(prompt);
        await sendYouTubeMessage(activeVideoId, accessToken, replyText);
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
  };

  async function startSession(): Promise<void> {
    if (stopped) return;
    const session = ++generation;
    const previous = activeClient;
    activeClient = null;
    // Incrementing generation above makes end/error events from the old client inert.
    if (previous) previous.stop("replaced by new session");

    log("youtube", "info", `Discovering active public live stream for channel ${configuredChannelId}...`);
    const accessToken = await ensureYouTubeToken(ctx);
    if (stopped || session !== generation) return;
    if (!accessToken) {
      log("youtube", "warn", "YouTube credentials unavailable; cannot discover the live stream.");
      scheduleReconnect(session);
      return;
    }

    let liveId: string | null;
    try {
      liveId = await discoverLiveVideoId(configuredChannelId, accessToken);
    } catch (err) {
      if (stopped || session !== generation) return;
      log("youtube", "error", `YouTube live discovery failed: ${(err as Error).message}`);
      scheduleReconnect(session);
      return;
    }

    if (stopped || session !== generation) return;
    if (!liveId) {
      log("youtube", "info", "No active public live stream found; retrying discovery.");
      scheduleReconnect(session);
      return;
    }

    const client = new LiveChat({ liveId });
    activeClient = client;
    client.on("chat", (chat: any) => {
      void handleChat(client, chat).catch((err) =>
        log("youtube", "error", `YouTube chat handling failed: ${(err as Error).message}`)
      );
    });
    client.on("error", (err: any) => {
      if (session !== generation || stopped) return;
      log("youtube", "error", `YouTube listener error: ${err?.message ?? err}`);
      scheduleReconnect(session);
    });
    client.on("end", () => {
      if (session !== generation || stopped) return;
      log("youtube", "warn", "YouTube live chat stream ended; looking for the next stream.");
      scheduleReconnect(session);
    });
    void client.start().then((ok: boolean) => {
      if (session !== generation || stopped) return;
      if (ok) {
        reconnectDelayMs = 60_000;
        const label = `channel ${configuredChannelId}`;
        log("youtube", "info", `Listening to YouTube live chat (${label}).`);
      } else {
        log("youtube", "warn", "YouTube live chat did not start after discovery; retrying.");
        scheduleReconnect(session);
      }
    }).catch((err: any) => {
      if (session !== generation || stopped) return;
      log("youtube", "error", `YouTube start failed after discovery: ${err?.message ?? err}`);
      scheduleReconnect(session);
    });
  }

  void startSession();
  return () => {
    stopped = true;
    generation++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    activeClient?.stop("application shutdown");
    activeClient = null;
  };
}
