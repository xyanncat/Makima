import express from "express";
import * as dotenv from "dotenv";
import { loadConfig } from "../config";

dotenv.config();

const SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"];
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function exchangeCode(config: ReturnType<typeof loadConfig>, code: string) {
  const { clientId, clientSecret } = config.youtube;
  const body = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as { refresh_token?: string; access_token: string };
}

function buildAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function runGetYtToken(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const { clientId, clientSecret } = config.youtube;
  if (!clientId || !clientSecret) {
    console.error(
      "Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in .env. " +
        "Create OAuth credentials first (see implementation_plan.md)."
    );
    process.exit(1);
  }

  const url = buildAuthUrl(clientId);
  console.log("\nOpen this URL in your browser to authorize the bot:\n");
  console.log(url, "\n");

  const app = express();
  app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const err = req.query.error as string | undefined;
    if (err) {
      res.send(`<h1>Authorization failed: ${err}</h1>`);
      console.error(`Authorization failed: ${err}`);
      process.exit(1);
    }
    if (!code) {
      res.send("<h1>Missing authorization code.</h1>");
      process.exit(1);
    }
    try {
      const tokens = await exchangeCode(config, code);
      res.send(
        "<h1>Authorization complete.</h1><p>You may close this window. " +
          "The refresh token has been printed to your terminal.</p>"
      );
      if (tokens.refresh_token) {
        console.log("\n==============================================");
        console.log("YOUTUBE_REFRESH_TOKEN=" + tokens.refresh_token);
        console.log("==============================================\n");
        console.log("Add the above to your .env file under YOUTUBE_REFRESH_TOKEN.\n");
      } else {
        console.error(
          "No refresh_token returned. Re-run with prompt=consent (ensure you revoked prior grants)."
        );
      }
      process.exit(0);
    } catch (e) {
      res.send(`<h1>Token exchange error: ${(e as Error).message}</h1>`);
      console.error((e as Error).message);
      process.exit(1);
    }
  });

  app.listen(3000, () => {
    console.log("Waiting for OAuth callback on http://localhost:3000/oauth2callback ...");
  });
}

runGetYtToken();
