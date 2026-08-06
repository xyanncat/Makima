import { LogSink } from "./types";

/**
 * Rate-limited outbound queue. Messages are sent at most one per `intervalMs`,
 * and when the buffer exceeds `maxSize` the oldest pending message is dropped
 * to avoid sending stale responses.
 */
export class OutboundQueue {
  private buffer: Array<() => Promise<void>> = [];
  private running = false;

  constructor(
    public readonly name: string,
    private readonly intervalMs: number,
    private readonly maxSize: number,
    private readonly log: LogSink
  ) {}

  enqueue(task: () => Promise<void>): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
      this.log(this.name as any, "warn", `Queue overflow: dropped oldest pending message.`);
    }
    this.buffer.push(task);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.buffer.length > 0) {
        const task = this.buffer.shift()!;
        try {
          await task();
        } catch (err) {
          this.log(this.name as any, "error", `Send failed: ${(err as Error).message}`);
        }
        if (this.buffer.length > 0) {
          await new Promise((r) => setTimeout(r, this.intervalMs));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export function createQueues(
  throttle: { twitchMs: number; youtubeMs: number; kickMs: number; maxBuffer: number },
  log: LogSink
): {
  twitch: OutboundQueue;
  youtube: OutboundQueue;
  kick: OutboundQueue;
} {
  return {
    twitch: new OutboundQueue("twitch", throttle.twitchMs, throttle.maxBuffer, log),
    youtube: new OutboundQueue("youtube", throttle.youtubeMs, throttle.maxBuffer, log),
    kick: new OutboundQueue("kick", throttle.kickMs, throttle.maxBuffer, log),
  };
}
