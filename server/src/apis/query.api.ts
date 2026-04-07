import express from "express";
import { embedText } from "../embeddings/embedText";
import { createGeminiClient, generateRagAnswer, type RagContextBlock } from "../llm/geminiClient";
import { searchSimilar } from "../vectorDB/vector-store";

const RAG_TOP_K = Number.parseInt(process.env.RAG_TOP_K ?? "5", 10);
const topK = Number.isFinite(RAG_TOP_K) && RAG_TOP_K > 0 ? RAG_TOP_K : 5;

function payloadToContext(payload: unknown): RagContextBlock | null {
      if (!payload || typeof payload !== "object") return null;
      const p = payload as Record<string, unknown>;
      const text = p.text;
      if (typeof text !== "string" || text.trim() === "") return null;
      return {
            text,
            title: typeof p.title === "string" ? p.title : undefined,
            sourcePath: typeof p.sourcePath === "string" ? p.sourcePath : undefined,
      };
}

const app = express();
app.use(express.json());

app.post("/query", async (req, res) => {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) {
            res.status(400).json({ error: "Missing or invalid `query` (non-empty string)." });
            return;
      }

      try {
            const ai = createGeminiClient();
            const vector = await embedText(ai, query);
            const hits = await searchSimilar(vector, topK);

            const contexts: RagContextBlock[] = [];
            for (const hit of hits) {
                  const block = payloadToContext(hit.payload);
                  if (block) contexts.push(block);
            }

            const answer = await generateRagAnswer(ai, {
                  question: query,
                  contexts,
            });

            res.json({
                  answer,
                  contextCount: contexts.length,
                  sources: contexts.map((c) => ({
                        title: c.title ?? null,
                        sourcePath: c.sourcePath ?? null,
                  })),
            });
      } catch (err) {
            const message = err instanceof Error ? err.message : "Query failed.";
            console.error({ message: "POST /query failed", err });
            res.status(500).json({ error: message });
      }
});

app.listen(3000, () => {
      console.log("Server is running on port 3000");
});
