import OpenAI from "openai";
import type { TokenUsage } from "../cost/tokenUsage";

export const DEFAULT_OPENAI_CHAT_MODEL =
      process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

export type OpenAiCompletionParams = {
      userPrompt: string;
      systemInstruction?: string;
      model?: string;
      temperature?: number;
      maxOutputTokens?: number;
};

export type OpenAiCompletionResult = {
      text: string;
      usage?: TokenUsage;
};

export function requireOpenAiApiKey(): string {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
            throw new Error("Missing OPENAI_API_KEY in environment.");
      }
      return apiKey;
}

export function createOpenAiClient(apiKey?: string): OpenAI {
      return new OpenAI({ apiKey: apiKey ?? requireOpenAiApiKey() });
}

export async function generateOpenAiCompletion(
      client: OpenAI,
      params: OpenAiCompletionParams
): Promise<OpenAiCompletionResult> {
      const model = params.model ?? DEFAULT_OPENAI_CHAT_MODEL;
      const response = await client.responses.create({
            model,
            instructions: params.systemInstruction,
            input: params.userPrompt,
            ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
            ...(params.maxOutputTokens !== undefined
                  ? { max_output_tokens: params.maxOutputTokens }
                  : {}),
      });

      const text = response.output_text?.trim() ?? "";
      if (!text) {
            throw new Error("OpenAI returned empty text.");
      }

      const usage = response.usage
            ? {
                  promptTokenCount: response.usage.input_tokens ?? 0,
                  candidatesTokenCount: response.usage.output_tokens ?? 0,
                  totalTokenCount: response.usage.total_tokens ?? 0,
            }
            : undefined;

      return { text, usage };
}
