import type Redis from "ioredis";

const HASH_KEY = "rag:aggregated_cost_metrics";

export type AggregatedCostMetrics = {
      requestCount: number;
      totalCostUsd: number;
      promptTokens: number;
      completionTokens: number;
      embeddingTokens: number;
      ragCacheHits: number;
};

const memory: AggregatedCostMetrics = {
      requestCount: 0,
      totalCostUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      embeddingTokens: 0,
      ragCacheHits: 0,
};

function parseIntField(value: string | undefined, fallback: number): number {
      if (value === undefined || value === "") return fallback;
      const n = Number.parseInt(value, 10);
      return Number.isFinite(n) ? n : fallback;
}

function parseFloatField(value: string | undefined, fallback: number): number {
      if (value === undefined || value === "") return fallback;
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : fallback;
}

export async function recordRequestCost(
      redis: Redis | null,
      delta: {
            costUsd: number;
            promptTokens: number;
            completionTokens: number;
            embeddingTokens: number;
            ragCacheHit: boolean;
      }
): Promise<void> {
      if (!redis) {
            memory.requestCount += 1;
            memory.totalCostUsd += delta.costUsd;
            memory.promptTokens += delta.promptTokens;
            memory.completionTokens += delta.completionTokens;
            memory.embeddingTokens += delta.embeddingTokens;
            if (delta.ragCacheHit) memory.ragCacheHits += 1;
            return;
      }

      try {
            const pipe = redis.multi();
            pipe.hincrby(HASH_KEY, "request_count", 1);
            pipe.hincrbyfloat(HASH_KEY, "total_cost_usd", delta.costUsd);
            pipe.hincrby(HASH_KEY, "prompt_tokens", delta.promptTokens);
            pipe.hincrby(HASH_KEY, "completion_tokens", delta.completionTokens);
            pipe.hincrby(HASH_KEY, "embedding_tokens", delta.embeddingTokens);
            if (delta.ragCacheHit) {
                  pipe.hincrby(HASH_KEY, "rag_cache_hits", 1);
            }
            await pipe.exec();
      } catch (err) {
            console.error({ message: "Failed to record cost metrics", err });
      }
}

export async function getAggregatedCostMetrics(redis: Redis | null): Promise<AggregatedCostMetrics> {
      if (!redis) {
            return { ...memory };
      }

      try {
            const h = await redis.hgetall(HASH_KEY);
            return {
                  requestCount: parseIntField(h.request_count, 0),
                  totalCostUsd: parseFloatField(h.total_cost_usd, 0),
                  promptTokens: parseIntField(h.prompt_tokens, 0),
                  completionTokens: parseIntField(h.completion_tokens, 0),
                  embeddingTokens: parseIntField(h.embedding_tokens, 0),
                  ragCacheHits: parseIntField(h.rag_cache_hits, 0),
            };
      } catch (err) {
            console.error({ message: "Failed to read cost metrics", err });
            return {
                  requestCount: 0,
                  totalCostUsd: 0,
                  promptTokens: 0,
                  completionTokens: 0,
                  embeddingTokens: 0,
                  ragCacheHits: 0,
            };
      }
}
