import WebSocket from "ws";
import axios from "axios";
import { config } from "../config";
import { generateResponse } from "./ai";

const PUSHER_KEY = "eb1d5f283081a78b932c";
const PUSHER_CLUSTER = "us2";

let ws: WebSocket | null = null;
let isWritable = false;
let resolvedChatroomId: string | null = null;

// Initialize Kick sending status
function initKickWriteClient() {
  if (config.kick.botToken) {
    isWritable = true;
    console.log("[Kick] Bot token detected. Messages can be sent to Kick chat.");
  } else {
    console.log("[Kick] Bot token missing. Running in READ-ONLY mode on Kick.");
    isWritable = false;
  }
}

// Fetch Kick Chatroom ID from channel username (with User-Agent to help bypass simple checks)
async function getChatroomId(channelName: string): Promise<string> {
  if (config.kick.chatroomId) {
    return config.kick.chatroomId;
  }
  
  try {
    console.log(`[Kick] Attempting to auto-resolve Chatroom ID for channel: ${channelName}`);
    const response = await axios.get(`https://kick.com/api/v2/channels/${channelName}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    
    const chatroomId = response.data?.chatroom?.id;
    if (chatroomId) {
      return String(chatroomId);
    }
    throw new Error("Chatroom ID not found in payload");
  } catch (error: any) {
    throw new Error(
      `Failed to resolve Kick Chatroom ID for "${channelName}". ` +
      `Error: ${error.message}. Please define KICK_CHATROOM_ID manually in your environment variables.`
    );
  }
}

// Send message to Kick chat via HTTP request
async function sendKickMessage(chatroomId: string, messageText: string) {
  if (!isWritable || !config.kick.botToken) {
    console.log(`[Kick] [READ-ONLY] Message not sent: "${messageText}"`);
    return;
  }

  // Support both official endpoint and unofficial v2 endpoint
  // Unofficial: https://kick.com/api/v2/messages
  // Official: https://api.kick.com/public/v1/chat (if using developer account)
  const isOfficialToken = config.kick.botToken.startsWith("sk_");
  const url = isOfficialToken 
    ? "https://api.kick.com/public/v1/chat"
    : `https://kick.com/api/v2/messages`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Authorization": config.kick.botToken.startsWith("Bearer ") 
      ? config.kick.botToken 
      : `Bearer ${config.kick.botToken}`
  };

  const body = isOfficialToken
    ? { content: messageText, type: "bot" }
    : { content: messageText, type: "message", chatroom_id: parseInt(chatroomId, 10) };

  try {
    const res = await axios.post(url, body, { headers });
    console.log(`[Kick] Replied: "${messageText}" (Status ${res.status})`);
  } catch (error: any) {
    console.error("[Kick] Error sending message:", error.response?.data || error.message);
  }
}

export async function initKickBot() {
  if (!config.kick.channelName) {
    console.log("[Kick] KICK_CHANNEL_NAME not set. Skipping Kick bot initialization.");
    return;
  }

  initKickWriteClient();

  try {
    resolvedChatroomId = await getChatroomId(config.kick.channelName);
    console.log(`[Kick] Resolved Chatroom ID: ${resolvedChatroomId}. Connecting to WebSockets...`);
    connectToPusher(resolvedChatroomId);
  } catch (err: any) {
    console.error(`[Kick] Initialization failed:`, err.message || err);
  }
}

function connectToPusher(chatroomId: string) {
  const wsUrl = `wss://ws-${PUSHER_CLUSTER}.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
  
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[Kick] Connected to Pusher WebSocket");
    
    // Subscribe to chatroom channel
    const subscribePayload = {
      event: "pusher:subscribe",
      data: {
        channel: `chatrooms.${chatroomId}.v2`
      }
    };
    
    ws?.send(JSON.stringify(subscribePayload));
    console.log(`[Kick] Subscribed to channel chatrooms.${chatroomId}.v2`);
  });

  ws.on("message", async (data: string) => {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.event === "App\\Events\\ChatMessageEvent") {
        const chatItem = JSON.parse(parsed.data);
        const username = chatItem.sender?.username;
        const messageText = (chatItem.content || "").trim();

        if (messageText.startsWith("!makima")) {
          console.log(`[Kick] Command trigger from ${username}: "${messageText}"`);
          
          const prompt = messageText.slice("!makima".length).trim();
          
          try {
            const response = await generateResponse(prompt || "hello");
            const formattedResponse = `@${username} ${response}`;
            
            await sendKickMessage(chatroomId, formattedResponse);
          } catch (error: any) {
            console.error("[Kick] Failed to generate AI response:", error.message || error);
            await sendKickMessage(chatroomId, `@${username} I'm currently busy. Try again later.`);
          }
        }
      }
    } catch (e: any) {
      // Ignore parsing errors of non-chat events (like connection messages)
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[Kick] Connection closed (${code}): ${reason || "No reason"}. Reconnecting in 10s...`);
    setTimeout(() => connectToPusher(chatroomId), 10000);
  });

  ws.on("error", (err) => {
    console.error("[Kick] WebSocket error:", err.message || err);
  });
}
