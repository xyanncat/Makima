import { MAKIMA_SYSTEM_PROMPT, COMMAND_PREFIX } from "../config";

describe("command parsing", () => {
  it("detects the command prefix case-insensitively", () => {
    expect("!makima hello".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(true);
    expect("!MAKIMA hello".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(true);
    expect("hello makima".toLowerCase().startsWith(COMMAND_PREFIX)).toBe(false);
  });

  it("extracts the prompt after the prefix", () => {
    const msg = "!makima tell me about control";
    const prompt = msg.slice(COMMAND_PREFIX.length).trim();
    expect(prompt).toBe("tell me about control");
  });

  it("ignores empty prompts", () => {
    const msg = "!makima   ";
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
