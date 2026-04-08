import type Redis from "ioredis";

const TRACE_TTL_SECONDS = 24 * 3600;
const inMemoryTraces = new Map<string, unknown>();

function traceKey(traceId: string): string {
      return `trace:${traceId}`;
}

export async function saveTrace(
      redis: Redis | null,
      traceId: string,
      payload: unknown
): Promise<void> {
      if (!redis) {
            inMemoryTraces.set(traceId, payload);
            return;
      }
      try {
            await redis.set(traceKey(traceId), JSON.stringify(payload), "EX", TRACE_TTL_SECONDS);
      } catch (err) {
            console.error({ message: "Failed to save trace", err });
      }
}

export async function getTrace(redis: Redis | null, traceId: string): Promise<unknown | null> {
      if (!redis) {
            return inMemoryTraces.get(traceId) ?? null;
      }
      try {
            const raw = await redis.get(traceKey(traceId));
            return raw ? JSON.parse(raw) : null;
      } catch (err) {
            console.error({ message: "Failed to load trace", err });
            return null;
      }
}
