import { BotContext, guardMessage } from "./context";
import { generateResponse } from "./ai";
import type { ConversationTurn } from "./ai";
import { OAuthTokenRecord } from "./db";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CONNECTION_ANNOUNCEMENT = "make sure to like and subscribe";
const youtubeTokenCache = new WeakMap<object, OAuthTokenRecord>();

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

async function youtubeApiError(response: Response, operation: string): Promise<YouTubeApiError> {
  const body = await response.text();
  let reason: string | undefined;
  try {
    const data = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: string }> };
      errors?: Array<{ reason?: string }>;
    };
    reason = data.error?.errors?.[0]?.reason ?? data.errors?.[0]?.reason;
  } catch {
    // Keep the public error concise when the API does not return JSON.
  }

  return new YouTubeApiError(
    `${operation} (${response.status})${reason ? `: ${reason}` : ""}`,
    response.status,
    reason
  );
}

export function isQuotaExceeded(error: unknown): boolean {
  return error instanceof YouTubeApiError
    && error.status === 403
    && error.reason === "quotaExceeded";
}

function isLiveChatUnavailable(error: unknown): boolean {
  return error instanceof YouTubeApiError
    && ["liveChatEnded", "liveChatDisabled", "liveChatNotFound", "notFound"].includes(error.reason ?? "");
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
  offlineAt?: string;
}

type ParsedCommand =
  | { kind: "ai"; prompt: string }
  | { kind: "custom"; key: string; prompt: string; response?: string };

/**
 * Parses one chat message into an AI or configured custom command.
 * Prefixes must be a complete command token, so `!makimabroken` is ignored.
 */
export function parseChatCommand(
  text: string,
  commandPrefix: string,
  customCommands: Record<string, string | undefined>
): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const prefix = commandPrefix.trim().toLowerCase();
  const customCommandKey = lower.startsWith("!")
    ? lower.slice(1).trim()
    : "";

  if (customCommandKey && Object.prototype.hasOwnProperty.call(customCommands, customCommandKey)) {
    return {
      kind: "custom",
      key: customCommandKey,
      prompt: customCommandKey,
      response: customCommands[customCommandKey],
    };
  }

  if (lower !== prefix && !lower.startsWith(`${prefix} `)) return null;

  const prompt = trimmed.slice(commandPrefix.length).trim();
  return prompt ? { kind: "ai", prompt } : null;
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
    throw await youtubeApiError(res, "YouTube live discovery failed");
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
    throw await youtubeApiError(res, "YouTube video lookup failed");
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
    maxResults: "2000",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/liveChat/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw await youtubeApiError(res, "YouTube live chat polling failed");
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
    throw await youtubeApiError(insertRes, "YouTube send");
  }
}

function chatText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";

  return message
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

  const missingYouTubeCredentials = [
    ["YOUTUBE_CLIENT_ID", config.youtube.clientId],
    ["YOUTUBE_CLIENT_SECRET", config.youtube.clientSecret],
    ["YOUTUBE_REFRESH_TOKEN", config.youtube.refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingYouTubeCredentials.length > 0) {
    log(
      "youtube",
      "warn",
      `Missing YouTube credentials: ${missingYouTubeCredentials.join(", ")}. Chat commands cannot receive replies until these are configured.`
    );
  }

  const missingCustomCommands = Object.entries(config.customCommands)
    .filter(([, response]) => !response)
    .map(([key]) => `!${key}`);
  if (missingCustomCommands.length > 0) {
    log(
      "youtube",
      "warn",
      `Custom commands disabled until responses are configured: ${missingCustomCommands.join(", ")}.`
    );
  }

  const configuredChannelId = channelId;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let nextPageToken: string | undefined;
  let reconnectDelayMs = 60_000;
  let quotaBackoffUntil = 0;
  let generation = 0;
  let stopped = false;
  let announcedLiveId: string | null = null;
  const maxReconnectDelayMs = 300_000;
  const quotaBackoffMs = config.youtube.quotaBackoffSec * 1000;
  const conversations = new Map<string, ConversationTurn[]>();
  let activeVideoId: string | null = null;
  let activeLiveChatId: string | null = null;

  const clearPollTimer = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const scheduleReconnect = (session: number, requestedDelayMs?: number) => {
    if (stopped || session !== generation || reconnectTimer) return;
    const delay = Math.max(1_000, requestedDelayMs ?? reconnectDelayMs);
    log("youtube", "info", `Reconnecting YouTube chat listener in ${Math.ceil(delay / 1000)}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (requestedDelayMs === undefined) {
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);
      }
      void startSession();
    }, delay);
    reconnectTimer.unref();
  };

  const pauseForQuota = (session: number, error: unknown) => {
    quotaBackoffUntil = Math.max(quotaBackoffUntil, Date.now() + quotaBackoffMs);
    clearPollTimer();
    log(
      "youtube",
      "error",
      `YouTube quota is exhausted (${(error as Error).message}). Pausing API calls for ${Math.ceil((quotaBackoffUntil - Date.now()) / 60_000)} minutes.`
    );
    scheduleReconnect(session, quotaBackoffUntil - Date.now());
  };

  const handleChat = async (videoId: string, liveChatId: string, chat: any) => {
    const text: string = chatText(chat.message);
    const author: string = chat.author?.name ?? "unknown";
    const authorId: string = chat.author?.channelId ?? author;
    const parsed = parseChatCommand(text, config.commandPrefix, config.customCommands);
    if (!parsed) return;

    const { prompt } = parsed;
    const customCommandKey = parsed.kind === "custom" ? parsed.key : "";
    const customResponse = parsed.kind === "custom" ? parsed.response : undefined;
    if (parsed.kind === "custom" && !customResponse) {
      log("youtube", "warn", `Custom command !${customCommandKey} has no configured response. Set CUSTOM_COMMAND_${customCommandKey.toUpperCase()}.`);
      return;
    }

    const timestamp = chat.timestamp instanceof Date
      ? chat.timestamp.getTime()
      : String(chat.timestamp ?? "unknown");
    const messageId = chat.id
      ? `youtube:${chat.id}`
      : `youtube:${authorId}:${timestamp}:${text.trim()}`;
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
        const history = conversations.get(authorId) ?? [];
        const replyText = customResponse ?? await generateResponse(prompt, history);
        await sendYouTubeMessage(videoId, accessToken, replyText, liveChatId);
        if (parsed.kind === "ai") {
          const updatedHistory: ConversationTurn[] = [
            ...history,
            { role: "user", content: prompt },
            { role: "assistant", content: replyText },
          ];
          conversations.set(authorId, updatedHistory.slice(-8));
        }
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
        if (isQuotaExceeded(err)) {
          pauseForQuota(generation, err);
        }
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

      if (page.offlineAt) {
        activeVideoId = null;
        activeLiveChatId = null;
        nextPageToken = undefined;
        log("youtube", "info", "The live stream ended; clearing cached chat IDs and searching for a new stream.");
        scheduleReconnect(session);
        return;
      }

      nextPageToken = page.nextPageToken;
      for (const item of page.items ?? []) {
        const chat = normalizeLiveChatItem(item);
        if (chat) {
          void handleChat(videoId, liveChatId, chat).catch((err) =>
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
      if (isQuotaExceeded(err)) {
        pauseForQuota(session, err);
        return;
      }
      log("youtube", "error", `YouTube live chat polling failed: ${(err as Error).message}`);
      scheduleReconnect(session);
    }
  };

  async function startSession(): Promise<void> {
    if (stopped) return;
    const session = ++generation;
    clearPollTimer();
    nextPageToken = undefined;

    let liveId = activeVideoId;
    let liveChatId = activeLiveChatId;
    const usingCachedChat = Boolean(liveId && liveChatId);

    if (Date.now() < quotaBackoffUntil) {
      scheduleReconnect(session, quotaBackoffUntil - Date.now());
      return;
    }

    const accessToken = await ensureYouTubeToken(ctx);
    if (stopped || session !== generation) return;
    if (!accessToken) {
      log("youtube", "warn", "YouTube credentials unavailable; cannot discover the live stream.");
      scheduleReconnect(session);
      return;
    }

    if (usingCachedChat) {
      log("youtube", "info", `Resuming cached YouTube live chat ${liveChatId}.`);
    } else {
      log("youtube", "info", `Discovering active public live stream for channel ${configuredChannelId}...`);
      try {
        liveId = await discoverLiveVideoId(configuredChannelId, accessToken);
      } catch (err) {
        if (stopped || session !== generation) return;
        if (isQuotaExceeded(err)) {
          pauseForQuota(session, err);
          return;
        }
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

      try {
        liveChatId = await getActiveLiveChatId(liveId, accessToken);
      } catch (err) {
        if (stopped || session !== generation) return;
        if (isQuotaExceeded(err)) {
          pauseForQuota(session, err);
          return;
        }
        log("youtube", "error", `YouTube live-chat lookup failed: ${(err as Error).message}`);
        scheduleReconnect(session);
        return;
      }
    }

    if (stopped || session !== generation) return;
    if (!liveId || !liveChatId) {
      activeVideoId = null;
      activeLiveChatId = null;
      log("youtube", "warn", "The active stream has no available live chat; retrying discovery.");
      scheduleReconnect(session);
      return;
    }

    activeVideoId = liveId;
    activeLiveChatId = liveChatId;
    reconnectDelayMs = 60_000;
    if (announcedLiveId !== liveId) {
      try {
        await sendYouTubeMessage(liveId, accessToken, CONNECTION_ANNOUNCEMENT, liveChatId);
        announcedLiveId = liveId;
        log("youtube", "info", `Connection announcement sent: ${CONNECTION_ANNOUNCEMENT}`);
      } catch (err) {
        if (isQuotaExceeded(err)) {
          pauseForQuota(session, err);
          return;
        }
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
