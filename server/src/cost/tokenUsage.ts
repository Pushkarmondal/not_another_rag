export type TokenUsage = {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
};

export function usageFromGenerateContentResponse(response: {
      usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
      };
}): TokenUsage | undefined {
      const u = response.usageMetadata;
      if (!u) return undefined;

      const prompt = u.promptTokenCount ?? 0;
      const candidates = u.candidatesTokenCount ?? 0;
      const total = u.totalTokenCount ?? prompt + candidates;

      if (prompt === 0 && candidates === 0) return undefined;

      return {
            promptTokenCount: prompt,
            candidatesTokenCount: candidates,
            totalTokenCount: total,
      };
}
