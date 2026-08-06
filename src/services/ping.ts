import axios from "axios";
import { config } from "../config";

export function startAutoPing() {
  const url = config.renderUrl || `http://localhost:${config.port}/ping`;
  
  if (!config.renderUrl) {
    console.log(`[Ping] RENDER_EXTERNAL_URL is not set. Defaulting to local ping: ${url}`);
  } else {
    console.log(`[Ping] Starting auto-ping service target: ${url}`);
  }

  // Ping immediately on start
  pingServer(url);

  // Ping every 10 minutes (600,000 milliseconds)
  setInterval(() => {
    pingServer(url);
  }, 10 * 60 * 1000);
}

async function pingServer(url: string) {
  try {
    const start = Date.now();
    const response = await axios.get(url, { timeout: 10000 });
    const duration = Date.now() - start;
    console.log(`[Ping] Auto-ping succeeded: GET ${url} -> Status ${response.status} (${duration}ms)`);
  } catch (error: any) {
    console.error(`[Ping] Auto-ping failed for ${url}:`, error.message || error);
  }
}
