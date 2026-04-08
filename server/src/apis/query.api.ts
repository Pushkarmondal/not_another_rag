import express from "express";
import { getAggregatedCostMetrics } from "../cost/metricsStore";
import { getRedis, runRagQueryWithCache } from "../orchestration/ragQueryOrchestrator";

const RAG_TOP_K = Number.parseInt(process.env.RAG_TOP_K ?? "5", 10);
const topK = Number.isFinite(RAG_TOP_K) && RAG_TOP_K > 0 ? RAG_TOP_K : 5;

const app = express();
app.use(express.json());

app.get("/metrics", async (_req, res) => {
      try {
            const aggregated = await getAggregatedCostMetrics(getRedis());
            res.json({ aggregated });
      } catch (err) {
            const message = err instanceof Error ? err.message : "Metrics failed.";
            console.error({ message: "GET /metrics failed", err });
            res.status(500).json({ error: message });
      }
});

app.post("/query", async (req, res) => {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) {
            res.status(400).json({ error: "Missing or invalid `query` (non-empty string)." });
            return;
      }

      try {
            const payload = await runRagQueryWithCache(query, topK);
            res.json(payload);
      } catch (err) {
            const message = err instanceof Error ? err.message : "Query failed.";
            console.error({ message: "POST /query failed", err });
            res.status(500).json({ error: message });
      }
});

app.listen(3000, () => {
      console.log("Server is running on port 3000");
});
