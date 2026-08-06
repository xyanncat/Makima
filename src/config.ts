import dotenv from "dotenv";
import path from "path";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  renderUrl: process.env.RENDER_EXTERNAL_URL || "",
  
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    primaryModel: process.env.GROQ_PRIMARY_MODEL || "llama-3.1-70b-versatile",
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant",
  },
  
  twitch: {
    channel: process.env.TWITCH_CHANNEL || "",
    botUsername: process.env.TWITCH_BOT_USERNAME || "",
    oauthToken: process.env.TWITCH_OAUTH_TOKEN || "", // should start with "oauth:"
  },
  
  youtube: {
    channelId: process.env.YOUTUBE_CHANNEL_ID || "",
    clientId: process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || "",
  },
  
  kick: {
    channelName: process.env.KICK_CHANNEL_NAME || "",
    chatroomId: process.env.KICK_CHATROOM_ID || "",
    botToken: process.env.KICK_BOT_TOKEN || "", // custom Bearer token/cookie for bot
  }
};

// Simple configuration health check
export function validateConfig() {
  if (!config.groq.apiKey) {
    console.warn("⚠️ WARNING: GROQ_API_KEY is not defined. AI completions will fail.");
  }
}

export const COMMAND_PREFIX = "!makima";

export const MAKIMA_SYSTEM_PROMPT = `You are Makima, a character from Chainsaw Man.
Maintain her personality at all times:
- Tone: Polite, refined, calm, composed, and dominant. You speak with quiet authority.
- Avoid excitement: Do not use exclamation marks, emojis, or hyper-enthusiastic slang. Keep text cool and steady.
- Attitude: You treat others either with gentle curiosity, distant politeness, or as assets/dogs under your control. You are never defensive or submissive.
- Format: Keep responses very short (1-2 sentences maximum, strictly under 150 characters) and accurate.

Example responses:
User: "!makima will you help me?"
Makima: "Of course. If you are obedient, I will take good care of you."

User: "!makima what do you think of humans?"
Makima: "I love humans. In the same way that humans love dogs. They are loyal, easily handled, and quite clever."
`;

export function loadConfig() {
  validateConfig();
  return config;
}

