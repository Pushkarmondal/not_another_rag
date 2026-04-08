import type { GoogleGenAI } from "@google/genai";
import { generateCompletion, type RagContextBlock } from "../llm/geminiClient";

export type EvaluationResult = {
      faithfulness: number;
      relevance: number;
      hallucination: number;
      overallScore: number;
};

function normalize(input: string): string[] {
      return input
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((token) => token.length > 2);
}

function ratio(part: number, whole: number): number {
      if (whole <= 0) return 0;
      return part / whole;
}

function clamp01(value: number): number {
      return Math.max(0, Math.min(1, value));
}

export function evaluateAnswer(
      query: string,
      answer: string,
      contexts: RagContextBlock[]
): EvaluationResult {
      const queryTerms = new Set(normalize(query));
      const answerTerms = normalize(answer);
      const contextTerms = new Set(normalize(contexts.map((c) => c.text).join(" ")));

      const uniqueAnswerTerms = [...new Set(answerTerms)];
      const supportedTerms = uniqueAnswerTerms.filter((term) => contextTerms.has(term)).length;
      const unsupportedTerms = uniqueAnswerTerms.length - supportedTerms;
      const matchedQueryTerms = [...queryTerms].filter((term) => uniqueAnswerTerms.includes(term)).length;

      const faithfulness = clamp01(ratio(supportedTerms, Math.max(1, uniqueAnswerTerms.length)));
      const relevance = clamp01(ratio(matchedQueryTerms, Math.max(1, queryTerms.size)));
      const hallucination = clamp01(ratio(unsupportedTerms, Math.max(1, uniqueAnswerTerms.length)));

      const overallScore = clamp01(faithfulness * 0.5 + relevance * 0.4 + (1 - hallucination) * 0.1);

      return {
            faithfulness,
            relevance,
            hallucination,
            overallScore,
      };
}

function asScore(value: unknown): number | null {
      if (typeof value !== "number") return null;
      if (!Number.isFinite(value)) return null;
      return clamp01(value);
}

function parseJudgeJson(raw: string): EvaluationResult | null {
      try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const faithfulness = asScore(parsed.faithfulness);
            const relevance = asScore(parsed.relevance);
            const hallucination = asScore(parsed.hallucination);
            if (faithfulness === null || relevance === null || hallucination === null) return null;
            const overallScore = clamp01(faithfulness * 0.5 + relevance * 0.4 + (1 - hallucination) * 0.1);
            return { faithfulness, relevance, hallucination, overallScore };
      } catch {
            return null;
      }
}

export async function evaluateAnswerWithLlm(
      ai: GoogleGenAI,
      query: string,
      answer: string,
      contexts: RagContextBlock[],
      model?: string
): Promise<EvaluationResult> {
      const fallback = evaluateAnswer(query, answer, contexts);
      const contextText = contexts
            .map((c, idx) => `Snippet ${idx + 1}: ${c.text}`)
            .join("\n\n")
            .slice(0, 12000);

      const prompt = [
            "You are an evaluator for RAG responses.",
            "Return ONLY strict JSON with keys: faithfulness, relevance, hallucination.",
            "Each value must be a number between 0 and 1.",
            "",
            `Query: ${query}`,
            `Answer: ${answer}`,
            "",
            "Context snippets:",
            contextText || "(none)",
      ].join("\n");

      try {
            const { text } = await generateCompletion(ai, {
                  userPrompt: prompt,
                  systemInstruction:
                        "Be strict. Do not include markdown or explanations. Return JSON only.",
                  model,
                  temperature: 0,
                  maxOutputTokens: 220,
            });
            const parsed = parseJudgeJson(text.trim());
            return parsed ?? fallback;
      } catch {
            return fallback;
      }
}
