import { GoogleGenAI } from "@google/genai";
import { estimateTokensFromText } from "../cost/pricing";

/** Must match the model used when building embeddings (see embedder.ts). */
export const EMBEDDING_MODEL = "gemini-embedding-2-preview";

export type EmbedTextResult = {
      vector: number[];
      /** Billable input tokens when known; otherwise a length-based estimate. */
      inputTokens: number;
};

export async function embedText(ai: GoogleGenAI, text: string): Promise<EmbedTextResult> {
      const response = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
            throw new Error("No embedding returned for query text.");
      }

      const billableChars = response.metadata?.billableCharacterCount;
      const inputTokens =
            typeof billableChars === "number" && billableChars > 0
                  ? Math.max(1, Math.ceil(billableChars / 4))
                  : estimateTokensFromText(text);

      return { vector: values, inputTokens };
}
