import { bm25Search } from "./bm25Index";
import { searchSimilar } from "../vectorDB/vector-store";

const RRF_K = 60;

type BaseHit = {
      chunkId: string;
      docId: string;
      sourcePath: string;
      title?: string;
      pageNumber: number;
      chunkIndex: number;
      text: string;
};

export type HybridRetrievedHit = BaseHit & {
      fusedScore: number;
      vectorScore?: number;
      bm25Score?: number;
};

type VectorPayload = BaseHit;

function toVectorPayload(payload: unknown): VectorPayload | null {
      if (!payload || typeof payload !== "object") return null;
      const p = payload as Record<string, unknown>;
      if (
            typeof p.chunkId !== "string" ||
            typeof p.docId !== "string" ||
            typeof p.sourcePath !== "string" ||
            typeof p.pageNumber !== "number" ||
            typeof p.chunkIndex !== "number" ||
            typeof p.text !== "string"
      ) {
            return null;
      }

      return {
            chunkId: p.chunkId,
            docId: p.docId,
            sourcePath: p.sourcePath,
            title: typeof p.title === "string" ? p.title : undefined,
            pageNumber: p.pageNumber,
            chunkIndex: p.chunkIndex,
            text: p.text,
      };
}

function reciprocalRank(rankOneBased: number, k = RRF_K): number {
      return 1 / (k + rankOneBased);
}

export type HybridRetrieveResult = {
      hits: HybridRetrievedHit[];
      stats: {
            vectorHits: number;
            bm25Hits: number;
            fusedHits: number;
      };
};

export async function hybridRetrieve(
      query: string,
      vector: number[],
      topK: number
): Promise<HybridRetrieveResult> {
      const expandedTopK = Math.max(1, topK * 2);

      const [vectorRaw, bm25Hits] = await Promise.all([
            searchSimilar(vector, expandedTopK),
            bm25Search(query, expandedTopK),
      ]);

      const vectorHits = vectorRaw
            .map((hit) => {
                  const payload = toVectorPayload(hit.payload);
                  if (!payload) return null;
                  return { ...payload, vectorScore: hit.score };
            })
            .filter(Boolean) as Array<BaseHit & { vectorScore?: number }>;

      const byChunkId = new Map<string, HybridRetrievedHit>();

      for (let i = 0; i < vectorHits.length; i++) {
            const hit = vectorHits[i]!;
            const rankScore = reciprocalRank(i + 1);
            byChunkId.set(hit.chunkId, {
                  ...hit,
                  fusedScore: rankScore,
            });
      }

      for (let i = 0; i < bm25Hits.length; i++) {
            const hit = bm25Hits[i]!;
            const rankScore = reciprocalRank(i + 1);
            const existing = byChunkId.get(hit.chunkId);
            if (existing) {
                  existing.fusedScore += rankScore;
                  existing.bm25Score = hit.bm25Score;
                  byChunkId.set(hit.chunkId, existing);
                  continue;
            }
            byChunkId.set(hit.chunkId, {
                  chunkId: hit.chunkId,
                  docId: hit.docId,
                  sourcePath: hit.sourcePath,
                  title: hit.title,
                  pageNumber: hit.pageNumber,
                  chunkIndex: hit.chunkIndex,
                  text: hit.text,
                  fusedScore: rankScore,
                  bm25Score: hit.bm25Score,
            });
      }

      const hits = [...byChunkId.values()]
            .sort((a, b) => b.fusedScore - a.fusedScore)
            .slice(0, topK);

      return {
            hits,
            stats: {
                  vectorHits: vectorHits.length,
                  bm25Hits: bm25Hits.length,
                  fusedHits: hits.length,
            },
      };
}
