# Makima Security, Reliability, and Structure Plan

## Purpose

This file is the working checklist for making the bot behave as intended:

- Automatically discover a public live stream from `YOUTUBE_CHANNEL_ID`.
- Reply using the Google account that owns `YOUTUBE_REFRESH_TOKEN`.
- Keep the bot account restricted to the minimum YouTube permissions required.
- Recover safely from stream endings, temporary network errors, and restarts.
- Prevent unauthorized dashboard access, cost abuse, secret leakage, and common prompt attacks.

Security cannot guarantee that no one will ever attack the bot. The goal is defense in depth: restrict access, validate every untrusted input, reduce the impact of failures, log security-relevant events, and regularly patch dependencies.

## Required Runtime Configuration

Use channel ID mode for automatic discovery:

```ini
YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxx

YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN=...
GROQ_API_KEY=...

DASHBOARD_USER=admin
DASHBOARD_PASSWORD=<long-random-password>
# The only command prefix is !; it is not configurable.
CUSTOM_COMMAND_INSTA=https://instagram.com/your-account
CUSTOM_COMMAND_DC=https://discord.gg/your-server
CUSTOM_COMMAND_SPECS=Your specs text here
YOUTUBE_RATE_LIMIT_WINDOW_SEC=10
YOUTUBE_QUEUE_MS=5000
QUEUE_MAX_BUFFER=10
```

Use `YOUTUBE_CHANNEL_ID` as the only YouTube stream selector. The listener discovers the channel's active public live stream automatically. Do not configure a video ID or channel handle.

The OAuth refresh token must be created while signed into the dedicated Google bot account. That account should be a moderator on the target channel. Do not use a personal owner account.

## Current Structure

```text
YouTube live chat
  -> YouTube Data API live-stream discovery
  -> liveChatMessages polling
  -> command prefix parser
  -> injection / duplicate / rate-limit guard
  -> outbound queue
  -> Groq response generation
  -> YouTube Data API send

Express dashboard
  -> Basic authentication
  -> status and health routes

State layer
  -> Redis: duplicate and rate-limit TTLs, when configured
  -> PostgreSQL: OAuth tokens and command audit logs, when configured
  -> in-memory fallback: development-only / non-durable state
```

## Completed Repairs

- Channel ID startup uses the authenticated YouTube Data API to find the active public live video, obtain its live-chat ID, poll messages directly, and announce `make sure to like and subscribe` once per new stream.
- Listener startup failures, errors, and stream endings trigger guarded exponential-backoff reconnects.
- Duplicate protection uses author channel ID, message timestamp, and text instead of `Date.now()`.
- Command prefix and rate-limit duration are configurable and validated.
- PostgreSQL-only configuration works without requiring Redis.
- Expired in-memory state is periodically removed.
- The production build includes dashboard assets in `dist/public`.
- SIGINT and SIGTERM stop the listener, ping timer, HTTP server, and state store.
- Initial PostgreSQL schema exists in `migrations/001_initial_schema.sql`.

## Open Security Work

### P0: protect secrets and administrative access

1. Set a long, unique `DASHBOARD_PASSWORD` in every deployed environment. Do not expose the dashboard without it.
2. Store `.env` only on the host or in the deployment provider's secret manager. Confirm it is never committed.
3. Rotate `GROQ_API_KEY`, Google client secret, and refresh token immediately if they were ever pasted into logs, chat, screenshots, or source control.
4. Encrypt OAuth client secrets and refresh tokens at rest in PostgreSQL using a deployment-managed encryption key. Limit database credentials to only this application's tables.
5. Restrict dashboard access at the hosting layer using an IP allowlist, VPN, or identity-aware proxy. Basic authentication is an additional control, not the only perimeter.
6. Use HTTPS only in production and set `trust proxy` only when the hosting proxy is known and trusted.

### P0: dependency remediation

Current production dependency audit result: 4 moderate findings, all through `googleapis -> googleapis-common/gaxios -> uuid`.

- Advisory: `uuid` missing buffer bounds check, GHSA-w5hq-g745-h8pq.
- Remediation: upgrade `googleapis` to a version that resolves to `googleapis` `174.0.1` or later, then update any affected OAuth helper code for the major-version change.
- Verification: run `npm audit --omit=dev --json`, `npm run build`, and the complete test suite after the upgrade.

Do not run an automatic major dependency update in production without reviewing the package migration notes and testing the OAuth authorization helper.

### P1: input, cost, and abuse controls

1. Replace the small pattern-based prompt-injection blocklist with layered controls:
   - strict maximum input length;
   - allow only one command prefix at the start of a message;
   - reject control characters and malformed Unicode;
   - retain the system prompt on the server only;
   - enforce a short output token limit and response length;
   - classify or reject suspicious prompts before model use.
2. Rate-limit by immutable YouTube author channel ID, not display name.
3. Add a global request budget and a per-stream cost budget. Disable AI replies and alert the operator when the budget is reached.
4. Cap pending queue work and record dropped-message counts in the dashboard.
5. Use request timeouts and bounded retries for Groq, Google OAuth, and YouTube API calls.
6. Do not include raw prompts, refresh tokens, API keys, or Google API error bodies in public dashboard logs.

### P1: service reliability and observability

1. Distinguish `configured`, `connecting`, `connected`, `reconnecting`, `offline`, and `degraded` states in the dashboard.
2. Make `/health` report process liveness only. Add `/ready` to fail when required configuration, storage, or listener startup is unhealthy.
3. Add structured logs with a request/message correlation ID and redact secrets before any log is written.
4. Alert on repeated OAuth refresh failures, reconnect loops, database failures, queue overflow, and model failure.
5. Apply the SQL migration before enabling `DATABASE_URL`; test restore and token rotation procedures.
6. Use external uptime monitoring for the public `/health` endpoint. The app also performs a best-effort in-process health check against its own public URL when `RENDER_EXTERNAL_URL` is configured, but a process cannot reliably keep itself awake by pinging itself on all hosting platforms.

### P2: code quality and test coverage

1. Unit-test reconnect generation guards so an `end` emitted by an intentionally stopped client does not create another session.
2. Mock the Google token endpoint and YouTube API for token refresh, 401, 429, 5xx, and malformed JSON cases.
3. Test channel ID discovery, message deduplication after reconnect, queue overflow, and graceful shutdown.
4. Add an integration test that runs the built app and asserts `/health`, authenticated `/`, and unauthenticated dashboard rejection.
5. Remove Jest `forceExit` once all test fixtures reliably close their stores, timers, and servers.
6. Add CI checks: `npm ci`, `npm run build`, test suite, `npm audit --omit=dev`, secret scanning, and dependency review.

## Security Acceptance Checklist

Before deployment, confirm all of the following:

- [ ] The bot uses a dedicated Google account, not an owner account.
- [ ] That account is a moderator in the selected channel.
- [ ] `YOUTUBE_CHANNEL_ID` is set for public automatic discovery.
- [ ] The Google OAuth consent screen and credentials are limited to the required YouTube scope.
- [ ] Dashboard password is a unique secret and dashboard access is restricted at the host.
- [ ] `.env` is ignored by Git and no secret appears in repository history.
- [ ] PostgreSQL migration is applied before setting `DATABASE_URL`.
- [ ] Redis and PostgreSQL are backed up or have a documented recovery process when enabled.
- [ ] `npm audit --omit=dev` is reviewed and dependency upgrades are tested.
- [ ] Build, tests, health check, authenticated dashboard, reconnect behavior, and one real chat reply are verified.

## Incident Procedure

1. Disable the deployment or unset `GROQ_API_KEY` if abuse or secret exposure is suspected.
2. Revoke and recreate the exposed Groq key, Google OAuth client secret, and refresh token.
3. Review deployment, database, and dashboard-access logs for scope and time window.
4. Preserve sanitized logs, patch the root cause, and deploy only after tests and audit pass.
5. Rotate dashboard credentials and database credentials after any administrative-access incident.
