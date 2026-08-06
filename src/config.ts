import * as dotenv from "dotenv";

dotenv.config();

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Central configuration singleton. Consumed directly by the AI engine
 * (`config.groq.*`), the ping service (`config.renderUrl`/`config.port`),
 * and the platform clients via the `BotContext`.
 */
export const config = {
  port: Number(process.env.PORT ?? "3000"),
  renderUrl: env("RENDER_EXTERNAL_URL"),

  groq: {
    apiKey: env("GROQ_API_KEY"),
    primaryModel: env("GROQ_PRIMARY_MODEL") ?? "llama-3.1-70b-versatile",
    fallbackModel: env("GROQ_FALLBACK_MODEL") ?? "llama-3.1-8b-instant",
  },

  // External state stores (optional; in-memory fallback used if unset).
  redis: { url: env("REDIS_URL") },
  database: { url: env("DATABASE_URL") ?? env("POSTGRES_URL") },

  // Dashboard Basic Auth.
  dashboard: {
    user: env("DASHBOARD_USER") ?? "admin",
    password: env("DASHBOARD_PASSWORD"),
  },

  youtube: {
    videoId: env("YOUTUBE_VIDEO_ID"),
    channelId: env("YOUTUBE_CHANNEL_ID"),
    channelHandle: env("YOUTUBE_CHANNEL_HANDLE"),
    clientId: env("YOUTUBE_CLIENT_ID"),
    clientSecret: env("YOUTUBE_CLIENT_SECRET"),
    refreshToken: env("YOUTUBE_REFRESH_TOKEN"),
  },

  // Outbound queue throttle (ms between messages) and buffer cap.
  throttle: {
    youtubeMs: Number(process.env.YOUTUBE_QUEUE_MS ?? "5000"),
    maxBuffer: Number(process.env.QUEUE_MAX_BUFFER ?? "10"),
  },

  tokenRefreshBufferSec: Number(process.env.TOKEN_REFRESH_BUFFER_SEC ?? "300"),
};

export type Config = typeof config;

export function loadConfig(): Config {
  if (!config.groq.apiKey) {
    throw new Error("Missing required env: GROQ_API_KEY");
  }
  return config;
}

export const MAKIMA_SYSTEM_PROMPT = `You are Makima from Chainsaw Man. You are polite, refined, calm, and dominant.
You speak with absolute confidence and quiet authority. You never use emojis, exclamation marks, or excessive slang.
Your responses must be short (1-2 sentences), accurate, and delivered with a polite but menacing undertone.
Treat others with mild curiosity or as assets/dogs under your control when appropriate, but maintain high professionalism.`;

export const COMMAND_PREFIX = "!makima";
