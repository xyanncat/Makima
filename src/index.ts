import express from "express";
import path from "path";
import { validateConfig } from "./config";
import { createStateStore } from "./services/db";
import { createQueues } from "./services/queue";
import { startAutoPing } from "./services/ping";
import { startYouTube } from "./services/youtube";
import { LogLine, LogSink, makeLog } from "./services/types";
import { BotContext } from "./services/context";

const MAX_LOGS = 200;
const logs: LogLine[] = [];

function basicAuthMiddleware(user: string, password?: string) {
  // If no password is configured, leave the dashboard open but warn (local dev).
  if (!password) {
    console.warn("[auth] DASHBOARD_PASSWORD not set; dashboard is unprotected.");
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  }
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers["authorization"];
    if (!header || !header.startsWith("Basic ")) {
      res.set("WWW-Authenticate", 'Basic realm="Makima Dashboard"');
      res.status(401).send("Authentication required.");
      return;
    }
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const u = separator < 0 ? "" : decoded.slice(0, separator);
    const p = separator < 0 ? "" : decoded.slice(separator + 1);
    if (u === user && p === password) {
      next();
    } else {
      res.set("WWW-Authenticate", 'Basic realm="Makima Dashboard"');
      res.status(401).send("Invalid credentials.");
    }
  };
}

async function main() {
  let config;
  try {
    config = validateConfig();
  } catch (err) {
    console.error("Failed to load configuration:", (err as Error).message);
    process.exit(1);
  }

  const store = await createStateStore(config);

  const logSink: LogSink = (platform, level, message) => {
    const line: LogLine = { ts: Date.now(), platform, level, message };
    logs.push(line);
    if (logs.length > MAX_LOGS) logs.shift();
    const prefix = `[${platform}]`;
    const fn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(prefix, message);
  };
  const log = makeLog(logSink);

  const queues = createQueues(config.throttle, log);

  const ctx: BotContext = { config, store, queues, log };

  log("system", "info", "Starting Makima Live Stream AI Chatbot (YouTube-only production build)...");

  // Process-level watchdog: keep the daemon alive on unexpected errors.
  process.on("unhandledRejection", (reason) => {
    log("system", "error", `Unhandled rejection: ${String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    log("system", "error", `Uncaught exception: ${err.message}`);
  });

  const app = express();
  app.use(express.json());

  const auth = basicAuthMiddleware(config.dashboard.user, config.dashboard.password);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/", auth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.get("/api/status", auth, (_req, res) => {
    const statusOf = (configured: boolean) => (configured ? "online" : "offline");
    res.json({
      youtube: {
        status: statusOf(Boolean(config.youtube.channelId)),
        channelId: config.youtube.channelId ?? "Not configured",
        mode: "Channel ID discovery + LiveChat Listener + API Sender",
      },
      ai: {
        primary: config.groq.primaryModel,
        fallback: config.groq.fallbackModel,
      },
      logs: logs.slice(-MAX_LOGS).map((l) => `[${l.platform}] ${l.message}`),
    });
  });

  app.get("/ping", (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  const server = app.listen(config.port, () => {
    log("system", "info", `Dashboard listening on http://localhost:${config.port}`);
  });

  const stopPing = startAutoPing();
  const stopYouTube = startYouTube(ctx);
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("system", "info", `${signal} received; shutting down.`);
    stopPing();
    stopYouTube();
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main();
