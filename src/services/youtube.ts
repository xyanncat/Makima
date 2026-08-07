import { BotContext, guardMessage } from "./context";
import { generateResponse } from "./ai";
import { OAuthTokenRecord } from "./db";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const youtubeTokenCache = new WeakMap<object, OAuthTokenRecord>();

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

  const cached = youtubeTokenCache.get(ctx.store);
  if (cached?.access_token && cached.expires_at && cached.expires_at - now > buffer) {
    return cached.access_token;
  }

  const hasConfiguredCredentials = Boolean(
    ctx.config.youtube.refreshToken
      && ctx.config.youtube.clientId
      && ctx.config.youtube.clientSecret
  );
  const rec = hasConfiguredCredentials ? null : await ctx.store.getToken("youtube");
  if (rec?.access_token && rec.expires_at && rec.expires_at - now > buffer) {
    youtubeTokenCache.set(ctx.store, rec);
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
    youtubeTokenCache.set(ctx.store, updated);
    if (!hasConfiguredCredentials) {
      try {
        await ctx.store.saveToken(updated);
      } catch (err) {
        ctx.log("youtube", "warn", `Token persistence unavailable; using in-memory token cache: ${(err as Error).message}`);
      }
    }
    ctx.log("youtube", "info", `Access token refreshed (expires in ${tok.expires_in}s).`);
    return tok.access_token;
  } catch (err) {
    ctx.log("youtube", "error", `YouTube token refresh failed: ${(err as Error).message}`);
    return null;
  }
}

interface YouTubeLiveChatItem {
  id?: string;
  snippet?: {
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: {
      messageText?: string;
    };
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
  };
}

interface YouTubeLiveChatResponse {
  items?: YouTubeLiveChatItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
}

/** Finds the channel's currently active public live stream through the YouTube API. */
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

  const data = (await res.json()) as {
    items?: Array<{ id?: { videoId?: string } }>;
  };
  return data.items?.[0]?.id?.videoId ?? null;
}

async function getActiveLiveChatId(
  videoId: string,
  accessToken: string
): Promise<string | null> {
  const params = new URLSearchParams({
    part: "liveStreamingDetails",
    id: videoId,
  });
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`YouTube video lookup failed (${res.status})`);
  }

  const data = (await res.json()) as {
    items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
  };
  return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

async function fetchLiveChatMessages(
  liveChatId: string,
  accessToken: string,
  pageToken?: string
): Promise<YouTubeLiveChatResponse> {
  const params = new URLSearchParams({
    liveChatId,
    part: "snippet,authorDetails",
    maxResults: "200",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/liveChat/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`YouTube live chat polling failed (${res.status})`);
  }

  return (await res.json()) as YouTubeLiveChatResponse;
}

async function sendYouTubeMessage(
  videoId: string,
  accessToken: string,
  message: string,
  knownLiveChatId?: string
): Promise<void> {
  const liveChatId = knownLiveChatId ?? await getActiveLiveChatId(videoId, accessToken);
  if (!liveChatId) {
    throw new Error("No active live chat found for this video.");
  }

  const insertRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
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

function normalizeLiveChatItem(item: YouTubeLiveChatItem): any | null {
  const text = item.snippet?.displayMessage
    ?? item.snippet?.textMessageDetails?.messageText
    ?? "";
  if (!text) return null;

  return {
    id: item.id,
    message: [{ text }],
    author: {
      name: item.authorDetails?.displayName ?? "unknown",
      channelId: item.authorDetails?.channelId ?? "unknown",
    },
    timestamp: item.snippet?.publishedAt
      ? new Date(item.snippet.publishedAt)
      : new Date(),
  };
}

/** Starts an API-backed self-healing live-chat poller and returns a shutdown function. */
export function startYouTube(ctx: BotContext): () => void {
  const { config, queues, log } = ctx;
  const { channelId } = config.youtube;

  if (!channelId) {
    log("youtube", "warn", "No YOUTUBE_CHANNEL_ID set. Skipping YouTube client.");
    return () => undefined;
  }

  const configuredChannelId = channelId;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let nextPageToken: string | undefined;
  let reconnectDelayMs = 60_000;
  let generation = 0;
  let stopped = false;
  let announcedLiveId: string | null = null;
  const maxReconnectDelayMs = 300_000;

  const clearPollTimer = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const scheduleReconnect = (session: number) => {
    if (stopped || session !== generation || reconnectTimer) return;
    const delay = reconnectDelayMs;
    log("youtube", "info", `Reconnecting YouTube chat listener in ${delay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);
      void startSession();
    }, delay);
    reconnectTimer.unref();
  };

  const handleChat = async (videoId: string, chat: any) => {
    const text: string = chatText(chat.message);
    const author: string = chat.author?.name ?? "unknown";
    const authorId: string = chat.author?.channelId ?? author;
    const trimmed = text.trim();
    const trimmedLower = trimmed.toLowerCase();
    const customCommandKey = trimmedLower.startsWith("!")
      ? trimmedLower.slice(1).trim()
      : "";
    const isCustomCommand = Object.prototype.hasOwnProperty.call(
      config.customCommands,
      customCommandKey
    );
    const customResponse = config.customCommands[
      customCommandKey as keyof typeof config.customCommands
    ];
    let prompt: string;

    if (isCustomCommand) {
      prompt = customCommandKey;
      if (!customResponse) {
        log("youtube", "warn", `Custom command !${customCommandKey} has no configured response.`);
        return;
      }
    } else {
      if (!trimmedLower.startsWith(config.commandPrefix)) return;
      prompt = trimmed.slice(config.commandPrefix.length).trim();
      if (prompt.length === 0) return;
    }

    const timestamp = chat.timestamp instanceof Date
      ? chat.timestamp.getTime()
      : String(chat.timestamp ?? "unknown");
    const messageId = chat.id
      ? `youtube:${chat.id}`
      : `youtube:${authorId}:${timestamp}:${trimmed}`;
    const guard = await guardMessage(ctx, "youtube", messageId, authorId, prompt);
    if (!guard.ok) return;

    log("youtube", "info", `<${author}>: ${prompt}`);

    queues.youtube.enqueue(async () => {
      const started = Date.now();
      try {
        const accessToken = await ensureYouTubeToken(ctx);
        if (!accessToken) {
          log("youtube", "warn", "(no YouTube credentials) skipping send.");
          return;
        }
        const replyText = customResponse ?? await generateResponse(prompt);
        await sendYouTubeMessage(videoId, accessToken, replyText);
        log(
          "youtube",
          "info",
          customResponse ? `-> custom command !${customCommandKey}` : `-> ${replyText}`
        );
        await ctx.store.logCommand({
          platform: "youtube",
          user: author,
          prompt,
          model: customResponse ? `custom:${customCommandKey}` : "groq",
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

  const pollChat = async (
    session: number,
    videoId: string,
    liveChatId: string
  ): Promise<void> => {
    if (stopped || session !== generation) return;

    try {
      const accessToken = await ensureYouTubeToken(ctx);
      if (!accessToken) {
        log("youtube", "warn", "YouTube credentials unavailable; stopping chat polling.");
        scheduleReconnect(session);
        return;
      }

      const page = await fetchLiveChatMessages(liveChatId, accessToken, nextPageToken);
      if (stopped || session !== generation) return;

      nextPageToken = page.nextPageToken;
      for (const item of page.items ?? []) {
        const chat = normalizeLiveChatItem(item);
        if (chat) {
          void handleChat(videoId, chat).catch((err) =>
            log("youtube", "error", `YouTube chat handling failed: ${(err as Error).message}`)
          );
        }
      }

      const delay = Math.max(
        1_000,
        Math.min(page.pollingIntervalMillis ?? 5_000, 60_000)
      );
      pollTimer = setTimeout(() => {
        pollTimer = null;
        void pollChat(session, videoId, liveChatId);
      }, delay);
      pollTimer.unref();
    } catch (err) {
      if (stopped || session !== generation) return;
      pollTimer = null;
      log("youtube", "error", `YouTube live chat polling failed: ${(err as Error).message}`);
      scheduleReconnect(session);
    }
  };

  async function startSession(): Promise<void> {
    if (stopped) return;
    const session = ++generation;
    clearPollTimer();
    nextPageToken = undefined;

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

    let liveChatId: string | null;
    try {
      liveChatId = await getActiveLiveChatId(liveId, accessToken);
    } catch (err) {
      if (stopped || session !== generation) return;
      log("youtube", "error", `YouTube live-chat lookup failed: ${(err as Error).message}`);
      scheduleReconnect(session);
      return;
    }

    if (stopped || session !== generation) return;
    if (!liveChatId) {
      log("youtube", "warn", "The active stream has no available live chat; retrying discovery.");
      scheduleReconnect(session);
      return;
    }

    reconnectDelayMs = 60_000;
    if (announcedLiveId !== liveId) {
      try {
        await sendYouTubeMessage(liveId, accessToken, "i am live", liveChatId);
        announcedLiveId = liveId;
        log("youtube", "info", "Connection announcement sent: i am live");
      } catch (err) {
        log("youtube", "warn", `Connection announcement failed: ${(err as Error).message}`);
      }
    }
    log("youtube", "info", `Listening to YouTube live chat (channel ${configuredChannelId}).`);
    void pollChat(session, liveId, liveChatId);
  }

  void startSession();
  return () => {
    stopped = true;
    generation++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearPollTimer();
  };
}
