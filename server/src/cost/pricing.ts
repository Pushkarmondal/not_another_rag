/**
 * Rough USD estimates per 1M tokens. Override with `GEMINI_COST_RATES_JSON`:
 * `{"gemini-2.0-flash":{"inputPerMillion":0.1,"outputPerMillion":0.4},"gemini-embedding-2-preview":{"inputPerMillion":0.02,"outputPerMillion":0}}`
 */
type ModelRates = { inputPerMillion: number; outputPerMillion: number };

const DEFAULT_CHAT: ModelRates = { inputPerMillion: 0.075, outputPerMillion: 0.3 };
const DEFAULT_EMBED: ModelRates = { inputPerMillion: 0.02, outputPerMillion: 0 };

function loadOverrides(): Record<string, ModelRates> {
      const raw = process.env.GEMINI_COST_RATES_JSON?.trim();
      if (!raw) return {};
      try {
            const parsed = JSON.parse(raw) as Record<string, Partial<ModelRates>>;
            const out: Record<string, ModelRates> = {};
            for (const [model, r] of Object.entries(parsed)) {
                  if (
                        typeof r?.inputPerMillion === "number" &&
                        typeof r?.outputPerMillion === "number"
                  ) {
                        out[model] = { inputPerMillion: r.inputPerMillion, outputPerMillion: r.outputPerMillion };
                  }
            }
            return out;
      } catch {
            return {};
      }
}

let cachedOverrides: Record<string, ModelRates> | null = null;

function overrides(): Record<string, ModelRates> {
      if (!cachedOverrides) cachedOverrides = loadOverrides();
      return cachedOverrides;
}

/** Heuristic when the API does not return token counts (e.g. some embed paths). */
export function estimateTokensFromText(text: string): number {
      return Math.max(1, Math.ceil(text.length / 4));
}

export function costUsdForChat(model: string, promptTokens: number, completionTokens: number): number {
      const r = overrides()[model] ?? DEFAULT_CHAT;
      return (
            (promptTokens / 1_000_000) * r.inputPerMillion +
            (completionTokens / 1_000_000) * r.outputPerMillion
      );
}

export function costUsdForEmbed(model: string, inputTokens: number): number {
      const r = overrides()[model] ?? DEFAULT_EMBED;
      return (inputTokens / 1_000_000) * r.inputPerMillion;
}
