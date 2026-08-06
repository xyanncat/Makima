import tmi from "tmi.js";
import { config } from "../config";
import { generateResponse } from "./ai";

export function initTwitchBot() {
  if (!config.twitch.channel) {
    console.log("[Twitch] TWITCH_CHANNEL not set. Skipping Twitch bot initialization.");
    return;
  }

  const channel = config.twitch.channel.toLowerCase();
  
  // Choose anonymous/read-only if OAuth details are missing
  const isWritable = !!(config.twitch.botUsername && config.twitch.oauthToken);
  
  const clientOptions: any = {
    options: { debug: false },
    connection: {
      reconnect: true,
      secure: true,
    },
    channels: [channel],
  };

  if (isWritable) {
    clientOptions.identity = {
      username: config.twitch.botUsername,
      password: config.twitch.oauthToken, // Should be format "oauth:xxxxxx"
    };
    console.log(`[Twitch] Initializing bot as user: ${config.twitch.botUsername}`);
  } else {
    console.log(`[Twitch] Initializing bot in anonymous READ-ONLY mode for channel: ${channel}`);
  }

  const client = new tmi.Client(clientOptions);

  client.on("message", async (targetChannel: string, tags: any, message: string, self: boolean) => {
    if (self) return; // Ignore messages from the bot itself

    const normalizedMsg = message.trim();
    if (normalizedMsg.startsWith("!makima")) {
      const user = tags["display-name"] || tags.username || "Guest";
      console.log(`[Twitch] Command trigger in ${targetChannel} from ${user}: "${normalizedMsg}"`);
      
      // Extract prompt
      const prompt = normalizedMsg.slice("!makima".length).trim();
      
      try {
        const response = await generateResponse(prompt || "hello");
        const formattedResponse = `@${user}, ${response}`;
        
        if (isWritable) {
          client.say(targetChannel, formattedResponse);
          console.log(`[Twitch] Replied: "${formattedResponse}"`);
        } else {
          console.log(`[Twitch] [READ-ONLY] Would reply: "${formattedResponse}"`);
        }
      } catch (error: any) {
        console.error("[Twitch] Failed to generate AI response:", error.message || error);
        if (isWritable) {
          client.say(targetChannel, `@${user}, I am currently busy. Please try again later.`);
        }
      }
    }
  });

  client.on("connected", (address: string, port: number) => {
    console.log(`[Twitch] Connected to Twitch IRC at ${address}:${port}`);
  });

  client.on("disconnected", (reason: string) => {
    console.warn(`[Twitch] Disconnected: ${reason}`);
  });

  client.connect().catch((err: any) => {
    console.error("[Twitch] Connection error:", err);
  });
}
