import IORedis from "ioredis";
import { Pool } from "pg";
import { Config } from "../config";

export interface OAuthTokenRecord {
  platform: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
}

export interface CommandLogEntry {
  platform: string;
  user: string;
  prompt: string;
  model?: string;
  latencyMs?: number;
  error?: string;
  ts: number;
}

/**
 * Persistent + ephemeral state layer used for deduplication, rate limiting,
 * OAuth token storage, and command audit logging.
 */
export interface StateStore {
  /** Mark a message id as seen. Returns true if it was newly seen (not a duplicate). */
  markSeen(messageId: string, ttlSec: number): Promise<boolean>;
  /** Returns true if the user is currently rate-limited. */
  isRateLimited(platform: string, user: string, windowSec: number): Promise<boolean>;
  getToken(platform: string): Promise<OAuthTokenRecord | null>;
  saveToken(record: OAuthTokenRecord): Promise<void>;
  logCommand(entry: CommandLogEntry): Promise<void>;
  close(): Promise<void>;
}

class InMemoryStateStore implements StateStore {
  private kv = new Map<string, { value: unknown; exp: number }>();
  private tokens = new Map<string, OAuthTokenRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.kv) {
      if (entry.exp <= now) this.kv.delete(key);
    }
  }

  async markSeen(id: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.kv.get(id);
    if (existing && existing.exp > now) return false;
    this.kv.set(id, { value: 1, exp: now + ttlSec * 1000 });
    return true;
  }

  async isRateLimited(platform: string, user: string, windowSec: number): Promise<boolean> {
    const key = `rl:${platform}:${user}`;
    const now = Date.now();
    const existing = this.kv.get(key);
    if (!existing || existing.exp <= now) {
      this.kv.set(key, { value: 1, exp: now + windowSec * 1000 });
      return false; // first message in the window is allowed
    }
    existing.value = (existing.value as number) + 1;
    return (existing.value as number) > 1;
  }

  async getToken(platform: string): Promise<OAuthTokenRecord | null> {
    return this.tokens.get(platform) ?? null;
  }

  async saveToken(record: OAuthTokenRecord): Promise<void> {
    this.tokens.set(record.platform, record);
  }

  async logCommand(_entry: CommandLogEntry): Promise<void> {
    /* in-memory store: no persistence */
  }

  async close(): Promise<void> {
    clearInterval(this.cleanupTimer);
    this.kv.clear();
    this.tokens.clear();
  }
}

/** Database-only mode: durable tokens and audit logs without requiring Redis. */
class PostgresStateStore implements StateStore {
  private readonly ephemeral = new InMemoryStateStore();
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  markSeen(id: string, ttlSec: number): Promise<boolean> {
    return this.ephemeral.markSeen(id, ttlSec);
  }

  isRateLimited(platform: string, user: string, windowSec: number): Promise<boolean> {
    return this.ephemeral.isRateLimited(platform, user, windowSec);
  }

  async getToken(platform: string): Promise<OAuthTokenRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT platform, client_id, client_secret, access_token, refresh_token, expires_at FROM oauth_tokens WHERE platform = $1",
      [platform]
    );
    const row = rows[0];
    return row ? {
      platform: row.platform, client_id: row.client_id, client_secret: row.client_secret,
      access_token: row.access_token, refresh_token: row.refresh_token,
      expires_at: row.expires_at ? Number(row.expires_at) : undefined,
    } : null;
  }

  async saveToken(record: OAuthTokenRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_tokens (platform, client_id, client_secret, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (platform) DO UPDATE SET client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at`,
      [record.platform, record.client_id ?? null, record.client_secret ?? null, record.access_token ?? null,
        record.refresh_token ?? null, record.expires_at ? new Date(record.expires_at) : null]
    );
  }

  async logCommand(entry: CommandLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO command_logs (platform, username, prompt, model, latency_ms, error, ts)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
      [entry.platform, entry.user, entry.prompt, entry.model ?? null, entry.latencyMs ?? null, entry.error ?? null, entry.ts]
    );
  }

  async close(): Promise<void> {
    await this.ephemeral.close();
    await this.pool.end();
  }
}

class RedisStateStore implements StateStore {
  private kv: IORedis;
  private pool?: Pool;
  private tokens = new Map<string, OAuthTokenRecord>();

  constructor(redisUrl: string, databaseUrl?: string) {
    this.kv = new IORedis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  // (used by createStateStore)

  async connect(): Promise<void> {
    await this.kv.connect();
  }

  async markSeen(id: string, ttlSec: number): Promise<boolean> {
    const res = await this.kv.set(`dedup:${id}`, "1", "EX", ttlSec, "NX");
    return res === "OK";
  }

  async isRateLimited(platform: string, user: string, windowSec: number): Promise<boolean> {
    const key = `ratelimit:${platform}:${user}`;
    const count = await this.kv.incr(key);
    if (count === 1) await this.kv.expire(key, windowSec);
    return count > 1;
  }

  async getToken(platform: string): Promise<OAuthTokenRecord | null> {
    if (this.pool) {
      try {
        const { rows } = await this.pool.query(
          "SELECT platform, client_id, client_secret, access_token, refresh_token, expires_at FROM oauth_tokens WHERE platform = $1",
          [platform]
        );
        const row = rows[0];
        if (!row) return null;
        return {
          platform: row.platform,
          client_id: row.client_id,
          client_secret: row.client_secret,
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expires_at: row.expires_at ? Number(row.expires_at) : undefined,
        };
      } catch (err) {
        // Fall back to in-memory cache if the DB is unreachable.
        console.error("[db] token fetch failed, using cache:", (err as Error).message);
      }
    }
    return this.tokens.get(platform) ?? null;
  }

  async saveToken(record: OAuthTokenRecord): Promise<void> {
    this.tokens.set(record.platform, record);
    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO oauth_tokens (platform, client_id, client_secret, access_token, refresh_token, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (platform) DO UPDATE SET
             client_id = EXCLUDED.client_id,
             client_secret = EXCLUDED.client_secret,
             access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at`,
          [
            record.platform,
            record.client_id ?? null,
            record.client_secret ?? null,
            record.access_token ?? null,
            record.refresh_token ?? null,
            record.expires_at ? new Date(record.expires_at) : null,
          ]
        );
      } catch (err) {
        console.error("[db] token save failed:", (err as Error).message);
      }
    }
  }

  async logCommand(entry: CommandLogEntry): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO command_logs (platform, username, prompt, model, latency_ms, error, ts)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
        [
          entry.platform,
          entry.user,
          entry.prompt,
          entry.model ?? null,
          entry.latencyMs ?? null,
          entry.error ?? null,
          entry.ts,
        ]
      );
    } catch (err) {
      console.error("[db] command log failed:", (err as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.kv.quit();
    await this.pool?.end();
  }
}

export async function createStateStore(config: Config): Promise<StateStore> {
  const redisUrl = config.redis?.url;
  const databaseUrl = config.database?.url;
  if (redisUrl) {
    const store = new RedisStateStore(redisUrl, databaseUrl);
    try {
      await store.connect();
      console.log("[db] Using Upstash Redis state store.");
    } catch (err) {
      console.error("[db] Redis connection failed, falling back to in-memory:", (err as Error).message);
      return new InMemoryStateStore();
    }
    return store;
  }
  if (databaseUrl) {
    console.log("[db] Using PostgreSQL for durable tokens and command logs; TTL state remains in memory.");
    return new PostgresStateStore(databaseUrl);
  }
  console.log("[db] Using in-memory state store (set REDIS_URL / DATABASE_URL for persistence).");
  return new InMemoryStateStore();
}
