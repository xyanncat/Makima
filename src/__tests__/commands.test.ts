import { MAKIMA_SYSTEM_PROMPT, COMMAND_PREFIX, loadConfig } from "../config";

describe("command parsing", () => {
  it("detects the command prefix case-insensitively", () => {
    expect("!hello".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(true);
    expect("!HELLO".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(true);
    expect("hello makima".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(false);
  });

  it("extracts the prompt after the prefix", () => {
    const msg = "!tell me about control";
    const prompt = msg.slice(COMMAND_PREFIX.length).trim();
    expect(prompt).toBe("tell me about control");
  });

  it("ignores empty prompts", () => {
    const msg = "!   ";
    const prompt = msg.slice(COMMAND_PREFIX.length).trim();
    expect(prompt.length).toBe(0);
  });
});

describe("Makima system prompt", () => {
  it("enforces a short, controlled persona", () => {
    expect(MAKIMA_SYSTEM_PROMPT).toContain("Makima");
    expect(MAKIMA_SYSTEM_PROMPT.toLowerCase()).toContain("chainsaw man");
  });
});

describe("configuration", () => {
  it("normalizes a custom command prefix and rate-limit window", () => {
    const configured = loadConfig({
      GROQ_API_KEY: "test-key",
      COMMAND_PREFIX: " !Ask ",
      YOUTUBE_RATE_LIMIT_WINDOW_SEC: "15",
    });
    expect(configured.commandPrefix).toBe("!ask");
    expect(configured.youtube.rateLimitWindowSec).toBe(15);
  });

  it("rejects invalid timer and queue values", () => {
    expect(() => loadConfig({ YOUTUBE_QUEUE_MS: "-1" })).toThrow("YOUTUBE_QUEUE_MS");
    expect(() => loadConfig({ YOUTUBE_RATE_LIMIT_WINDOW_SEC: "nope" })).toThrow("YOUTUBE_RATE_LIMIT_WINDOW_SEC");
  });
});
