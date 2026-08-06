import express from "express";
import path from "path";
import { config, validateConfig } from "./config";
import { startAutoPing } from "./services/ping";
import { initTwitchBot } from "./services/twitch";
import { initYoutubeBot } from "./services/youtube";
import { initKickBot } from "./services/kick";

// Create Express app
const app = express();

// Log capture system to display logs in real-time on the status dashboard
const logs: string[] = [];
const MAX_LOGS = 50;

function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  logs.push(`[${timestamp}] ${msg}`);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

// Intercept system logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
  originalLog(...args);
  addLog(msg);
};

console.error = (...args: any[]) => {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
  originalError(...args);
  addLog(`❌ ERROR: ${msg}`);
};

console.warn = (...args: any[]) => {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
  originalWarn(...args);
  addLog(`⚠️ WARN: ${msg}`);
};

// Validate environment config on start
validateConfig();

// Serve static dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "src", "public", "index.html"));
});

// Ping endpoint for keep-alive and health checks
app.get("/ping", (req, res) => {
  res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// Status API for frontend updates
app.get("/api/status", (req, res) => {
  res.json({
    twitch: {
      status: config.twitch.channel ? "online" : "offline",
      channel: config.twitch.channel,
      mode: (config.twitch.botUsername && config.twitch.oauthToken) ? "Read/Write" : "Read-Only"
    },
    youtube: {
      status: config.youtube.channelId ? "online" : "offline",
      channelId: config.youtube.channelId,
      mode: (config.youtube.clientId && config.youtube.clientSecret && config.youtube.refreshToken) ? "Read/Write" : "Read-Only"
    },
    kick: {
      status: config.kick.channelName ? "online" : "offline",
      channelName: config.kick.channelName,
      mode: config.kick.botToken ? "Read/Write" : "Read-Only"
    },
    ai: {
      primary: config.groq.primaryModel,
      fallback: config.groq.fallbackModel
    },
    logs: logs.slice().reverse()
  });
});

// Start Express server
app.listen(config.port, "0.0.0.0", () => {
  console.log(`==================================================`);
  console.log(`🚀 Makima Chatbot server started on port ${config.port}`);
  console.log(`==================================================`);
  
  // Start Keep-Alive Auto-Ping Service
  startAutoPing();
  
  // Initialize stream integrations
  initTwitchBot();
  initYoutubeBot();
  initKickBot();
});
