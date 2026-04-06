import fs from "node:fs/promises";
import path from "node:path";
import { chunkDocument } from "./chunker";
import type { ChunkRecord, ExtractedDocument } from "./types";

const EXTRACTED_DIR = path.resolve("data/extracted");
const CHUNKS_DIR = path.resolve("data/chunks");

function toJsonl(rows: ChunkRecord[]): string {
      return rows.map((row) => JSON.stringify(row)).join("\n");
}

async function main() {
      await fs.mkdir(CHUNKS_DIR, { recursive: true });

      const files = await fs.readdir(EXTRACTED_DIR);
      const extractedDocs = files.filter((f) => f.toLowerCase().endsWith(".json"));

      let totalChunks = 0;

      for (const file of extractedDocs) {
            const fullPath = path.join(EXTRACTED_DIR, file);
            const raw = await fs.readFile(fullPath, "utf8");
            const document = JSON.parse(raw) as ExtractedDocument;

            const chunks = chunkDocument(document, {
                  chunkSize: 900,
                  overlap: 150,
                  minChunkSize: 120,
            });

            const outPath = path.join(CHUNKS_DIR, `${document.docId}.jsonl`);
            const out = toJsonl(chunks);
            await fs.writeFile(outPath, out ? `${out}\n` : "", "utf8");

            totalChunks += chunks.length;
            console.log(
                  `Chunked: ${file} -> ${outPath} (${chunks.length} chunks)`
            );
      }

      console.log(
            `Done. Processed ${extractedDocs.length} document(s), produced ${totalChunks} chunks.`
      );
}

main().catch((err) => {
      console.error(err);
      process.exit(1);
});
