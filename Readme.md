# 🧠 AI Research Agent — Evaluation-Driven RAG System

A production-style AI system that answers research queries using retrieval + LLMs, with built-in evaluation, retry logic, and full observability.

---

## 🚀 Overview

This system is not a basic RAG demo.

It is a **controlled LLM pipeline** that:

* Retrieves relevant documents using hybrid search
* Generates structured responses with citations
* Evaluates output quality (hallucination, relevance)
* Automatically retries or falls back when responses are poor
* Tracks latency, cost, and failure points per request

---

## ⚙️ System Architecture

```
Client → API → Orchestrator
                ↓
        Cache (Redis)
         ↓ (miss)
   Retrieval (Qdrant + BM25)
         ↓
   Lightweight Reranker
         ↓
        LLM
         ↓
     Answer + Sources
         ↓
     Evaluation Layer
         ↓
  Retry / Fallback Logic
         ↓
 Traces + Metrics (Redis)
         ↓
       Response
```
---

![System Architecture](./diagram.png)

## 🧩 Key Features

### 1. Hybrid Retrieval

* Vector search (Qdrant)
* Keyword search (BM25)
* Combined + reranked results (top-k filtering)

---

### 2. Controlled LLM Generation

* Context-grounded generation with citations via source metadata
* Retry with stricter instructions when quality drops

---

### 3. Evaluation System (Core Differentiator)

* LLM-as-judge scoring (Gemini, strict JSON output)
* Automatic fallback to rule-based evaluator if judge output is invalid/unavailable
* Scores:

  * faithfulness
  * relevance
  * hallucination detection

---

### 4. Retry + Fallback Strategy

* Retry with stricter prompt
* Reduce noisy context
* Fallback to alternate model
* Max retry limit enforced

---

### 5. Caching Layer

* Redis-based query caching
* Reduces latency + cost
* Tenant-aware key: `rag:v2:hybrid:<tenant_id>:<model>:<hash>`

---

### 6. Observability & Tracing

Each request generates and stores a `trace_id` (Redis TTL) with:

```json
{
  "trace_id": "abc123",
  "steps": [
    { "step": "retrieval", "latency_ms": 120 },
    { "step": "generation", "tokens": 1100 },
    { "step": "evaluation", "score": 0.82 }
  ]
}
```

---

### 7. Cost Tracking

* Token usage per request
* Cost per request
* Aggregated metrics via `GET /metrics`

---

## 🛠️ Tech Stack

* **Backend:** Node.js + TypeScript
* **Vector DB:** Qdrant
* **Cache:** Redis
* **LLMs:**

  * Primary: Gemini
  * Fallback: Alternate Gemini model

---

## 📡 API Endpoints

### `POST /query`

```json
{
  "query": "What are recent advances in RAG?",
  "user_id": "u1",
  "tenant_id": "t1"
}
```

Response:

```json
{
  "answer": "...",
  "contextCount": 5,
  "cached": false,
  "sources": [{ "title": "Doc", "sourcePath": "/path/file.pdf" }],
  "meta": {
    "traceId": "abc123",
    "latencyMs": 820,
    "evaluation": {
      "faithfulness": 0.91,
      "relevance": 0.88,
      "hallucination": 0.08,
      "overallScore": 0.89
    },
    "cost": { "usd": 0.0019, "currency": "USD" },
    "tokens": { "prompt": 1200, "completion": 260, "embedding": 20, "total": 1480 }
  }
}
```

---

### `GET /trace/:id`

Returns full execution trace

---

### `GET /metrics`

Returns aggregated:

* request count
* cost
* prompt/completion/embedding token totals
* cache-hit counters

---

## 🔁 Failure Handling

| Failure          | Cause             | Solution                       |
| ---------------- | ----------------- | ------------------------------ |
| Bad retrieval    | irrelevant docs   | hybrid search + rerank         |
| Hallucination    | weak grounding    | eval + retry + stricter prompt |
| Invalid JSON     | LLM inconsistency | schema validation + retry      |
| High latency     | large context     | caching + top-k limit          |
| Cost spikes      | retries           | fallback model + limits        |
| Context overflow  | too many tokens   | chunking + truncation          |

---

## 📊 Sample Metrics

```
Latency: 2.1s → 1.2s (after caching)
Hallucination rate: 18% → 6%
Cost/request: $0.01 → $0.003
```

---

## 🧠 Design Philosophy

> “Do not trust the LLM — verify, correct, and control it.”

This system treats LLMs as:

* non-deterministic
* error-prone
* expensive

And wraps them with:

* evaluation
* retries
* observability

---

## 🔮 Future Improvements

* Cross-encoder reranking
* Semantic caching
* Feedback loop from users
* Offline evaluation dataset
* Multi-tenant isolation improvements

---

## 🎯 Why This Project Matters

Most RAG systems:

* generate answers
* hope they are correct

This system:

* **verifies correctness**
* **handles failures**
* **tracks performance**

👉 Built to reflect real-world AI production systems.

---

## 🧪 How to Run

```bash
# 1) move into server
cd server

# 2) install dependencies
bun install

# 3) create env from example
cp .env.example .env
# then fill real values:
# GEMINI_API_KEY, QDRANT_API_KEY, QDRANT_URL, REDIS_URL

# 4) put your PDFs in:
# data/raw-pdf/

# 5) extract text from PDFs
bun src/ingestion/runIngestion.ts

# 6) chunk extracted text
bun src/ingestion/runChunking.ts

# 7) generate embeddings
bun src/embeddings/embedder.ts

# 8) index vectors into Qdrant
bun src/vectorDB/vector-store.ts

# 9) start API server
bun src/apis/query.api.ts
```

### Quick API test

```bash
# query
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query":"What is AWS IAM?",
    "user_id":"u1",
    "tenant_id":"t1"
  }'

# trace lookup
curl http://localhost:3000/trace/<trace_id>

# aggregated metrics
curl http://localhost:3000/metrics
```
