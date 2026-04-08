import { GoogleGenAI } from "@google/genai";
import { usageFromGenerateContentResponse, type TokenUsage } from "../cost/tokenUsage";

/** Chat / completion model; override with `GEMINI_CHAT_MODEL`. */
export const DEFAULT_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-3-flash-preview";

const DEFAULT_RAG_SYSTEM =
      "You are a careful assistant that answers using only the provided context snippets. " +
      "If the answer is not contained in the context, say you do not know from the given documents. " +
      "When you use information, mention which snippet it came from (title or source path if available).";

export function requireGeminiApiKey(): string {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
            throw new Error("Missing GEMINI_API_KEY in environment.");
      }
      return apiKey;
}

/** Same pattern as {@link ../embeddings/embedder.ts} — API key from env unless passed explicitly. */
export function createGeminiClient(apiKey?: string): GoogleGenAI {
      return new GoogleGenAI({ apiKey: apiKey ?? requireGeminiApiKey() });
}

export type RagContextBlock = {
      text: string;
      title?: string;
      sourcePath?: string;
};

function formatContextBlock(block: RagContextBlock, index: number): string {
      const meta = [block.title, block.sourcePath].filter(Boolean).join(" — ");
      const header = meta
            ? `### Snippet ${index + 1} (${meta})\n`
            : `### Snippet ${index + 1}\n`;
      return `${header}${block.text}`;
}

export type GenerateCompletionParams = {
      userPrompt: string;
      systemInstruction?: string;
      model?: string;
      temperature?: number;
      maxOutputTokens?: number;
};

/**
 * Single-turn text generation. Use {@link generateRagAnswer} when you already have retrieved chunks.
 */
export type GenerateCompletionResult = {
      text: string;
      usage?: TokenUsage;
};

export async function generateCompletion(
      ai: GoogleGenAI,
      params: GenerateCompletionParams
): Promise<GenerateCompletionResult> {
      const model = params.model ?? DEFAULT_CHAT_MODEL;
      const response = await ai.models.generateContent({
            model,
            contents: params.userPrompt,
            config: {
                  ...(params.systemInstruction != null && params.systemInstruction !== ""
                        ? { systemInstruction: params.systemInstruction }
                        : {}),
                  ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
                  ...(params.maxOutputTokens !== undefined
                        ? { maxOutputTokens: params.maxOutputTokens }
                        : {}),
            },
      });

      const text = response.text;
      if (text === undefined || text.trim() === "") {
            throw new Error("Gemini returned empty text.");
      }
      return { text, usage: usageFromGenerateContentResponse(response) };
}

export type GenerateRagAnswerParams = {
      question: string;
      contexts: RagContextBlock[];
      systemInstruction?: string;
      model?: string;
      temperature?: number;
      maxOutputTokens?: number;
};

/**
 * Builds a RAG-style prompt from retrieved snippets and returns the model answer.
 */
export async function generateRagAnswer(
      ai: GoogleGenAI,
      params: GenerateRagAnswerParams
): Promise<GenerateCompletionResult> {
      const ctx =
            params.contexts.length === 0
                  ? "(No context retrieved.)"
                  : params.contexts.map(formatContextBlock).join("\n\n");

      const userPrompt = `Context:\n\n${ctx}\n\n---\n\nQuestion: ${params.question}`;

      return generateCompletion(ai, {
            userPrompt,
            systemInstruction: params.systemInstruction ?? DEFAULT_RAG_SYSTEM,
            model: params.model,
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens,
      });
}
