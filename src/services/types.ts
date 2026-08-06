export interface ChatPlatformMessage {
  platform: "twitch" | "youtube" | "kick";
  author: string;
  text: string;
  /** The user prompt after the command prefix has been stripped. */
  prompt: string;
}

export type LogLine = {
  ts: number;
  platform: ChatPlatformMessage["platform"] | "system";
  level: "info" | "warn" | "error";
  message: string;
};

export type LogSink = (
  platform: LogLine["platform"],
  level: LogLine["level"],
  message: string
) => void;

export function makeLog(sink: LogSink) {
  return (platform: LogLine["platform"], level: LogLine["level"], message: string) => {
    sink(platform, level, message);
  };
}
