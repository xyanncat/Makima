# <p align="center"><img src="makima_banner.png" alt="Makima Bot Banner" width="100%"></p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-crimson?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/Model-Groq%20Llama%203.1-ff6b6b?style=for-the-badge" alt="AI Model">
  <img src="https://img.shields.io/badge/Platforms-Twitch%20%7C%20YouTube%20%7C%20Kick-6236ff?style=for-the-badge" alt="Platforms">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
</p>

---

<p align="center">
  <!-- Animated SVG Badge -->
  <svg width="240" height="240" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <style>
      .pulse {
        animation: pulse-glow 2s infinite ease-in-out;
        transform-origin: center;
      }
      .rotate {
        animation: spin 15s linear infinite;
        transform-origin: center;
      }
      .dash {
        stroke-dasharray: 280;
        animation: draw 5s linear infinite;
      }
      @keyframes pulse-glow {
        0%, 100% { transform: scale(0.95); opacity: 0.8; filter: drop-shadow(0 0 4px #c92a2a); }
        50% { transform: scale(1.02); opacity: 1; filter: drop-shadow(0 0 12px #c92a2a); }
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes draw {
        0% { stroke-dashoffset: 560; }
        100% { stroke-dashoffset: 0; }
      }
    </style>
    <!-- Background Circle -->
    <circle cx="50" cy="50" r="45" fill="#0d0e12" stroke="rgba(255, 255, 255, 0.05)" stroke-width="2"/>
    <!-- Animated Outer Ring -->
    <circle class="rotate dash" cx="50" cy="50" r="40" fill="none" stroke="#c92a2a" stroke-width="1.5" stroke-dasharray="15, 8"/>
    <!-- Animated Inner Ring -->
    <circle class="rotate" cx="50" cy="50" r="34" fill="none" stroke="rgba(197, 27, 27, 0.4)" stroke-width="1" stroke-dasharray="3, 3" style="animation-direction: reverse; animation-duration: 8s;"/>
    <!-- Glowing Center Logo -->
    <g class="pulse">
      <circle cx="50" cy="50" r="25" fill="rgba(22, 24, 30, 0.9)" stroke="#c92a2a" stroke-width="2"/>
      <path d="M42 42 L58 58 M58 42 L42 58" stroke="#c92a2a" stroke-width="2" stroke-linecap="round"/>
      <text x="50" y="52" fill="#fff" font-family="'Cinzel', Georgia, serif" font-size="6" font-weight="bold" text-anchor="middle" letter-spacing="1">MAKIMA</text>
    </g>
  </svg>
</p>

<p align="center">
  <i>"I love humans. In the same way that humans love dogs. They are loyal, easily handled, and quite clever."</i>
</p>

<p align="center">
  A premium, high-performance, multi-platform AI live stream chatbot styled after <b>Makima</b> from <i>Chainsaw Man</i>. Running exclusively on <b>Groq API</b> with automated model fallback and a built-in keep-alive self-ping dashboard.
</p>

---

## ⚡ Key Features

*   🧠 **Groq-Powered AI Engine:** Employs ultra-fast model inference with automatic fallback from `llama-3.1-70b-versatile` to `llama-3.1-8b-instant` to guarantee 100% uptime.
*   🎭 **True Makima Persona:** Responses are short, polite, dominant, composed, and deliver a chilling undertone.
*   📺 **Tri-Platform Integration:** Connects seamlessly to a single live stream channel on:
    *   **Twitch:** Integrated with full read/write IRC message capability.
    *   **YouTube:** Quota-efficient HTML polling for chat reading, Google APIs for replying.
    *   **Kick:** Direct subscription to public Pusher WebSockets (no developer key needed to read chat).
*   📊 **Visual Status Control Panel:** A gorgeous glassmorphism control panel showing live connection statuses and real-time logs.
*   ☁️ **Render Free Tier Optimized:** Self-pinging cron system keeps the Render instance active and awake continuously.

---

## 🛠️ Quickstart Guide

### 1. Installation
Clone the repository, configure the environment, and install dependencies:
```bash
git clone https://github.com/xyanncat/Makima.git
cd Makima
npm install
```

### 2. Configure Environment Variables
Rename `.env.example` to `.env` and fill in the parameters:
```bash
cp .env.example .env
```

### 3. YouTube OAuth Setup (For sending messages)
If you want the bot to be able to talk back in YouTube Live Chat:
1. Enable **YouTube Data API v3** in your [Google Cloud Console](https://console.cloud.google.com/).
2. Setup an OAuth Client ID under **Web application** and add `http://localhost:3000/oauth2callback` to authorized redirects.
3. Place `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in `.env`.
4. Run the helper CLI to generate the refresh token:
   ```bash
   npm run get-yt-token
   ```
5. Approve the access and copy the generated `YOUTUBE_REFRESH_TOKEN` to your `.env` file.

### 4. Running the Bot
```bash
# Start in development mode
npm run dev

# Build and run in production
npm run build
npm start
```
Go to `http://localhost:3000` to inspect the visual dashboard.

---

## ☁️ Deploying to Render Free Web Service

1. Create a **Web Service** on [Render](https://dashboard.render.com/).
2. Link your GitHub repository.
3. Configure the following:
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Add all environment variables from `.env` in the **Environment** tab.
5. **CRITICAL:** Set `RENDER_EXTERNAL_URL` to your Render app URL (e.g. `https://makima-bot.onrender.com`). This activates the auto-ping keep-alive script.

---

## 📜 License
Licensed under the [MIT License](LICENSE).
