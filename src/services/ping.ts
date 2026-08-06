import axios from "axios";
import { config } from "../config";

export function startAutoPing(): () => void {
  let url = config.renderUrl;
  if (url) {
    // Health is intentionally public so Render or an external monitor can check it.
    url = url.endsWith("/health") ? url : `${url.replace(/\/$/, "")}/health`;
  } else {
    url = `http://127.0.0.1:${config.port}/health`;
  }
  
  if (!config.renderUrl) {
    console.log(`[Ping] RENDER_EXTERNAL_URL is not set. Defaulting to local health check: ${url}`);
  } else {
    console.log(`[Ping] Starting auto-ping service target: ${url}`);
  }

  // Ping immediately on start
  pingServer(url);

  // Ping every 10 minutes (600,000 milliseconds)
  const timer = setInterval(() => {
    pingServer(url);
  }, 10 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

async function pingServer(url: string) {
  try {
    const start = Date.now();
    const response = await axios.get(url, { 
      timeout: 10000,
      headers: { "User-Agent": "MakimaBotHealthCheck/1.0" }
    });
    const duration = Date.now() - start;
    console.log(`[Ping] Auto-ping succeeded: GET ${url} -> Status ${response.status} (${duration}ms)`);
  } catch (error: any) {
    console.error(`[Ping] Auto-ping failed for ${url}:`, error.message || error);
  }
}
