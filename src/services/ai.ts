import OpenAI from "openai";
import { config, MAKIMA_SYSTEM_PROMPT } from "../config";

let openai: OpenAI | null = null;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
}

function getOpenAIClient(): OpenAI {
  if (!openai) {
    if (!config.groq.apiKey) {
      throw new Error("GROQ_API_KEY is not defined in environment variables");
    }
    openai = new OpenAI({
      apiKey: config.groq.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return openai;
}

const SYSTEM_PROMPT = MAKIMA_SYSTEM_PROMPT;
const SEARCH_REQUEST = /^(?:please\s+)?(?:search|look\s+up|google|research|find)\b|\b(?:latest|current|today(?:'s)?|breaking\s+news|news)\b/i;

export function wantsWebSearch(prompt: string): boolean {
  return SEARCH_REQUEST.test(prompt.trim());
}

function searchQuery(prompt: string): string {
  return prompt
    .trim()
    .replace(/^(?:please\s+)?(?:search|look\s+up|google|research|find)\s*(?:for|about)?\s*/i, "")
    .trim() || prompt.trim();
}

async function searchWeb(prompt: string): Promise<string> {
  if (!config.webSearch.apiKey) {
    return "Web search is not configured. Answer from your existing knowledge and clearly say that live search is unavailable.";
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.webSearch.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: searchQuery(prompt),
      search_depth: "basic",
      max_results: config.webSearch.maxResults,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Web search failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { results?: TavilySearchResult[] };
  const results = (data.results ?? [])
    .filter((result) => result.title && result.url && result.content)
    .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.content}`)
    .join("\n\n")
    .slice(0, 5_000);

  return results || "No useful web results were found. Say that plainly instead of inventing current facts.";
}

export async function generateResponse(
  prompt: string,
  history: ConversationTurn[] = []
): Promise<string> {
  const client = getOpenAIClient();
  const models = [config.groq.primaryModel, config.groq.fallbackModel].filter(Boolean);
  let lastError: unknown = null;
  let searchContext = "";

  if (wantsWebSearch(prompt)) {
    try {
      searchContext = await searchWeb(prompt);
    } catch (error: any) {
      console.error("[AI] Web search error:", error.message || error);
      searchContext = "Live web search failed. Be honest that current search is unavailable; do not fabricate current facts.";
    }
  }

  const userContent = searchContext
    ? `${prompt}\n\nLive web-search context:\n${searchContext}`
    : prompt;
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history.slice(-8).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: userContent },
  ];

  for (const model of models) {
    try {
      console.log(`[AI] Attempting response generation with model: ${model}`);
      const completion = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 180,
      });

      const response = completion.choices[0]?.message?.content?.trim() || "";
      if (response) return response;
    } catch (error: any) {
      console.error(`[AI] Error using model ${model}:`, error.message || error);
      lastError = error;
    }
  }

  throw new Error(`AI generation failed for all models. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export { SYSTEM_PROMPT };
