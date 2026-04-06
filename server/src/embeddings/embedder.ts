import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { GoogleGenAI } from "@google/genai";
import type { ChunkRecord } from "../ingestion/types";

type EmbeddedChunkRecord = ChunkRecord & {
      embedding: number[];
      embeddingModel: string;
      embeddingDim: number;
      embeddedAt: string;
};

const CHUNKS_DIR = path.resolve("data/chunks");
const EMBEDDINGS_DIR = path.resolve("data/embeddings");
const MODEL = "gemini-embedding-2-preview";  // NOTE: gemini-embedding-2-preview is the latest model by Google, but we can use gemini-embedding-001 as well
const MAX_CONCURRENCY = 5;

function parseJsonl(input: string): ChunkRecord[] {
      return input
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as ChunkRecord);
}

function toJsonl(rows: EmbeddedChunkRecord[]): string {
      return rows.map((row) => JSON.stringify(row)).join("\n");
}

async function embedChunk( ai: GoogleGenAI, chunk: ChunkRecord ): Promise<EmbeddedChunkRecord> {
      const response = await ai.models.embedContent({
            model: MODEL,
            contents: chunk.text,
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
            throw new Error(`No embedding returned for chunk: ${chunk.chunkId}`);
      }

      return {
            ...chunk,
            embedding: values,
            embeddingModel: MODEL,
            embeddingDim: values.length,
            embeddedAt: new Date().toISOString(),
      };
}

async function main() {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
            throw new Error("Missing GEMINI_API_KEY in environment.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const limit = pLimit(MAX_CONCURRENCY);

      await fs.mkdir(EMBEDDINGS_DIR, { recursive: true });

      const files = await fs.readdir(CHUNKS_DIR);
      const chunkFiles = files.filter((f) => f.toLowerCase().endsWith(".jsonl"));

      let totalEmbedded = 0;

      for (const file of chunkFiles) {
            const fullPath = path.join(CHUNKS_DIR, file);
            const raw = await fs.readFile(fullPath, "utf8");
            const chunks = parseJsonl(raw);

            const embedded = await Promise.all(
                  chunks.map((chunk) => limit(() => embedChunk(ai, chunk)))
            );

            const outPath = path.join(
                  EMBEDDINGS_DIR,
                  file.replace(/\.jsonl$/i, ".embeddings.jsonl")
            );
            const out = toJsonl(embedded);
            await fs.writeFile(outPath, out ? `${out}\n` : "", "utf8");

            totalEmbedded += embedded.length;
            console.log(
                  `Embedded: ${file} -> ${outPath} (${embedded.length} chunks)`
            );
      }

      console.log(
            `Done. Processed ${chunkFiles.length} file(s), embedded ${totalEmbedded} chunk(s).`
      );
}

await main();