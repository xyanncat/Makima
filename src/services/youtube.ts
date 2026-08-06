import { LiveChat } from "youtube-chat";
import { google } from "googleapis";
import { config } from "../config";
import { generateResponse } from "./ai";

let oauth2Client: any = null;
let youtube: any = null;
let activeLiveChatId: string | null = null;
let isWritable = false;

// Initialize official YouTube Data API client if credentials exist
function initYoutubeWriteClient() {
  if (
    config.youtube.clientId &&
    config.youtube.clientSecret &&
    config.youtube.refreshToken
  ) {
    try {
      oauth2Client = new google.auth.OAuth2(
        config.youtube.clientId,
        config.youtube.clientSecret,
        "http://localhost:3000/oauth2callback"
      );
      
      oauth2Client.setCredentials({
        refresh_token: config.youtube.refreshToken,
      });

      youtube = google.youtube({
        version: "v3",
        auth: oauth2Client,
      });
      
      isWritable = true;
      console.log("[YouTube] Official API client initialized. Messages can be sent to chat.");
    } catch (err: any) {
      console.error("[YouTube] Failed to initialize write client:", err.message || err);
      isWritable = false;
    }
  } else {
    console.log("[YouTube] OAuth credentials missing. Running in anonymous READ-ONLY mode.");
    isWritable = false;
  }
}

// Fetch the active liveChatId using the video/live ID
async function fetchLiveChatId(liveId: string): Promise<string | null> {
  if (!youtube) return null;
  try {
    const response = await youtube.videos.list({
      part: ["liveStreamingDetails"],
      id: [liveId],
    });
    
    const liveChatId = response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    return liveChatId || null;
  } catch (error: any) {
    console.error(`[YouTube] Error fetching liveChatId for liveId ${liveId}:`, error.message || error);
    return null;
  }
}

// Post a message using the YouTube Data API
async function sendChatMessage(messageText: string) {
  if (!isWritable || !youtube || !activeLiveChatId) {
    console.log(`[YouTube] [READ-ONLY/PENDING] Message not sent: "${messageText}"`);
    return;
  }
  
  try {
    await youtube.liveChatMessages.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          liveChatId: activeLiveChatId,
          type: "textMessageEvent",
          textMessageDetails: {
            messageText: messageText,
          },
        },
      },
    });
    console.log(`[YouTube] Replied: "${messageText}"`);
  } catch (error: any) {
    console.error("[YouTube] Error inserting chat message:", error.message || error);
  }
}

export function initYoutubeBot() {
  if (!config.youtube.channelId) {
    console.log("[YouTube] YOUTUBE_CHANNEL_ID not set. Skipping YouTube bot initialization.");
    return;
  }

  initYoutubeWriteClient();

  console.log(`[YouTube] Connecting to channel ID: ${config.youtube.channelId}...`);
  const liveChat = new LiveChat({ channelId: config.youtube.channelId });

  liveChat.on("start", async (liveId) => {
    console.log(`[YouTube] Chat listener started for live/video ID: ${liveId}`);
    
    if (isWritable) {
      console.log("[YouTube] Attempting to resolve activeLiveChatId...");
      activeLiveChatId = await fetchLiveChatId(liveId);
      if (activeLiveChatId) {
        console.log(`[YouTube] Resolved activeLiveChatId: ${activeLiveChatId}`);
      } else {
        console.warn("[YouTube] Could not resolve activeLiveChatId. Replies will not be sent.");
      }
    }
  });

  liveChat.on("chat", async (chatItem) => {
    const messageText = chatItem.message.map((m: any) => m.text || "").join("").trim();
    
    if (messageText.startsWith("!makima")) {
      const authorName = chatItem.author.name;
      console.log(`[YouTube] Command trigger from ${authorName}: "${messageText}"`);
      
      const prompt = messageText.slice("!makima".length).trim();
      
      try {
        const response = await generateResponse(prompt || "hello");
        const formattedResponse = `@${authorName} ${response}`;
        
        await sendChatMessage(formattedResponse);
      } catch (error: any) {
        console.error("[YouTube] Failed to generate AI response:", error.message || error);
        await sendChatMessage(`@${authorName} I am busy. Try again later.`);
      }
    }
  });

  liveChat.on("error", (err) => {
    console.error("[YouTube] Scraper error occurred:", err);
  });

  liveChat.on("end", (reason) => {
    console.log(`[YouTube] Chat listener ended: ${reason}. Retrying in 30 seconds...`);
    setTimeout(() => {
      startListener(liveChat);
    }, 30000);
  });

  startListener(liveChat);
}

async function startListener(liveChat: LiveChat) {
  try {
    const started = await liveChat.start();
    if (!started) {
      console.warn("[YouTube] Chat listener failed to start. Re-trying in 30 seconds...");
      setTimeout(() => startListener(liveChat), 30000);
    }
  } catch (error: any) {
    console.error("[YouTube] Exception starting chat listener:", error.message || error);
    setTimeout(() => startListener(liveChat), 30000);
  }
}
