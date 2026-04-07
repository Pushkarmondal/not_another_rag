import { GoogleGenAI } from "@google/genai";

/** Must match the model used when building embeddings (see embedder.ts). */
export const EMBEDDING_MODEL = "gemini-embedding-2-preview";

export async function embedText(ai: GoogleGenAI, text: string): Promise<number[]> {
      const response = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
            throw new Error("No embedding returned for query text.");
      }
      return values;
}
