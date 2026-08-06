![Makima Banner](./makima_banner.png)

<p align="center">
  <!-- Animated Control Matrix & Chains SVG -->
  <svg width="600" height="150" viewBox="0 0 600 150" xmlns="http://www.w3.org/2000/svg">
    <style>
      .glow-text {
        font-family: 'Cinzel', Georgia, serif;
        fill: #ffffff;
        font-size: 32px;
        font-weight: 700;
        letter-spacing: 12px;
        text-shadow: 0 0 10px #c92a2a, 0 0 20px #c92a2a, 0 0 30px #c92a2a;
        animation: textFlicker 3s infinite alternate;
      }
      .subtitle-text {
        font-family: 'Inter', sans-serif;
        fill: #868e96;
        font-size: 11px;
        letter-spacing: 4px;
        text-transform: uppercase;
      }
      .animated-chain {
        stroke: #c92a2a;
        stroke-width: 1.5;
        stroke-dasharray: 200;
        stroke-dashoffset: 400;
        animation: drawChain 6s linear infinite;
        opacity: 0.8;
      }
      .ring {
        transform-origin: center;
        animation: spinRing 20s linear infinite;
      }
      .ring-reverse {
        transform-origin: center;
        animation: spinRingRev 15s linear infinite;
      }
      @keyframes textFlicker {
        0%, 100% { opacity: 0.95; text-shadow: 0 0 8px #c92a2a, 0 0 15px #c92a2a; }
        50% { opacity: 1; text-shadow: 0 0 18px #c92a2a, 0 0 35px #c92a2a, 0 0 50px #c92a2a; }
        92% { opacity: 0.9; }
        93% { opacity: 0.5; }
        94% { opacity: 0.9; }
      }
      @keyframes drawChain {
        to { stroke-dashoffset: 0; }
      }
      @keyframes spinRing {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes spinRingRev {
        from { transform: rotate(360deg); }
        to { transform: rotate(0deg); }
      }
    </style>
    <!-- Background Layer -->
    <rect width="600" height="150" fill="#0d0e12" rx="10"/>
    
    <!-- Left Decorative Seals -->
    <g transform="translate(60, 75)">
      <circle class="ring" r="40" fill="none" stroke="rgba(201, 42, 42, 0.2)" stroke-width="1.5" stroke-dasharray="10 5"/>
      <circle class="ring-reverse" r="30" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1" stroke-dasharray="4 2"/>
      <path d="M-20 0 L20 0 M0 -20 L0 20" stroke="rgba(201, 42, 42, 0.3)" stroke-width="1"/>
    </g>

    <!-- Right Decorative Seals -->
    <g transform="translate(540, 75)">
      <circle class="ring-reverse" r="40" fill="none" stroke="rgba(201, 42, 42, 0.2)" stroke-width="1.5" stroke-dasharray="10 5"/>
      <circle class="ring" r="30" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1" stroke-dasharray="4 2"/>
      <path d="M-20 0 L20 0 M0 -20 L0 20" stroke="rgba(201, 42, 42, 0.3)" stroke-width="1"/>
    </g>

    <!-- Connecting Animated Chain Lines -->
    <path class="animated-chain" d="M110 55 L490 55" fill="none"/>
    <path class="animated-chain" d="M490 95 L110 95" fill="none" style="animation-delay: -3s;"/>

    <!-- Central Text -->
    <text x="300" y="70" class="glow-text" text-anchor="middle">MAKIMA BOT</text>
    <text x="300" y="105" class="subtitle-text" text-anchor="middle">CONTROL ENGINE v1.0.0 // GROQ AI</text>
  </svg>
</p>

<p align="center">
  <a href="https://github.com/xyanncat/Makima/issues"><img src="https://img.shields.io/github/issues/xyanncat/Makima?color=c92a2a&style=for-the-badge" alt="Issues"></a>
  <a href="https://github.com/xyanncat/Makima/stargazers"><img src="https://img.shields.io/github/stars/xyanncat/Makima?color=c92a2a&style=for-the-badge" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-gray?style=for-the-badge" alt="License"></a>
  <a href="https://render.com"><img src="https://img.shields.io/badge/Host-Render%20Free-2b8a3e?style=for-the-badge" alt="Host"></a>
</p>

<p align="center">
  ⛓️ <b>"Everything in this world is under my control. You will be too."</b> ⛓️
</p>

<p align="center">
  A premium, high-performance, multi-platform AI live stream chatbot styled after the commanding persona of <b>Makima</b> from <i>Chainsaw Man</i>. Running exclusively on the ultra-fast <b>Groq API</b>, it automatically connects to and controls chatrooms on <b>Twitch</b>, <b>YouTube Live</b>, and <b>Kick</b> simultaneously.
</p>

---

## 👁️ Core Directives (Features)

<table width="100%">
  <tr>
    <td width="33%" align="center">
      <b>🐕 The Obedience Engine</b><br>
      <i>Highly realistic Makima persona: polite, refined, dominant, and chilling. Zero emojis. Zero exclamation marks. Absolute control.</i>
    </td>
    <td width="33%" align="center">
      <b>⚡ Light-Speed Groq AI</b><br>
      <i>Utilizes Groq API with instant model fallbacks. Swaps from <b>Llama 3.1 70B</b> to <b>8B</b> instantly if rate-limits or outages are encountered.</i>
    </td>
    <td width="33%" align="center">
      <b>📈 Live Analytics Board</b><br>
      <i>A gorgeous glassmorphism status web interface serving real-time connection telemetry and live console log feeds.</i>
    </td>
  </tr>
</table>

---

## ⛓️ Platform Integration Matrix

| Platform | Chat Listener | Chat Sender | Authentication Required |
| :--- | :--- | :--- | :--- |
| <img src="https://img.shields.io/badge/Twitch-9146FF?style=flat-square&logo=twitch&logoColor=white" height="20"> | **TMI.js Client** | **TMI.js IRC Writer** | Channel Name & OAuth Token |
| <img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" height="20"> | **HTML Chat Scraper** | **Google API Client** | OAuth2 Client ID & Refresh Token |
| <img src="https://img.shields.io/badge/Kick-53FC18?style=flat-square&logo=kick&logoColor=black" height="20"> | **Pusher WebSockets** | **Direct HTTPS Post** | Account Session Auth Token |

---

## ⚙️ Deployment & Variables

To boot the bot, configure the following variables inside a local `.env` file or in your **Render Environment Configuration**:

### System Config
*   `PORT`: Port of the express telemetry server (default `3000`).
*   `RENDER_EXTERNAL_URL`: Public URL of your deployed Render app (e.g. `https://makima.onrender.com`). Enables the **keep-alive auto-ping task**.

### AI Settings
*   `GROQ_API_KEY`: Your Groq Cloud access key.
*   `GROQ_PRIMARY_MODEL`: Defaults to `llama-3.1-70b-versatile`.
*   `GROQ_FALLBACK_MODEL`: Defaults to `llama-3.1-8b-instant`.

<details>
<summary><b>🔑 Click to view Platform Connection Config</b></summary>

```ini
# Twitch settings
TWITCH_CHANNEL=streamer_username
TWITCH_BOT_USERNAME=bot_username
TWITCH_OAUTH_TOKEN=oauth:xxxxxxxxxxxxxxxxxxxxx

# YouTube settings
YOUTUBE_CHANNEL_ID=UCxxxxxxx
YOUTUBE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=gsecs_xxxxxxxxx
YOUTUBE_REFRESH_TOKEN=1//0xxxxxxxxx

# Kick settings
KICK_CHANNEL_NAME=streamer_name
KICK_CHATROOM_ID=1234567
KICK_BOT_TOKEN=Bearer xxxxxxxxxxxxxxxxxx
```
</details>

---

## ⚡ Setup & Launch

```bash
# 1. Clone repository
git clone https://github.com/xyanncat/Makima.git
cd Makima

# 2. Install dependencies
npm install

# 3. Setup credentials
cp .env.example .env
# (Fill in your Groq API key and credentials)

# 4. Generate YouTube Refresh Token (If using YouTube)
npm run get-yt-token

# 5. Run in Development
npm run dev

# 6. Build and Start Production
npm run build
npm start
```

---

## 🩸 Render Deployment (100% Uptime Free Hosting)

1. Create a **Web Service** on [Render](https://dashboard.render.com/) linked to your repository.
2. Build Settings:
   *   **Runtime:** `Node`
   *   **Build Command:** `npm install && npm run build`
   *   **Start Command:** `npm start`
   *   **Instance Type:** `Free`
3. Add your environment variables in the **Environment** tab. Make sure `RENDER_EXTERNAL_URL` points to your public Render service domain.
4. The server automatically triggers the ping utility every 10 minutes, keeping the container active 24/7!
