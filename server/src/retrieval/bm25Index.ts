import fs from "node:fs/promises";
import path from "node:path";
import bm25 from "wink-bm25-text-search";
import type { ChunkRecord } from "../ingestion/types";

const CHUNKS_DIR = path.resolve("data/chunks");

type IndexedChunk = Pick<
      ChunkRecord,
      "chunkId" | "docId" | "sourcePath" | "title" | "pageNumber" | "chunkIndex" | "text"
>;

export type Bm25Hit = IndexedChunk & {
      bm25Score: number;
};

let indexBuilt = false;
let engine: ReturnType<typeof bm25> | null = null;
const docsByChunkId = new Map<string, IndexedChunk>();

function normalizeText(input: string): string {
      return input
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
}

function tokenize(input: string): string[] {
      return normalizeText(input).split(" ").filter(Boolean);
}

function parseJsonl(content: string): ChunkRecord[] {
      return content
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as ChunkRecord);
}

async function loadAllChunks(): Promise<IndexedChunk[]> {
      const files = await fs.readdir(CHUNKS_DIR);
      const chunkFiles = files.filter((file) => file.endsWith(".jsonl"));
      const rows: IndexedChunk[] = [];

      for (const file of chunkFiles) {
            const fullPath = path.join(CHUNKS_DIR, file);
            const raw = await fs.readFile(fullPath, "utf8");
            const parsed = parseJsonl(raw);
            for (const chunk of parsed) {
                  rows.push({
                        chunkId: chunk.chunkId,
                        docId: chunk.docId,
                        sourcePath: chunk.sourcePath,
                        title: chunk.title,
                        pageNumber: chunk.pageNumber,
                        chunkIndex: chunk.chunkIndex,
                        text: chunk.text,
                  });
            }
      }

      return rows;
}

export async function buildBm25Index(): Promise<void> {
      if (indexBuilt) return;

      const instance = bm25();
      instance.defineConfig({
            fldWeights: { text: 1 },
            bm25Params: { k1: 1.2, b: 0.75, k: 1 },
      });
      instance.definePrepTasks([(input) => tokenize(typeof input === "string" ? input : String(input ?? ""))]);

      const rows = await loadAllChunks();
      for (const row of rows) {
            docsByChunkId.set(row.chunkId, row);
            instance.addDoc({ text: row.text }, row.chunkId);
      }

      instance.consolidate();
      engine = instance;
      indexBuilt = true;
}

function extractHit(result: unknown): { chunkId: string; score: number } | null {
      if (!result) return null;

      if (Array.isArray(result)) {
            const rawId = result[0];
            const rawScore = result[1];
            if (typeof rawId === "string" && typeof rawScore === "number") {
                  return { chunkId: rawId, score: rawScore };
            }
      }

      if (typeof result === "object") {
            const r = result as Record<string, unknown>;
            const id = r.id ?? r.docId ?? r.chunkId;
            const score = r.score;
            if (typeof id === "string" && typeof score === "number") {
                  return { chunkId: id, score };
            }
      }

      return null;
}

export async function bm25Search(query: string, topK = 5): Promise<Bm25Hit[]> {
      if (!query.trim()) return [];
      if (topK < 1) return [];

      await buildBm25Index();
      if (!engine) return [];

      const rawResults = engine.search(query, topK);
      const hits: Bm25Hit[] = [];

      for (const item of rawResults) {
            const extracted = extractHit(item);
            if (!extracted) continue;

            const chunk = docsByChunkId.get(extracted.chunkId);
            if (!chunk) continue;

            hits.push({ ...chunk, bm25Score: extracted.score });
      }

      return hits;
}

