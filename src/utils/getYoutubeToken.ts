import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("❌ ERROR: YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET is missing in your .env file!");
  console.log("Please create a Google Cloud Project, enable YouTube API v3, generate OAuth Web application credentials, and add them to your .env file.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  REDIRECT_URI
);

const app = express();

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.send("<h1>Authentication failed: No code returned</h1>");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (refreshToken) {
      console.log("\n==================================================");
      console.log("🎉 SUCCESS! Your YouTube Refresh Token is:");
      console.log(`\n👉  ${refreshToken}  👈`);
      console.log("\nCopy this value and save it as YOUTUBE_REFRESH_TOKEN in your .env or Render variables.");
      console.log("==================================================\n");

      res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1 style="color: #4CAF50;">Authentication Successful!</h1>
          <p>You can close this window now. Check your terminal logs for the refresh token.</p>
        </div>
      `);
    } else {
      res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1 style="color: #FF5722;">Success, but no Refresh Token returned.</h1>
          <p>This usually happens if you already authorized this application previously.</p>
          <p>Please go to your <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions page</a>, remove access for your app, and run this script again.</p>
        </div>
      `);
      console.log("\n⚠️ WARNING: No refresh token returned. If this is a re-authorization, go to https://myaccount.google.com/permissions, remove app access, and rerun.\n");
    }
  } catch (err: any) {
    console.error("❌ Error retrieving access token:", err.message || err);
    res.status(500).send("<h1>Authentication failed</h1>");
  } finally {
    // Graceful shutdown after a short delay
    setTimeout(() => {
      console.log("Shutting down auth helper server...");
      process.exit(0);
    }, 2000);
  }
});

const server = app.listen(PORT, () => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    prompt: "consent" // Force authorization prompt to ensure we get a refresh token
  });

  console.log("\n==================================================");
  console.log("🔗 YouTube OAuth Token Generator");
  console.log("==================================================");
  console.log("Please open the following URL in your web browser:\n");
  console.log(authUrl);
  console.log("\nSign in with the YouTube channel's Google account, approve permissions, and you will be redirected.");
  console.log("==================================================\n");
});
