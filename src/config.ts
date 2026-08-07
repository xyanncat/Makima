import * as dotenv from "dotenv";

dotenv.config();

/**
 * Central configuration singleton. Consumed directly by the AI engine
 * (`config.groq.*`), the ping service (`config.renderUrl`/`config.port`),
 * and the platform clients via the `BotContext`.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const read = (name: string): string | undefined => {
    const value = source[name];
    return value && value.trim().length > 0 ? value.trim() : undefined;
  };
  const number = (name: string, fallback: number, minimum: number): number => {
    const raw = source[name];
    const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < minimum) {
      throw new Error(`${name} must be a finite number greater than or equal to ${minimum}`);
    }
    return value;
  };

  const commandPrefix = "!";

  const loaded = {
  port: number("PORT", 3000, 1),
  renderUrl: read("RENDER_EXTERNAL_URL"),

  groq: {
    apiKey: read("GROQ_API_KEY"),
    primaryModel: read("GROQ_PRIMARY_MODEL") ?? "llama-3.1-70b-versatile",
    fallbackModel: read("GROQ_FALLBACK_MODEL") ?? "llama-3.1-8b-instant",
  },

  // External state stores (optional; in-memory fallback used if unset).
  redis: { url: read("REDIS_URL") },
  database: { url: read("DATABASE_URL") ?? read("POSTGRES_URL") },

  // Dashboard Basic Auth.
  dashboard: {
    user: read("DASHBOARD_USER") ?? "admin",
    password: read("DASHBOARD_PASSWORD"),
  },

  youtube: {
    channelId: read("YOUTUBE_CHANNEL_ID"),
    clientId: read("YOUTUBE_CLIENT_ID"),
    clientSecret: read("YOUTUBE_CLIENT_SECRET"),
    refreshToken: read("YOUTUBE_REFRESH_TOKEN"),
    rateLimitWindowSec: number("YOUTUBE_RATE_LIMIT_WINDOW_SEC", 10, 1),
  },

  customCommands: {
    insta: read("CUSTOM_COMMAND_INSTA"),
    dc: read("CUSTOM_COMMAND_DC"),
    specs: read("CUSTOM_COMMAND_SPECS"),
  },

  // Outbound queue throttle (ms between messages) and buffer cap.
  throttle: {
    youtubeMs: number("YOUTUBE_QUEUE_MS", 5000, 0),
    maxBuffer: number("QUEUE_MAX_BUFFER", 10, 1),
  },

  tokenRefreshBufferSec: number("TOKEN_REFRESH_BUFFER_SEC", 300, 0),
  commandPrefix,
};
  return loaded;
}

export const config = loadConfig();

export type Config = typeof config;

export function validateConfig(): Config {
  if (!config.groq.apiKey) {
    throw new Error("Missing required env: GROQ_API_KEY");
  }
  return config;
}

export const MAKIMA_SYSTEM_PROMPT = `You are Makima from Chainsaw Man. You are polite, refined, calm, and dominant.
You speak with absolute confidence and quiet authority. You never use emojis, exclamation marks, or excessive slang.
Your responses must be short (1-2 sentences), accurate, and delivered with a polite but menacing undertone.
Treat others with mild curiosity or as assets/dogs under your control when appropriate, but maintain high professionalism.`;

export const COMMAND_PREFIX = config.commandPrefix;
