import type { HybridRetrievedHit } from "./hybridRetrieve";

function normalize(input: string): string[] {
      return input
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((t) => t.length > 2);
}

export function rerankHybridHits(query: string, hits: HybridRetrievedHit[], topK: number): HybridRetrievedHit[] {
      const queryTerms = new Set(normalize(query));
      if (queryTerms.size === 0) return hits.slice(0, topK);

      const rescored = hits.map((hit) => {
            const hitTerms = new Set(normalize(`${hit.title ?? ""} ${hit.text}`));
            let overlap = 0;
            for (const q of queryTerms) {
                  if (hitTerms.has(q)) overlap += 1;
            }
            const lexicalBoost = overlap / queryTerms.size;
            // Keep RRF as main signal; add bounded lexical boost.
            const score = hit.fusedScore + lexicalBoost * 0.15;
            return { hit, score };
      });

      return rescored
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map((r) => r.hit);
}
