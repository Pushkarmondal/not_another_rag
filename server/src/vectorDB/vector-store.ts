import { QdrantClient } from "@qdrant/js-client-rest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

type EmbeddedChunkRecord = {
      chunkId: string;
      docId: string;
      sourcePath: string;
      title?: string;
      pageNumber: number;
      chunkIndex: number;
      text: string;
      charCount: number;
      startChar: number;
      endChar: number;
      embedding: number[];
      embeddingModel: string;
      embeddingDim: number;
      embeddedAt: string;
};

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "rag-collection";
const EMBEDDINGS_DIR = path.resolve("data/embeddings");
const UPSERT_BATCH_SIZE = 64;
const RECREATE_ON_DIM_MISMATCH =
      process.env.QDRANT_RECREATE_COLLECTION_ON_MISMATCH === "true";

const client = new QdrantClient({
      url: process.env.QDRANT_URL || "",
      apiKey: process.env.QDRANT_API_KEY || "",
});

function parseJsonl(input: string): EmbeddedChunkRecord[] {
      return input
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as EmbeddedChunkRecord);
}

function toBatches<T>(items: T[], batchSize: number): T[][] {
      const batches: T[][] = [];
      for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
      }
      return batches;
}

async function ensureCollection(vectorSize: number) {
      const exists = await client.collectionExists(COLLECTION_NAME);
      if (exists.exists) {
            const collection = await client.getCollection(COLLECTION_NAME);
            const configuredSize = getCollectionVectorSize(collection);

            if (configuredSize !== null && configuredSize !== vectorSize) {
                  if (RECREATE_ON_DIM_MISMATCH) {
                        await client.deleteCollection(COLLECTION_NAME);
                        await client.createCollection(COLLECTION_NAME, {
                              vectors: {
                                    size: vectorSize,
                                    distance: "Cosine",
                              },
                        });
                        console.log(
                              `Recreated collection '${COLLECTION_NAME}' with size=${vectorSize} (was ${configuredSize}).`
                        );
                        return;
                  }

                  throw new Error(
                        `Collection '${COLLECTION_NAME}' has vector size ${configuredSize}, but incoming embeddings are ${vectorSize}. Set QDRANT_RECREATE_COLLECTION_ON_MISMATCH=true to recreate automatically, or use a new collection name.`
                  );
            }
            return;
      }

      await client.createCollection(COLLECTION_NAME, {
            vectors: {
                  size: vectorSize,
                  distance: "Cosine",
            },
      });
      console.log(`Created collection '${COLLECTION_NAME}' with size=${vectorSize}`);
}

function getCollectionVectorSize(collection: unknown): number | null {
      const vectors = (collection as { config?: { params?: { vectors?: unknown } } })?.config?.params?.vectors;
      if (!vectors) return null;
      if (typeof vectors === "object" && vectors !== null && "size" in vectors) {
            const size = (vectors as { size?: unknown }).size;
            return typeof size === "number" ? size : null;
      }
      return null;
}

function chunkIdToUuid(chunkId: string): string {
      const hex = crypto.createHash("sha1").update(chunkId).digest("hex").slice(0, 32);
      const chars = hex.split("");
      const variantOptions = ["8", "9", "a", "b"] as const;
      chars[12] = "5";
      chars[16] = variantOptions[Number.parseInt(chars[16] ?? "0", 16) % 4] ?? "8";
      const normalized = chars.join("");
      return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

async function upsertEmbeddings(records: EmbeddedChunkRecord[]) {
      const firstRecord = records.at(0);
      if (!firstRecord) return;

      await ensureCollection(firstRecord.embeddingDim);

      const batches = toBatches(records, UPSERT_BATCH_SIZE);
      for (const batch of batches) {
            await client.upsert(COLLECTION_NAME, {
                  wait: true,
                  points: batch.map((record) => ({
                        id: chunkIdToUuid(record.chunkId),
                        vector: record.embedding,
                        payload: {
                              chunkId: record.chunkId,
                              docId: record.docId,
                              sourcePath: record.sourcePath,
                              title: record.title ?? null,
                              pageNumber: record.pageNumber,
                              chunkIndex: record.chunkIndex,
                              text: record.text,
                              charCount: record.charCount,
                              startChar: record.startChar,
                              endChar: record.endChar,
                              embeddingModel: record.embeddingModel,
                              embeddedAt: record.embeddedAt,
                        },
                  })),
            });
      }
}

export async function indexAllEmbeddingFiles() {
      const files = await fs.readdir(EMBEDDINGS_DIR);
      const embeddingFiles = files.filter((f) => f.endsWith(".embeddings.jsonl"));

      let total = 0;
      for (const file of embeddingFiles) {
            const filePath = path.join(EMBEDDINGS_DIR, file);
            const raw = await fs.readFile(filePath, "utf8");
            const records = parseJsonl(raw);
            await upsertEmbeddings(records);
            total += records.length;
            console.log(`Indexed ${records.length} vectors from ${file}`);
      }

      console.log(`Done. Indexed ${total} vectors into '${COLLECTION_NAME}'.`);
}

export async function searchSimilar(vector: number[], limit = 5) {
      return client.search(COLLECTION_NAME, {
            vector,
            limit,
            with_payload: true,
      });
}

if (import.meta.main) {
      indexAllEmbeddingFiles().catch((err) => {
            console.error({
                  message: "Qdrant indexing failed",
                  error: err,
                  details:
                        typeof err === "object" && err !== null && "data" in err
                              ? (err as { data?: unknown }).data
                              : undefined,
                  timestamp: new Date().toISOString()
            });
            process.exit(1);
      });
}

