import crypto from "node:crypto";
import Redis from "ioredis";
import { embedText } from "../embeddings/embedText";
import {
      createGeminiClient,
      DEFAULT_CHAT_MODEL,
      generateRagAnswer,
      type RagContextBlock,
} from "../llm/geminiClient";
import { searchSimilar } from "../vectorDB/vector-store";

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
      };
};

// ── Config ───────────────────────────────────────────────────────────────────

const CACHE_VERSION = "v1";
const DEFAULT_TTL_SEC = 3600;
const EMBEDDING_TTL_SEC = 86400;
const MAX_RETRIES = 1;
/** Must match the model used in {@link generateRagAnswer} (same as `GEMINI_CHAT_MODEL` / {@link DEFAULT_CHAT_MODEL}). */
const CHAT_MODEL = DEFAULT_CHAT_MODEL;

// ── Redis ────────────────────────────────────────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
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
): Promise<{ vector: number[]; embeddingCached: boolean }> {
      const key = `embedding:${sha256(query)}`;
      const r = getRedis();

      try {
            const cached = await r?.get(key);
            if (cached) return { vector: JSON.parse(cached) as number[], embeddingCached: true };
      } catch {
            // cache miss — proceed to embed
      }

      const ai = createGeminiClient();
      const vector = await withRetry(() => embedText(ai, query));

      try {
            await r?.set(key, JSON.stringify(vector), "EX", EMBEDDING_TTL_SEC);
      } catch (err) {
            console.error({ message: "Failed to cache embedding", err });
      }

      return { vector, embeddingCached: false };
}

// ── RAG cache ────────────────────────────────────────────────────────────────

function ragCacheKey(query: string, topK: number): string {
      const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
      return `rag:${CACHE_VERSION}:${CHAT_MODEL}:${sha256(`${normalized}:${topK}`)}`;
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
      topK: number
): Promise<RagQueryResult> {
      if (!query.trim()) throw new Error("query must not be empty");
      if (topK < 1) throw new Error("topK must be >= 1");

      const traceId = crypto.randomUUID();
      const start = Date.now();

      const key = ragCacheKey(query, topK);
      const ragCached = await ragCacheGet(key);

      if (ragCached) {
            return {
                  ...ragCached,
                  cached: true,
                  meta: {
                        traceId,
                        latencyMs: Date.now() - start,
                        model: CHAT_MODEL,
                        embeddingCached: false,
                        ragCached: true,
                  },
            };
      }

      // Embedding (cached)
      const { vector, embeddingCached } = await getOrCreateEmbedding(query);

      // Retrieval
      const hits = await withRetry(() => searchSimilar(vector, topK));

      if (hits.length === 0) {
            console.warn({ traceId, message: "No hits from vector search — answering without context" });
      }

      const contexts = hits.map((h) => toContext(h.payload)).filter(Boolean) as RagContextBlock[];

      // Generation (with retry)
      const ai = createGeminiClient();
      const answer = await withRetry(() => generateRagAnswer(ai, { question: query, contexts }));

      const result = {
            answer,
            contextCount: contexts.length,
            sources: contexts.map((c) => ({ title: c.title ?? null, sourcePath: c.sourcePath ?? null })),
      };

      await ragCacheSet(key, result);

      const meta = {
            traceId,
            latencyMs: Date.now() - start,
            model: CHAT_MODEL,
            embeddingCached,
            ragCached: false,
      };

      console.log({ ...meta, query, contextCount: contexts.length });

      return { ...result, cached: false, meta };
}