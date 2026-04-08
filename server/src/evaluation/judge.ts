import type { RagContextBlock } from "../llm/geminiClient";

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
