CREATE TABLE IF NOT EXISTS oauth_tokens (
  platform TEXT PRIMARY KEY,
  client_id TEXT,
  client_secret TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS command_logs (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  username TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  error TEXT,
  ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS command_logs_ts_idx ON command_logs (ts DESC);
