import crypto from "node:crypto";
import Redis from "ioredis";
import { embedText, EMBEDDING_MODEL } from "../embeddings/embedText";
import { costUsdForChat, costUsdForEmbed, estimateTokensFromText } from "../cost/pricing";
import { recordRequestCost } from "../cost/metricsStore";
import {
      createGeminiClient,
      DEFAULT_CHAT_MODEL,
      generateRagAnswer,
      type RagContextBlock,
} from "../llm/geminiClient";
import { evaluateAnswerWithLlm, type EvaluationResult } from "../evaluation/judge";
import { hybridRetrieve } from "../retrieval/hybridRetrieve";
import { rerankHybridHits } from "../retrieval/rerank";
import { getTrace, saveTrace } from "../tracing/traceStore";

export type RagQueryResult = {
      answer: string;
      contextCount: number;
      cached: boolean;
      sources: Array<{ title: string | null; sourcePath: string | null }>;
      meta: {
            traceId: string;
            latencyMs: number;
            model: string;
            embeddingCached: boolean;
            ragCached: boolean;
            retrievalMode: "hybrid";
            evaluation: EvaluationResult;
            steps: Array<Record<string, number | string>>;
            cost: { usd: number; currency: "USD" };
            tokens: {
                  prompt: number;
                  completion: number;
                  embedding: number;
                  total: number;
            };
      };
};

export type RunRagQueryOptions = {
      tenantId: string;
      userId?: string;
};

// ── Config ───────────────────────────────────────────────────────────────────

const CACHE_VERSION = "v2";
const DEFAULT_TTL_SEC = 3600;
const EMBEDDING_TTL_SEC = 86400;
const MAX_RETRIES = 3;
const EVAL_THRESHOLD = 0.75;
/** Must match the model used in {@link generateRagAnswer} (same as `GEMINI_CHAT_MODEL` / {@link DEFAULT_CHAT_MODEL}). */
const CHAT_MODEL = DEFAULT_CHAT_MODEL;
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.0-flash";

// ── Redis ────────────────────────────────────────────────────────────────────

let redisClient: Redis | null = null;

export function getRedis(): Redis | null {
      const url = process.env.REDIS_URL?.trim();
      if (!url) return null;

      if (!redisClient) {
            redisClient = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
            redisClient.on("error", (err) => console.error({ message: "Redis error", err }));
      }

      return redisClient;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
      return crypto.createHash("sha256").update(input).digest("hex");
}

function getTtlSec(): number {
      const parsed = parseInt(process.env.REDIS_CACHE_TTL_SECONDS ?? "", 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SEC;
}

function estimateRagPromptTokens(question: string, contexts: RagContextBlock[]): number {
      const body = `${contexts.map((c) => c.text).join("\n")}\n${question}`;
      return estimateTokensFromText(body);
}

function toContext(payload: unknown): RagContextBlock | null {
      if (!payload || typeof payload !== "object") return null;

      const p = payload as Record<string, unknown>;
      if (typeof p.text !== "string" || !p.text.trim()) return null;

      return {
            text: p.text,
            ...(typeof p.title === "string" && { title: p.title }),
            ...(typeof p.sourcePath === "string" && { sourcePath: p.sourcePath }),
      };
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
      try {
            return await fn();
      } catch (err) {
            if (retries <= 0) throw err;
            console.warn({ message: `Retrying after error (${retries} left)`, err });
            return withRetry(fn, retries - 1);
      }
}

// ── Embedding cache ──────────────────────────────────────────────────────────

async function getOrCreateEmbedding(
      query: string
): Promise<{ vector: number[]; embeddingCached: boolean; embeddingInputTokens: number }> {
      const key = `embedding:${sha256(query)}`;
      const r = getRedis();

      try {
            const cached = await r?.get(key);
            if (cached) {
                  return {
                        vector: JSON.parse(cached) as number[],
                        embeddingCached: true,
                        embeddingInputTokens: 0,
                  };
            }
      } catch {
            // cache miss — proceed to embed
      }

      const ai = createGeminiClient();
      const { vector, inputTokens } = await withRetry(() => embedText(ai, query));

      try {
            await r?.set(key, JSON.stringify(vector), "EX", EMBEDDING_TTL_SEC);
      } catch (err) {
            console.error({ message: "Failed to cache embedding", err });
      }

      return { vector, embeddingCached: false, embeddingInputTokens: inputTokens };
}

// ── RAG cache ────────────────────────────────────────────────────────────────

function ragCacheKey(query: string, topK: number, tenantId: string): string {
      const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
      return `rag:${CACHE_VERSION}:hybrid:${tenantId}:${CHAT_MODEL}:${sha256(`${normalized}:${topK}`)}`;
}

async function ragCacheGet(key: string): Promise<Omit<RagQueryResult, "meta" | "cached"> | null> {
      try {
            const raw = await getRedis()?.get(key);
            if (!raw) return null;

            const o = JSON.parse(raw);
            if (
                  typeof o?.answer !== "string" ||
                  typeof o?.contextCount !== "number" ||
                  !Array.isArray(o?.sources)
            ) return null;

            return o;
      } catch {
            return null;
      }
}

async function ragCacheSet(key: string, value: Omit<RagQueryResult, "meta" | "cached">): Promise<void> {
      try {
            await getRedis()?.set(key, JSON.stringify(value), "EX", getTtlSec());
      } catch (err) {
            console.error({ message: "Redis SET failed", err });
      }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runRagQueryWithCache(
      query: string,
      topK: number,
      options: RunRagQueryOptions
): Promise<RagQueryResult> {
      if (!query.trim()) throw new Error("query must not be empty");
      if (topK < 1) throw new Error("topK must be >= 1");
      if (!options.tenantId?.trim()) throw new Error("tenantId must not be empty");

      const traceId = crypto.randomUUID();
      const start = Date.now();

      const key = ragCacheKey(query, topK, options.tenantId);
      const ragCached = await ragCacheGet(key);

      if (ragCached) {
            void recordRequestCost(getRedis(), {
                  costUsd: 0,
                  promptTokens: 0,
                  completionTokens: 0,
                  embeddingTokens: 0,
                  ragCacheHit: true,
            });
            const response: RagQueryResult = {
                  ...ragCached,
                  cached: true,
                  meta: {
                        traceId,
                        latencyMs: Date.now() - start,
                        model: CHAT_MODEL,
                        embeddingCached: false,
                        ragCached: true,
                        retrievalMode: "hybrid",
                        evaluation: {
                              faithfulness: 1,
                              relevance: 1,
                              hallucination: 0,
                              overallScore: 1,
                        },
                        steps: [],
                        cost: { usd: 0, currency: "USD" },
                        tokens: {
                              prompt: 0,
                              completion: 0,
                              embedding: 0,
                              total: 0,
                        },
                  },
            };
            await saveTrace(getRedis(), traceId, {
                  trace_id: traceId,
                  user_id: options.userId ?? null,
                  tenant_id: options.tenantId,
                  query,
                  cached: true,
                  meta: response.meta,
            });
            return response;
      }

      // Embedding (cached)
      const { vector, embeddingCached, embeddingInputTokens } = await getOrCreateEmbedding(query);

      // Retrieval
      const retrievalStart = Date.now();
      const hybrid = await withRetry(() => hybridRetrieve(query, vector, topK));
      const retrievalLatencyMs = Date.now() - retrievalStart;

      if (hybrid.hits.length === 0) {
            console.warn({ traceId, message: "No hits from hybrid retrieval — answering without context" });
      }

      const rerankedHits = rerankHybridHits(query, hybrid.hits, topK);
      const fullContexts = rerankedHits.map((h) => toContext(h)).filter(Boolean) as RagContextBlock[];

      // Generation + evaluation + retry/fallback
      const ai = createGeminiClient();
      const traceSteps: Array<Record<string, number | string>> = [
            {
                  step: "retrieval",
                  latency_ms: retrievalLatencyMs,
                  vector_hits: hybrid.stats.vectorHits,
                  bm25_hits: hybrid.stats.bm25Hits,
                  fused_hits: hybrid.stats.fusedHits,
            },
      ];

      let attempt = 0;
      let lastAnswer = "";
      let lastEvaluation: EvaluationResult = {
            faithfulness: 0,
            relevance: 0,
            hallucination: 1,
            overallScore: 0,
      };
      let selectedContexts = fullContexts;
      let usedModel = CHAT_MODEL;

      let sumPromptTokens = 0;
      let sumCompletionTokens = 0;
      let generationCostUsd = 0;

      while (attempt < MAX_RETRIES) {
            attempt += 1;

            if (attempt === 2 && selectedContexts.length > 2) {
                  selectedContexts = selectedContexts.slice(0, Math.max(2, Math.ceil(selectedContexts.length * 0.6)));
            }
            if (attempt >= 3) {
                  usedModel = FALLBACK_MODEL;
            }

            const generationStart = Date.now();
            const { text: answerText, usage } = await withRetry(() =>
                  generateRagAnswer(ai, {
                        question: query,
                        contexts: selectedContexts,
                        model: usedModel,
                        systemInstruction:
                              attempt > 1
                                    ? "Answer only with explicitly supported claims from context. If uncertain, say you do not know from the provided snippets. Keep answer concise and factual."
                                    : undefined,
                  })
            );
            lastAnswer = answerText;
            const generationLatencyMs = Date.now() - generationStart;

            const promptTokens =
                  usage?.promptTokenCount ??
                  estimateRagPromptTokens(query, selectedContexts);
            const completionTokens =
                  usage?.candidatesTokenCount ?? estimateTokensFromText(lastAnswer);

            sumPromptTokens += promptTokens;
            sumCompletionTokens += completionTokens;
            generationCostUsd += costUsdForChat(usedModel, promptTokens, completionTokens);

            const evaluationStart = Date.now();
            lastEvaluation = await evaluateAnswerWithLlm(ai, query, lastAnswer, selectedContexts, usedModel);
            const evaluationLatencyMs = Date.now() - evaluationStart;

            const totalStepTokens =
                  usage?.totalTokenCount ?? promptTokens + completionTokens;

            traceSteps.push({
                  step: "generation",
                  latency_ms: generationLatencyMs,
                  tokens: totalStepTokens,
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  model: usedModel,
            });
            traceSteps.push({
                  step: "evaluation",
                  latency_ms: evaluationLatencyMs,
                  score: Number(lastEvaluation.overallScore.toFixed(4)),
            });

            if (lastEvaluation.overallScore >= EVAL_THRESHOLD) {
                  break;
            }
      }

      const result = {
            answer: lastAnswer,
            contextCount: selectedContexts.length,
            sources: selectedContexts.map((c) => ({ title: c.title ?? null, sourcePath: c.sourcePath ?? null })),
      };

      await ragCacheSet(key, result);

      const embedCostUsd =
            embeddingInputTokens > 0 ? costUsdForEmbed(EMBEDDING_MODEL, embeddingInputTokens) : 0;
      const totalCostUsd = embedCostUsd + generationCostUsd;
      const tokenTotal = sumPromptTokens + sumCompletionTokens + embeddingInputTokens;

      await recordRequestCost(getRedis(), {
            costUsd: totalCostUsd,
            promptTokens: sumPromptTokens,
            completionTokens: sumCompletionTokens,
            embeddingTokens: embeddingInputTokens,
            ragCacheHit: false,
      });

      const meta = {
            traceId,
            latencyMs: Date.now() - start,
            model: usedModel,
            embeddingCached,
            ragCached: false,
            retrievalMode: "hybrid" as const,
            evaluation: lastEvaluation,
            steps: traceSteps,
            cost: { usd: Number(totalCostUsd.toFixed(6)), currency: "USD" as const },
            tokens: {
                  prompt: sumPromptTokens,
                  completion: sumCompletionTokens,
                  embedding: embeddingInputTokens,
                  total: tokenTotal,
            },
      };

      console.log({ ...meta, query, contextCount: selectedContexts.length });
      const response: RagQueryResult = { ...result, cached: false, meta };
      await saveTrace(getRedis(), traceId, {
            trace_id: traceId,
            user_id: options.userId ?? null,
            tenant_id: options.tenantId,
            query,
            cached: false,
            answer: result.answer,
            sources: result.sources,
            meta,
      });
      return response;
}

export async function getTraceById(traceId: string): Promise<unknown | null> {
      if (!traceId.trim()) return null;
      return getTrace(getRedis(), traceId);
}