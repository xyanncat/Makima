import { Config } from "../config";
import { StateStore } from "./db";
import { OutboundQueue } from "./queue";
import { LogSink } from "./types";
import { isInjectionAttempt } from "./security";

export interface BotContext {
  config: Config;
  store: StateStore;
  queues: {
    twitch: OutboundQueue;
    youtube: OutboundQueue;
    kick: OutboundQueue;
  };
  log: LogSink;
}

export type Platform = "twitch" | "youtube" | "kick";

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: "injection" | "duplicate" | "ratelimited" };

/**
 * Runs the shared pre-processing pipeline for every inbound chat message:
 * prompt-injection defense, deduplication, and per-user rate limiting.
 */
export async function guardMessage(
  ctx: BotContext,
  platform: Platform,
  messageId: string,
  user: string,
  rawText: string
): Promise<GuardResult> {
  if (isInjectionAttempt(rawText)) {
    ctx.log(platform, "warn", `Injection attempt from ${user} blocked.`);
    return { ok: false, reason: "injection" };
  }

  const seen = await ctx.store.markSeen(messageId, 300);
  if (!seen) {
    ctx.log(platform, "warn", `Duplicate message ${messageId} skipped.`);
    return { ok: false, reason: "duplicate" };
  }

  const limited = await ctx.store.isRateLimited(platform, user, 10);
  if (limited) {
    ctx.log(platform, "warn", `User ${user} is rate-limited; ignoring.`);
    return { ok: false, reason: "ratelimited" };
  }

  return { ok: true };
}
