# Implementation Plan - Makima Live Stream AI Chatbot

This plan details the architecture, features, and step-by-step implementation for building a multi-platform AI live stream chatbot connected to **Twitch**, **YouTube**, and **Kick** live streams.

The chatbot features the personality of **Makima** from *Chainsaw Man*, processes commands starting with `!makima`, uses Groq/OpenRouter for AI generation with model fallback, and is hosted on a free Render Web Service with self-ping capability to keep it active.

---

## User Review Required

> [!IMPORTANT]
> **API Keys & Credentials:**
> To connect and post to Twitch, YouTube, and Kick, the bot requires specific credentials for each platform. For production, these will be stored securely in the **Render Environment Variables**.
> - **Twitch:** Requires a Twitch account OAuth token (`oauth:xxxxxx`).
> - **YouTube:** Reading chat can be done via scraping without keys, but **writing** to YouTube chat requires a Google Cloud project with OAuth2 credentials (refresh token).
> - **Kick:** Reading is done via public Pusher WebSockets (no key needed). **Writing** to Kick requires an official Kick developer account API credentials (`Client ID`/`Secret`) or account-level tokens.
> - **Groq:** Requires a Groq API key (`GROQ_API_KEY`).

---

## User Decisions & Architecture Paths

- **Kick Chat Messages (Option C):** We will build a custom HTTP client that sends messages to Kick using the bot account's authentication token (`Authorization: Bearer <token>` or session cookies) to bypass developer account restriction.
- **YouTube OAuth Setup:** Since you don't have OAuth credentials set up yet, we will:
  1. Add a step-by-step guide on how to create a Google Cloud Project, enable the YouTube Data API v3, and get a Client ID/Secret.
  2. Include a CLI utility script `npm run get-yt-token` in the project to automatically spin up a temporary server, guide you through the login flow, and print out the required `YOUTUBE_REFRESH_TOKEN` for your `.env` file.

---

## Proposed Changes

We will build the application in a new Node.js project using **TypeScript** for safety and modern development practices.

```
makima/
├── src/
│   ├── index.ts               # Application entry point
│   ├── config.ts              # Env config and validation
│   ├── services/
│   │   ├── ai.ts              # AI Engine using Groq API + Fallback
│   │   ├── ping.ts            # Render auto-ping task
│   │   ├── twitch.ts          # Twitch Chat listener and sender
│   │   ├── youtube.ts         # YouTube Chat listener and sender
│   │   └── kick.ts            # Kick Chat listener and sender
│   └── public/
│       └── index.html         # Status Dashboard page
├── .env.example
├── package.json
└── tsconfig.json
```

---

### Component Details

#### 1. Core Server & Auto-Ping (`src/index.ts` & `src/services/ping.ts`)
- Starts an Express server serving a simple, clean status page.
- Exposes `/ping` and `/health` endpoints.
- Auto-ping logic: Pings the external URL (e.g. `https://your-service.onrender.com/ping`) every 10 minutes to prevent Render's free tier from sleeping.

#### 2. AI Service (`src/services/ai.ts`)
- Configured exclusively to use the Groq API endpoint (`https://api.groq.com/openai/v1`) using standard OpenAI client.
- Implements fallback logic between the configured primary and secondary Groq models.
- Since model availability on Groq can vary, the model names are fully configurable via env variables (`GROQ_PRIMARY_MODEL` and `GROQ_FALLBACK_MODEL`), defaulting to:
  - Primary: `llama-3.1-70b-versatile` (or the user-specified custom model if compatible/routed)
  - Fallback: `llama-3.1-8b-instant` (or user's secondary fallback)
- Uses a **Makima System Prompt**:
  ```
  You are Makima from Chainsaw Man. You are polite, refined, calm, and dominant.
  You speak with absolute confidence and quiet authority. You never use emojis, exclamation marks, or excessive slang.
  Your responses must be short (1-2 sentences), accurate, and delivered with a polite but menacing undertone.
  Treat others with mild curiosity or as assets/dogs under your control when appropriate, but maintain high professionalism.
  ```

#### 3. Twitch Client (`src/services/twitch.ts`)
- Uses `tmi.js` to connect to Twitch IRC.
- Listens to the target channel. On message starting with `!makima`, queries the AI and replies to the chat.

#### 4. YouTube Client (`src/services/youtube.ts`)
- Uses a scraping library like `masterchat` or `youtubei.js` to poll the live chat stream without exhausting Google API quota limits.
- On detecting `!makima`, queries the AI.
- If OAuth refresh tokens are configured, sends the reply using the official YouTube Data API (`liveChatMessages.insert`).

#### 5. Kick Client (`src/services/kick.ts`)
- Connects directly to Kick's Pusher WebSocket server (`wss://ws-us2.pusher.com`).
- Listens to `chatrooms.{chatroom_id}.v2` for new message events.
- On detecting `!makima`, queries the AI.
- If Kick API credentials are configured, sends a message back to the chat.

---

## Verification Plan

### Automated Tests
- Build verification: `npm run build`
- Unit tests: Verify AI response formats and fallback error handling.

### Manual Verification
- Deploy to a local instance to test all connections.
- Print live stream chat messages to console logs to confirm listener status.
- Trigger `!makima` in respective chats to verify replies.
- Check Render logs to verify self-ping execution.

---

## YouTube OAuth Step-by-Step Setup Guide

Follow these steps to set up the credentials needed for the YouTube bot:

### 1. Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click on the project dropdown at the top, then click **New Project**.
3. Name it `Makima Chatbot` and click **Create**.

### 2. Enable the YouTube Data API v3
1. Select your new project in the top dropdown.
2. In the left sidebar, navigate to **APIs & Services** > **Library**.
3. Search for `YouTube Data API v3`, click on it, and click **Enable**.

### 3. Configure the OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** and click **Create**.
3. Fill in the required fields:
   - **App name:** `Makima Chatbot`
   - **User support email:** Your email address
   - **Developer contact information:** Your email address
4. Click **Save and Continue**.
5. **Scopes:** Click **Add or Remove Scopes**, search for `youtube` in the search bar, select `https://www.googleapis.com/auth/youtube.force-ssl` (write access to live chat), and click **Update**. Click **Save and Continue**.
6. **Test Users:** Under the Test Users section, click **Add Users** and input the Gmail address of the YouTube channel that will be running the live stream. Click **Save and Continue**.

### 4. Create OAuth 2.0 Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** at the top and select **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. In **Authorized redirect URIs**, click **Add URI** and enter:
   `http://localhost:3000/oauth2callback`
5. Click **Create**.
6. Copy the **Client ID** and **Client Secret** into your project's `.env` file under `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

### 5. Generate the Refresh Token
1. Run the local setup utility in this workspace:
   `npm run get-yt-token`
2. Follow the prompt to open the login link in your browser.
3. Sign in with the YouTube channel's Google Account.
4. Click **Continue** (if Google warns that the app is unverified).
5. Approve the permissions.
6. The CLI will print your `YOUTUBE_REFRESH_TOKEN`. Copy it and add it to your `.env` file!

