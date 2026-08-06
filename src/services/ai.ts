import OpenAI from "openai";
import { config, MAKIMA_SYSTEM_PROMPT } from "../config";

let openai: OpenAI | null = null;

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

export async function generateResponse(prompt: string): Promise<string> {
  const client = getOpenAIClient();
  // Filter out any empty models
  const models = [config.groq.primaryModel, config.groq.fallbackModel].filter(Boolean);
  
  let lastError: any = null;
  
  for (const model of models) {
    try {
      console.log(`[AI] Attempting response generation with model: ${model}`);
      const completion = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 100, // Keep responses short and snappy
      });
      
      const response = completion.choices[0]?.message?.content?.trim() || "";
      if (response) {
        return response;
      }
    } catch (error: any) {
      console.error(`[AI] Error using model ${model}:`, error.message || error);
      lastError = error;
    }
  }
  
  throw new Error(`AI generation failed for all models. Last error: ${lastError?.message || lastError}`);
}
export { SYSTEM_PROMPT };
